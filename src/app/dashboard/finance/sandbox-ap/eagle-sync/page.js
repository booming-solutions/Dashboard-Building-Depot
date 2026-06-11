/* ============================================================
   BESTAND: sandbox_ap_eagle_sync_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/eagle-sync/page.js
   (nieuwe file, hernoemen naar page.js bij upload)

   Folder "eagle-sync" wordt automatisch aangemaakt onder
   src/app/dashboard/finance/sandbox-ap/

   Eagle Sync werklijst:
   - Toont alle facturen met status='auto_matched'
     (afgehandeld in portal, wacht op Eagle-update)
   - Read-only: detectie van afhandeling gebeurt automatisch bij
     de volgende Compass-upload. Voucher verdwijnt uit export →
     status wordt automatisch 'paid'.
   - Per vendor gegroepeerd, paren tonend (zelfde algoritme als
     auto-match werklijst)
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useApRole } from '../layout';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

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
      pairs.push({ positive: pos[i], negative: neg[i], amount: parseFloat(pos[i].balance) });
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
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export default function EagleSyncPage() {
  const { effectiveProfileId, effectiveRole, effectiveName, actualProfile } = useApRole();
  const supabase = createClient();
  const isClerk = effectiveRole === 'ap_clerk';

  const [vendors, setVendors] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [oldestPending, setOldestPending] = useState(null);
  const [processingIds, setProcessingIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAllPaginated(() => {
        let q = supabase
          .from('sandbox_ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, voucher, type, balance, invoice_date, last_status_change, last_status_change_by, assigned_ap_clerk')
          .eq('status', 'auto_matched')
          .order('last_status_change', { ascending: true });
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
        return q;
      });

      // Bepaal oudste pending
      if (rows.length > 0) {
        const oldestTime = rows.reduce((min, r) => {
          const t = r.last_status_change;
          return t && (!min || t < min) ? t : min;
        }, null);
        setOldestPending(oldestTime);
      } else {
        setOldestPending(null);
      }

      // Per vendor groeperen
      const byVendor = {};
      for (const inv of rows) {
        if (!byVendor[inv.vendor_id]) {
          byVendor[inv.vendor_id] = { id: inv.vendor_id, name: inv.vendor_name, invoices: [] };
        }
        byVendor[inv.vendor_id].invoices.push(inv);
      }

      // Pairs per vendor
      const vendorsWithPairs = [];
      for (const v of Object.values(byVendor)) {
        const pairs = findPairsForVendor(v.invoices);
        // Voor pending Eagle-sync: ook losse rijen tonen die nog geen pair
        // hebben kunnen vormen (kan voorkomen als één kant al verwerkt is)
        const matchedIds = new Set();
        for (const p of pairs) {
          matchedIds.add(p.positive.id);
          matchedIds.add(p.negative.id);
        }
        const orphans = v.invoices.filter(i => !matchedIds.has(i.id));
        if (pairs.length > 0 || orphans.length > 0) {
          vendorsWithPairs.push({
            id: v.id,
            name: v.name,
            pairs,
            orphans,
            totalAmount: pairs.reduce((s, p) => s + Math.abs(p.amount), 0) +
                         orphans.reduce((s, o) => s + Math.abs(parseFloat(o.balance)), 0),
            oldestChange: v.invoices.reduce((min, i) =>
              i.last_status_change && (!min || i.last_status_change < min) ? i.last_status_change : min, null),
          });
        }
      }
      vendorsWithPairs.sort((a, b) => {
        // Oudste eerst (langst wachtend)
        if (!a.oldestChange) return 1;
        if (!b.oldestChange) return -1;
        return a.oldestChange.localeCompare(b.oldestChange);
      });

      setVendors(vendorsWithPairs);
    } catch (e) {
      setError(e.message || 'Onbekende fout');
    } finally {
      setLoading(false);
    }
  }, [supabase, effectiveProfileId, isClerk]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const totalPairs = vendors ? vendors.reduce((s, v) => s + v.pairs.length, 0) : 0;
  const totalOrphans = vendors ? vendors.reduce((s, v) => s + v.orphans.length, 0) : 0;
  const totalRows = totalPairs * 2 + totalOrphans;
  const totalAmount = vendors ? vendors.reduce((s, v) => s + v.totalAmount, 0) : 0;

  // Hoe oud is de oudste pending?
  let oldestAgeText = null;
  if (oldestPending) {
    const ageMs = Date.now() - new Date(oldestPending).getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const ageHours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (ageDays > 0) oldestAgeText = `${ageDays} dag${ageDays === 1 ? '' : 'en'}`;
    else if (ageHours > 0) oldestAgeText = `${ageHours} uur`;
    else oldestAgeText = 'recent';
  }

  // Markeer 1 of meerdere facturen handmatig als verwerkt (status='paid')
  async function markProcessed(invoiceIds, label) {
    if (!invoiceIds || invoiceIds.length === 0) return;
    setProcessingIds(prev => {
      const next = new Set(prev);
      for (const id of invoiceIds) next.add(id);
      return next;
    });
    setError(null);
    try {
      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from('sandbox_ap_invoices')
        .update({
          status: 'paid',
          paid_at: now,
          paid_by: actualProfile.id,
          last_status_change: now,
          last_status_change_by: actualProfile.id,
        })
        .in('id', invoiceIds)
        .eq('status', 'auto_matched');
      if (updErr) throw updErr;

      // Audit log per factuur
      const auditRows = invoiceIds.map(id => ({
        action: 'eagle_sync_manual_confirmed',
        entity_type: 'invoice',
        entity_id: id,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          batch_size: invoiceIds.length,
          batch_label: label || null,
          previous_status: 'auto_matched',
          new_status: 'paid',
        },
      }));
      if (auditRows.length > 0) await supabase.from('sandbox_ap_audit_log').insert(auditRows);

      // Optimistic UI update: verwijder uit werklijst
      setVendors(prev => {
        if (!prev) return prev;
        const removeSet = new Set(invoiceIds);
        return prev.map(v => {
          const newPairs = v.pairs.filter(p => !removeSet.has(p.positive.id) && !removeSet.has(p.negative.id));
          const newOrphans = v.orphans.filter(o => !removeSet.has(o.id));
          return {
            ...v,
            pairs: newPairs,
            orphans: newOrphans,
            totalAmount: newPairs.reduce((s, p) => s + Math.abs(p.amount), 0) +
              newOrphans.reduce((s, o) => s + Math.abs(parseFloat(o.balance) || 0), 0),
          };
        }).filter(v => v.pairs.length > 0 || v.orphans.length > 0);
      });
    } catch (e) {
      setError(e.message || 'Fout bij markeren');
      await loadPending();
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        for (const id of invoiceIds) next.delete(id);
        return next;
      });
    }
  }

  // Excel export van de hele werklijst
  async function exportToExcel() {
    if (!vendors || vendors.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const XLSX = await import('xlsx');
      const rows = [];
      let groupCounter = 0;
      for (const v of vendors) {
        for (const pair of v.pairs) {
          groupCounter++;
          for (const side of ['positive', 'negative']) {
            const inv = pair[side];
            rows.push({
              'Vendor naam': v.name,
              'Vendor #': v.id,
              'Groep #': `G${groupCounter}`,
              '+/-': side === 'positive' ? '+' : '−',
              'Factuurnummer': inv.invoice_number,
              'Voucher': inv.voucher,
              'Type': inv.type,
              'Saldo': parseFloat(inv.balance),
              'Factuurdatum': inv.invoice_date || '',
              'Auto-matched sinds': inv.last_status_change ? fmtDateTime(inv.last_status_change) : '',
              'Verwerkt in Eagle': '',
            });
          }
        }
        for (const o of v.orphans) {
          groupCounter++;
          rows.push({
            'Vendor naam': v.name,
            'Vendor #': v.id,
            'Groep #': `O${groupCounter}`,
            '+/-': parseFloat(o.balance) >= 0 ? '+' : '−',
            'Factuurnummer': o.invoice_number,
            'Voucher': o.voucher,
            'Type': o.type,
            'Saldo': parseFloat(o.balance),
            'Factuurdatum': o.invoice_date || '',
            'Auto-matched sinds': o.last_status_change ? fmtDateTime(o.last_status_change) : '',
            'Verwerkt in Eagle': '',
          });
        }
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      // Kolom-breedtes
      ws['!cols'] = [
        { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 4 },
        { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 20 }, { wch: 16 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Eagle Sync werklijst');
      const dt = new Date().toISOString().substring(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `eagle_sync_werklijst_${dt}.xlsx`);
    } catch (e) {
      setError(`Export fout: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

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
          <p className="text-[14px] text-[#1B3A5C]">Bezig met laden...</p>
        </div>
      )}

      {!loading && vendors && vendors.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <span className="text-5xl block mb-3">🎉</span>
          <p className="text-[15px] font-semibold text-[#1B3A5C] mb-1">Alles in Eagle gesynchroniseerd</p>
          <p className="text-[13px] text-[#1B3A5C]/60">
            Geen openstaande Eagle-updates{isClerk && <> binnen jouw vendors</>}.
            Bevestig nieuwe auto-matches op de{' '}
            <Link href="/dashboard/finance/sandbox-ap/auto-match" className="font-semibold underline hover:no-underline">
              auto-match werklijst
            </Link>.
          </p>
        </div>
      )}

      {!loading && vendors && vendors.length > 0 && (
        <>
          <StatsBar
            vendorCount={vendors.length}
            totalRows={totalRows}
            totalPairs={totalPairs}
            totalOrphans={totalOrphans}
            totalAmount={totalAmount}
            oldestAgeText={oldestAgeText}
            onRefresh={loadPending}
            onExport={exportToExcel}
            exporting={exporting}
          />

          {vendors.map(v => (
            <VendorCard
              key={v.id}
              vendor={v}
              processingIds={processingIds}
              onMarkProcessed={markProcessed}
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
        <Link href="/dashboard/finance/sandbox-ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
        <span>›</span>
        <span>Eagle Sync</span>
      </div>
      <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        Eagle Sync werklijst
      </h1>
      <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
        Auto-matches die nog in Eagle moeten worden doorgevoerd
      </p>
    </div>
  );
}

function IntroCard({ isClerk, effectiveName }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
      <span className="text-xl flex-shrink-0">🔄</span>
      <div className="text-[12px] text-amber-900">
        <p className="font-semibold mb-1">Hoe werkt synchronisatie?</p>
        <ol className="leading-relaxed list-decimal ml-5 space-y-0.5">
          <li>Bevestig auto-match op de{' '}
            <Link href="/dashboard/finance/sandbox-ap/auto-match" className="font-semibold underline hover:no-underline">
              auto-match werklijst
            </Link> — beide facturen worden &quot;In portal afgeletterd&quot;.
          </li>
          <li>Boek dezelfde aflettering door in Eagle (facturen tegen elkaar wegboeken).</li>
          <li>Bij de volgende Compass-upload detecteert het systeem automatisch dat de vouchers
            niet meer in de export staan → status wordt &quot;Betaald&quot;.</li>
        </ol>
        <p className="mt-2">
          Deze pagina toont wat momenteel tussen stap 1 en stap 3 hangt — Eagle moet nog bijgewerkt worden.
          {isClerk && <> Je ziet alleen je eigen toegewezen vendors ({effectiveName}).</>}
        </p>
      </div>
    </div>
  );
}

function StatsBar({ vendorCount, totalRows, totalPairs, totalOrphans, totalAmount, oldestAgeText, onRefresh, onExport, exporting }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shadow-sm flex items-center gap-6 flex-wrap">
      <Stat label="Vendors" value={vendorCount} />
      <Stat label="Facturen" value={totalRows} sublabel={`${totalPairs} ${totalPairs === 1 ? 'paar' : 'paren'}${totalOrphans > 0 ? `, ${totalOrphans} los` : ''}`} />
      <Stat label="Totaal saldo" value={`XCG ${fmtMoney(totalAmount)}`} isText />
      {oldestAgeText && (
        <Stat label="Oudste wachtend" value={oldestAgeText} isText color="amber" />
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onExport}
          disabled={exporting}
          className="px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[12px] font-semibold hover:bg-[#264a73] transition-all disabled:opacity-50"
        >
          {exporting ? 'Exporteren...' : '📥 Exporteer Excel'}
        </button>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-[12px] text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:bg-gray-100 transition-all"
        >
          ↻ Verversen
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, sublabel, isText, color }) {
  const valColor = color === 'amber' ? 'text-amber-700' : 'text-[#1B3A5C]';
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#1B3A5C]/40 font-semibold">{label}</p>
      <p className={`${isText ? 'text-[15px]' : 'text-[20px]'} font-bold ${valColor}`} style={{ fontFamily: isText ? undefined : 'Playfair Display, Georgia, serif' }}>
        {value}
      </p>
      {sublabel && <p className="text-[10px] text-[#1B3A5C]/50">{sublabel}</p>}
    </div>
  );
}

function VendorCard({ vendor, processingIds, onMarkProcessed }) {
  const allIds = [
    ...vendor.pairs.flatMap(p => [p.positive.id, p.negative.id]),
    ...vendor.orphans.map(o => o.id),
  ];
  const anyBusy = allIds.some(id => processingIds.has(id));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">📦</span>
            <h3 className="text-[15px] font-bold text-[#1B3A5C]">{vendor.name}</h3>
            <span className="text-[11px] text-[#1B3A5C]/40 font-mono">#{vendor.id}</span>
          </div>
          <p className="text-[12px] text-[#1B3A5C]/60 mt-0.5">
            {vendor.pairs.length} {vendor.pairs.length === 1 ? 'paar' : 'paren'}
            {vendor.orphans.length > 0 && <>, {vendor.orphans.length} los</>} ·
            totaal saldo XCG {fmtMoney(vendor.totalAmount)}
            {vendor.oldestChange && <> · sinds {fmtDateTime(vendor.oldestChange)}</>}
          </p>
        </div>
        <button
          onClick={() => onMarkProcessed(allIds, `vendor ${vendor.name} (#${vendor.id})`)}
          disabled={anyBusy}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50"
          title="Markeer alle facturen van deze vendor als verwerkt in Eagle (status wordt 'betaald')"
        >
          {anyBusy ? 'Bezig...' : `✓ Markeer alle ${allIds.length} verwerkt`}
        </button>
      </div>

      <div className="space-y-2">
        {vendor.pairs.map((pair, i) => (
          <PairRow key={`p-${i}`} pair={pair}
            isBusy={processingIds.has(pair.positive.id) || processingIds.has(pair.negative.id)}
            onMarkProcessed={() => onMarkProcessed([pair.positive.id, pair.negative.id], `pair ${pair.positive.invoice_number}+${pair.negative.invoice_number}`)} />
        ))}
        {vendor.orphans.map((inv, i) => (
          <OrphanRow key={`o-${i}`} inv={inv}
            isBusy={processingIds.has(inv.id)}
            onMarkProcessed={() => onMarkProcessed([inv.id], `orphan ${inv.invoice_number}`)} />
        ))}
      </div>
    </div>
  );
}

function PairRow({ pair, isBusy, onMarkProcessed }) {
  return (
    <div className="rounded-lg border bg-[#f8fafc] border-gray-200 p-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-3">
        <InvoiceRow label="+" inv={pair.positive} positive />
        <InvoiceRow label="−" inv={pair.negative} positive={false} />
      </div>
      <button
        onClick={onMarkProcessed}
        disabled={isBusy}
        className="flex-shrink-0 px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-200 disabled:opacity-50"
        title="Markeer dit paar als verwerkt in Eagle"
      >
        {isBusy ? '...' : '✓ verwerkt'}
      </button>
    </div>
  );
}

function OrphanRow({ inv, isBusy, onMarkProcessed }) {
  const isPos = parseFloat(inv.balance) >= 0;
  return (
    <div className="rounded-lg border bg-gray-50 border-gray-200 p-3 flex items-center gap-2 text-[12px]">
      <span className="w-5 h-5 rounded flex items-center justify-center font-bold flex-shrink-0 bg-gray-200 text-gray-600">
        {isPos ? '+' : '−'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[#1B3A5C] truncate" title={inv.invoice_number}>
          {inv.invoice_number}
          <span className="font-mono text-[10px] text-[#1B3A5C]/40 ml-1.5">v.{inv.voucher}</span>
          <span className="ml-2 text-[10px] text-amber-700 italic">paar mogelijk al deels verwerkt</span>
        </p>
        <p className="text-[11px] text-[#1B3A5C]/60">{inv.type} · datum {fmtDate(inv.invoice_date)}</p>
      </div>
      <p className={`font-mono font-bold text-[13px] ${isPos ? 'text-emerald-700' : 'text-rose-700'}`}>
        {isPos ? '+' : ''}{fmtMoney(parseFloat(inv.balance))}
      </p>
      <button
        onClick={onMarkProcessed}
        disabled={isBusy}
        className="flex-shrink-0 px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-200 disabled:opacity-50"
        title="Markeer als verwerkt in Eagle"
      >
        {isBusy ? '...' : '✓ verwerkt'}
      </button>
    </div>
  );
}

function InvoiceRow({ label, inv, positive }) {
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
        <p className="text-[11px] text-[#1B3A5C]/60">{inv.type} · datum {fmtDate(inv.invoice_date)}</p>
      </div>
      <p className={`font-mono font-bold text-[13px] ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
        {positive ? '+' : ''}{fmtMoney(parseFloat(inv.balance))}
      </p>
    </div>
  );
}
