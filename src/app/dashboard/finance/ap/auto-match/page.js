/* ============================================================
   BESTAND: ap_automatch_page_v2.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/auto-match/page.js
   (overschrijft v1, hernoemen naar page.js bij upload)

   WIJZIGINGEN T.O.V. v1:
   - Status update: 'paid' → 'auto_matched' (tussenstatus)
     Reden: portal en Eagle lopen niet synchroon. Auto-match in
     portal is een aankondiging — pas als Eagle de aflettering
     ook heeft doorgevoerd is het echt 'paid'. Detectie gebeurt
     bij volgende Compass-upload (zie ap_upload_page_v3.js).
   - Tekst aangepast: "Afgehandeld in portal" ipv "Afgehandeld"
   - Verwijst naar Eagle Sync werklijst voor wat nog moet
   ============================================================ */
'use client';

import { useApRole } from '../layout';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

// Pagineer een Supabase query — omzeilt PostgREST 1000-rijen default
async function fetchAllPaginated(queryBuilder, batchSize = 1000) {
  let allRows = [];
  let from = 0;
  while (true) {
    const q = queryBuilder().range(from, from + batchSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

// Voor één vendor: zoek paren waarbij +X en -X elkaar opheffen
// Vergelijking op abs-waarde in centen om floating-point issues te vermijden
function findPairsForVendor(invoices) {
  const byAbs = {};
  for (const inv of invoices) {
    const bal = parseFloat(inv.balance);
    if (bal === 0) continue;
    const cents = Math.round(Math.abs(bal) * 100);
    if (!byAbs[cents]) byAbs[cents] = { pos: [], neg: [] };
    if (bal > 0) byAbs[cents].pos.push(inv);
    else byAbs[cents].neg.push(inv);
  }

  const pairs = [];
  for (const cents in byAbs) {
    const { pos, neg } = byAbs[cents];
    const matchCount = Math.min(pos.length, neg.length);
    for (let i = 0; i < matchCount; i++) {
      pairs.push({
        positive: pos[i],
        negative: neg[i],
        amount: parseFloat(pos[i].balance),
      });
    }
  }
  return pairs;
}

function fmtMoney(amount) {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}

export default function AutoMatchPage() {
  const { actualProfile, effectiveProfileId, effectiveRole, effectiveName, isPlayingRole } = useApRole();
  const supabase = createClient();
  const isClerk = effectiveRole === 'ap_clerk';

  const [vendors, setVendors] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyPair, setBusyPair] = useState({});
  const [donePair, setDonePair] = useState({});
  const [error, setError] = useState(null);

  const loadPairs = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDonePair({});
    try {
      const openInvoices = await fetchAllPaginated(() => {
        let q = supabase
          .from('ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, voucher, type, balance, invoice_date, due_date, assigned_ap_clerk')
          .eq('status', 'open');
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
        return q;
      });

      // Vendors + alias-groepen ophalen
      const vendors = await fetchAllPaginated(() =>
        supabase.from('ap_vendors').select('vendor_id, vendor_name, alias_group_id')
      );
      const vendorByIdLookup = {};
      for (const v of vendors) vendorByIdLookup[String(v.vendor_id)] = v;

      const { data: groupNames } = await supabase
        .from('ap_vendor_alias_groups').select('id, name');
      const aliasGroupName = {};
      for (const g of (groupNames || [])) aliasGroupName[g.id] = g.name;

      // Groepering: per alias_group_id (of vendor_id als geen alias)
      const byGroup = {};
      for (const inv of openInvoices) {
        const vRec = vendorByIdLookup[String(inv.vendor_id)];
        const aliasId = vRec?.alias_group_id || null;
        const groupKey = aliasId ? `alias:${aliasId}` : `vendor:${inv.vendor_id}`;
        if (!byGroup[groupKey]) {
          byGroup[groupKey] = {
            key: groupKey,
            isAlias: !!aliasId,
            displayName: aliasId
              ? (aliasGroupName[aliasId] || 'Alias groep')
              : (vRec?.vendor_name || inv.vendor_name),
            vendorIds: new Set(),
            vendorNames: new Set(),
            invoices: [],
          };
        }
        byGroup[groupKey].invoices.push(inv);
        byGroup[groupKey].vendorIds.add(String(inv.vendor_id));
        byGroup[groupKey].vendorNames.add(inv.vendor_name);
      }

      const groupsWithPairs = [];
      for (const g of Object.values(byGroup)) {
        const pairs = findPairsForVendor(g.invoices);
        if (pairs.length > 0) {
          groupsWithPairs.push({
            id: g.key,
            name: g.displayName,
            isAlias: g.isAlias,
            vendorCount: g.vendorIds.size,
            vendorNames: Array.from(g.vendorNames),
            pairs,
            totalAmount: pairs.reduce((s, p) => s + Math.abs(p.amount), 0),
          });
        }
      }
      groupsWithPairs.sort((a, b) => b.totalAmount - a.totalAmount);
      setVendors(groupsWithPairs);
    } catch (e) {
      setError(e.message || 'Onbekende fout');
    } finally {
      setLoading(false);
    }
  }, [supabase, effectiveProfileId, isClerk]);

  useEffect(() => { loadPairs(); }, [loadPairs]);

  async function confirmPair(pair, pairKey) {
    setBusyPair(b => ({ ...b, [pairKey]: true }));
    setError(null);
    try {
      const now = new Date().toISOString();
      const ids = [pair.positive.id, pair.negative.id];
      // Update alleen als nog 'open' (voorkomt dubbele submission)
      const { data: updated, error: updErr } = await supabase
        .from('ap_invoices')
        .update({
          status: 'auto_matched',
          last_status_change: now,
          last_status_change_by: actualProfile.id,
        })
        .in('id', ids)
        .eq('status', 'open')
        .select('id');
      if (updErr) throw updErr;

      if (!updated || updated.length < 2) {
        throw new Error('Eén of beide facturen waren al verwerkt door iemand anders');
      }

      await supabase.from('ap_audit_log').insert({
        action: 'auto_matched',
        entity_type: 'invoice_pair',
        entity_id: `${pair.positive.id},${pair.negative.id}`,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          vendor_id: pair.positive.vendor_id,
          vendor_name: pair.positive.vendor_name,
          amount: pair.amount,
          positive_invoice: pair.positive.invoice_number,
          positive_voucher: pair.positive.voucher,
          positive_type: pair.positive.type,
          negative_invoice: pair.negative.invoice_number,
          negative_voucher: pair.negative.voucher,
          negative_type: pair.negative.type,
          played_as: isPlayingRole ? effectiveName : null,
        },
      });

      setDonePair(d => ({ ...d, [pairKey]: true }));
    } catch (e) {
      setError(e.message || 'Fout bij bevestigen');
    } finally {
      setBusyPair(b => ({ ...b, [pairKey]: false }));
    }
  }

  async function confirmAllForVendor(vendor, vIdx) {
    for (let i = 0; i < vendor.pairs.length; i++) {
      const key = `${vIdx}-${i}`;
      if (donePair[key]) continue;
      await confirmPair(vendor.pairs[i], key);
    }
  }

  // Stats
  const totalPairs = vendors ? vendors.reduce((s, v) => s + v.pairs.length, 0) : 0;
  const totalAmount = vendors ? vendors.reduce((s, v) => s + v.totalAmount, 0) : 0;
  const confirmedCount = Object.values(donePair).filter(Boolean).length;
  const remainingPairs = totalPairs - confirmedCount;

  return (
    <div className="max-w-5xl mx-auto">
      <Header />

      <IntroCard isClerk={isClerk} effectiveName={effectiveName} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Bezig met zoeken naar paren...</p>
        </div>
      )}

      {!loading && vendors && vendors.length === 0 && (
        <EmptyState isClerk={isClerk} />
      )}

      {!loading && vendors && vendors.length > 0 && (
        <>
          <StatsBar
            vendorCount={vendors.length}
            totalPairs={totalPairs}
            totalAmount={totalAmount}
            confirmedCount={confirmedCount}
            remainingPairs={remainingPairs}
            onRefresh={loadPairs}
          />

          {vendors.map((vendor, vIdx) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              vIdx={vIdx}
              busyPair={busyPair}
              donePair={donePair}
              onConfirmPair={confirmPair}
              onConfirmAll={() => confirmAllForVendor(vendor, vIdx)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
        <Link href="/dashboard/finance/ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
        <span>›</span>
        <span>Auto-match</span>
      </div>
      <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        Auto-match werklijst
      </h1>
      <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
        Compensaties binnen één vendor — geen bank-betaling nodig
      </p>
    </div>
  );
}

function IntroCard({ isClerk, effectiveName }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 flex items-start gap-3">
      <span className="text-xl flex-shrink-0">⚖️</span>
      <div className="text-[12px] text-emerald-900">
        <p className="font-semibold mb-1">Hoe werkt het?</p>
        <p className="leading-relaxed">
          Paren binnen één vendor waarbij +X en −X elkaar opheffen. Bevestig hier het paar in de
          portal → daarna nog wegboeken in Eagle. Bij de volgende Compass-upload wordt automatisch
          gedetecteerd dat de afhandeling rond is.{' '}
          <Link href="/dashboard/finance/ap/eagle-sync" className="font-semibold underline hover:no-underline">
            Eagle Sync werklijst
          </Link>{' '}
          toont wat nog moet worden doorgevoerd in Eagle.
          {isClerk && <> Je ziet alleen je eigen toegewezen vendors ({effectiveName}).</>}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ isClerk }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
      <span className="text-5xl block mb-3">✨</span>
      <p className="text-[15px] font-semibold text-[#1B3A5C] mb-1">Geen auto-match kandidaten</p>
      <p className="text-[13px] text-[#1B3A5C]/60">
        Er zijn momenteel geen openstaande facturen die tegen elkaar wegvallen
        {isClerk && <> binnen jouw toegewezen vendors</>}.
      </p>
    </div>
  );
}

function StatsBar({ vendorCount, totalPairs, totalAmount, confirmedCount, remainingPairs, onRefresh }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm flex items-center gap-6 flex-wrap">
      <Stat label="Vendors" value={vendorCount} />
      <Stat label="Paren" value={totalPairs} highlight={remainingPairs} highlightLabel="open" />
      <Stat label="Totaal saldo" value={`XCG ${fmtMoney(totalAmount)}`} isText />
      {confirmedCount > 0 && (
        <Stat label="Afgehandeld" value={confirmedCount} color="emerald" />
      )}
      <button
        onClick={onRefresh}
        className="ml-auto px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:bg-gray-100 transition-all"
      >
        ↻ Verversen
      </button>
    </div>
  );
}

function Stat({ label, value, isText, highlight, highlightLabel, color }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#1B3A5C]/40 font-semibold">{label}</p>
      <p className={`${isText ? 'text-[15px]' : 'text-[20px]'} font-bold ${color === 'emerald' ? 'text-emerald-700' : 'text-[#1B3A5C]'}`} style={{ fontFamily: isText ? undefined : 'Playfair Display, Georgia, serif' }}>
        {value}
        {highlight !== undefined && highlight !== null && (
          <span className="text-[11px] font-normal text-[#1B3A5C]/50 ml-1.5">({highlight} {highlightLabel})</span>
        )}
      </p>
    </div>
  );
}

function VendorCard({ vendor, vIdx, busyPair, donePair, onConfirmPair, onConfirmAll }) {
  const allDone = vendor.pairs.every((_, i) => donePair[`${vIdx}-${i}`]);
  const someDone = vendor.pairs.some((_, i) => donePair[`${vIdx}-${i}`]);
  const someBusy = vendor.pairs.some((_, i) => busyPair[`${vIdx}-${i}`]);
  const openCount = vendor.pairs.filter((_, i) => !donePair[`${vIdx}-${i}`]).length;

  return (
    <div className={`bg-white rounded-xl border ${allDone ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'} p-4 mb-3 shadow-sm`}>
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">📦</span>
            <h3 className="text-[15px] font-bold text-[#1B3A5C] flex items-center gap-2 flex-wrap">
              {vendor.name}
              {vendor.isAlias && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 cursor-help"
                  title={`Alias-groep met ${vendor.vendorCount} vendors: ${vendor.vendorNames.join(', ')}`}>
                  🔗 alias-groep · {vendor.vendorCount} vendors
                </span>
              )}
            </h3>
            <span className="text-[11px] text-[#1B3A5C]/40 font-mono">#{vendor.id}</span>
          </div>
          <p className="text-[12px] text-[#1B3A5C]/60 mt-0.5">
            {vendor.pairs.length} {vendor.pairs.length === 1 ? 'paar' : 'paren'} ·
            totaal saldo XCG {fmtMoney(vendor.totalAmount)}
          </p>
        </div>
        {!allDone && vendor.pairs.length > 1 && (
          <button
            onClick={onConfirmAll}
            disabled={someBusy}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50"
          >
            ✓ Alle {openCount} bevestigen
          </button>
        )}
        {allDone && (
          <span className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-[12px] font-semibold">
            ✓ In portal afgeletterd
          </span>
        )}
      </div>

      <div className="space-y-2">
        {vendor.pairs.map((pair, i) => {
          const pairKey = `${vIdx}-${i}`;
          return (
            <PairRow
              key={pairKey}
              pair={pair}
              done={donePair[pairKey]}
              busy={busyPair[pairKey]}
              onConfirm={() => onConfirmPair(pair, pairKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PairRow({ pair, done, busy, onConfirm }) {
  return (
    <div className={`rounded-lg border p-3 ${done ? 'bg-emerald-50 border-emerald-200' : 'bg-[#f8fafc] border-gray-200'} flex items-center gap-3 flex-wrap`}>
      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        <InvoiceRow label="+" inv={pair.positive} positive showVendor={vendor.isAlias} />
        <InvoiceRow label="−" inv={pair.negative} positive={false} showVendor={vendor.isAlias} />
      </div>
      <div className="flex-shrink-0">
        {done ? (
          <span className="text-[12px] text-emerald-700 font-semibold">✓ In portal afgeletterd</span>
        ) : (
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[12px] font-semibold hover:bg-[#152e4a] transition-all disabled:opacity-50"
          >
            {busy ? 'Bezig...' : '✓ Bevestig'}
          </button>
        )}
      </div>
    </div>
  );
}

function InvoiceRow({ label, inv, positive, showVendor }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={`w-5 h-5 rounded flex items-center justify-center font-bold flex-shrink-0 ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#1B3A5C] truncate" title={inv.invoice_number}>
          {inv.invoice_number}
          <span className="font-mono text-[10px] text-[#1B3A5C]/40 ml-1.5">v.{inv.voucher}</span>
        </p>
        <p className="text-[11px] text-[#1B3A5C]/60">
          {inv.type} · datum {fmtDate(inv.invoice_date)}
          {showVendor && <span className="ml-1 italic">· {inv.vendor_name} (#{inv.vendor_id})</span>}
        </p>
      </div>
      <p className={`font-mono font-bold text-[13px] ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
        {positive ? '+' : ''}{fmtMoney(parseFloat(inv.balance))}
      </p>
    </div>
  );
}
