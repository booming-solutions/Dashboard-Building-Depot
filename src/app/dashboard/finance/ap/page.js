/* ============================================================
   BESTAND: ap_page_v8.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/page.js
   (overschrijft v7, hernoemen naar page.js)

   WIJZIGINGEN T.O.V. v7:
   - Werkstroom tegel werkend (href naar /werkstroom)
   - Voor AP Clerks: nieuwe callout als ze 'selected_by_ap' rijen
     hebben — herinnering dat ze nog moeten indienen bij goedkeurder
   - Telling 'selectedPending' (count selected_by_ap, gefilterd op clerk)
   ============================================================ */
'use client';

import { useApRole } from './layout';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

// Pagineer een Supabase query om de PostgREST 1000-rijen default te omzeilen.
// queryBuilder is een functie die elke iteratie een nieuwe query opbouwt.
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

export default function APDashboard() {
  const {
    actualName, actualRole,
    effectiveName, effectiveRole, effectiveBums, effectiveProfileId,
    isPlayingRole
  } = useApRole();

  const [stats, setStats] = useState({
    vendors: null,
    invoices: null,
    openInvoices: null,
    totalOpen: null,
    autoMatchVendors: null,
    autoMatchInvoices: null,
    eaglePending: null,
    selectedPending: null,
    pendingCandidates: null,
    confirmedCandidates: null,
  });

  useEffect(() => {
    async function loadStats() {
      const supabase = createClient();
      const isClerk = effectiveRole === 'ap_clerk';

      // Vendor master count (statisch, niet rol-afhankelijk in v1)
      const { count: vc } = await supabase
        .from('ap_vendors')
        .select('*', { count: 'exact', head: true });

      // Totaal facturen — voor admin/cfo/approver: alles. Voor clerk: alleen toegewezen
      let totalQuery = supabase.from('ap_invoices').select('*', { count: 'exact', head: true });
      if (isClerk) totalQuery = totalQuery.eq('assigned_ap_clerk', effectiveProfileId);
      const { count: ic } = await totalQuery;

      // Open facturen detail (voor som + auto-match analyse) - met pagination
      const openRows = await fetchAllPaginated(() => {
        let q = supabase
          .from('ap_invoices')
          .select('vendor_id, balance, assigned_ap_clerk')
          .not('status', 'in', '(paid,disappeared_from_export)');
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
        return q;
      });

      const openInvoices = openRows.length;
      const totalOpen = openRows.reduce((s, r) => s + parseFloat(r.balance || 0), 0);

      // Auto-match: detecteer paren binnen vendor waarbij +X / -X elkaar opheffen.
      // Match op centen om floating-point issues te vermijden.
      let autoMatchVendors = 0;
      let autoMatchInvoices = 0;
      const vendorGroups = {};
      for (const r of openRows) {
        const bal = parseFloat(r.balance || 0);
        if (bal === 0) continue;
        if (!vendorGroups[r.vendor_id]) vendorGroups[r.vendor_id] = [];
        vendorGroups[r.vendor_id].push(bal);
      }
      for (const [vid, amounts] of Object.entries(vendorGroups)) {
        if (amounts.length < 2) continue;
        const byAbs = {};
        for (const a of amounts) {
          const cents = Math.round(Math.abs(a) * 100);
          if (!byAbs[cents]) byAbs[cents] = { pos: 0, neg: 0 };
          if (a > 0) byAbs[cents].pos++;
          else byAbs[cents].neg++;
        }
        let vendorPairs = 0;
        for (const k in byAbs) {
          vendorPairs += Math.min(byAbs[k].pos, byAbs[k].neg);
        }
        if (vendorPairs > 0) {
          autoMatchVendors++;
          autoMatchInvoices += vendorPairs * 2;
        }
      }

      // Eagle Sync werklijst telling — auto_matched rijen (gefilterd op clerk)
      let eagleQuery = supabase
        .from('ap_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'auto_matched');
      if (isClerk) eagleQuery = eagleQuery.eq('assigned_ap_clerk', effectiveProfileId);
      const { count: ep } = await eagleQuery;

      // 'Klaar voor indiening' telling — selected_by_ap rijen (gefilterd op clerk)
      let selQuery = supabase
        .from('ap_invoices')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'selected_by_ap');
      if (isClerk) selQuery = selQuery.eq('assigned_ap_clerk', effectiveProfileId);
      const { count: sp } = await selQuery;

      // Pending match candidates (afletter werklijst)
      const { count: pc } = await supabase
        .from('ap_match_candidates')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Confirmed match candidates (te verwerken in Eagle)
      let confirmedCandidates = 0;
      if (isClerk) {
        const { data: cfList } = await supabase
          .from('ap_match_candidates')
          .select('invoice_id')
          .eq('status', 'confirmed');
        if (cfList && cfList.length > 0) {
          const invIds = cfList.map(r => r.invoice_id);
          const { data: invsForClerk } = await supabase.from('ap_invoices')
            .select('id')
            .in('id', invIds)
            .eq('assigned_ap_clerk', effectiveProfileId);
          confirmedCandidates = invsForClerk ? invsForClerk.length : 0;
        }
      } else {
        const { count: cf } = await supabase
          .from('ap_match_candidates')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'confirmed');
        confirmedCandidates = cf || 0;
      }

      setStats({
        vendors: vc,
        invoices: ic,
        openInvoices,
        totalOpen,
        autoMatchVendors,
        autoMatchInvoices,
        eaglePending: ep || 0,
        selectedPending: sp || 0,
        pendingCandidates: pc || 0,
        confirmedCandidates,
      });
    }
    loadStats();
  }, [effectiveProfileId, effectiveRole]);

  const isClerk = effectiveRole === 'ap_clerk';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Accounts Payable
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Crediteurenbeheer — werkstroom van factuur tot betaling
        </p>
      </div>

      {/* Welkom + role info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm mb-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#1B3A5C]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">
              {effectiveRole === 'admin' ? '👑' :
               effectiveRole === 'cfo' ? '💼' :
               effectiveRole === 'ap_approver' ? '✅' :
               effectiveRole === 'ap_clerk' ? '📋' : '👤'}
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-[16px] font-bold text-[#1B3A5C]">Welkom, {effectiveName}</h2>
            <p className="text-[12px] text-[#1B3A5C]/60">
              Rol: <span className="font-semibold">{effectiveRole}</span>
              {effectiveBums.length > 0 && (<> · BUMs: <span className="font-mono">{effectiveBums.join(', ')}</span></>)}
            </p>
            {isPlayingRole && (
              <p className="text-[11px] text-amber-700 mt-1.5 italic">
                Je bent eigenlijk {actualName} ({actualRole}) maar speelt nu {effectiveName}.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stats — labels passen aan op rol */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Vendor master"
          value={stats.vendors}
          sublabel="totaal in master"
        />
        <StatCard
          label={isClerk ? "Mijn facturen" : "Totaal facturen"}
          value={stats.invoices}
          sublabel={isClerk ? "toegewezen aan mij" : "historisch"}
        />
        <StatCard
          label={isClerk ? "Mijn openstaande" : "Openstaand"}
          value={stats.openInvoices}
          sublabel="actief in werkstroom"
        />
        <StatCard
          label={isClerk ? "Mijn openstaand bedrag" : "Openstaand bedrag"}
          value={stats.totalOpen === null ? null : `XCG ${fmtMoney(stats.totalOpen)}`}
          sublabel="te betalen"
          isText
        />
      </div>

      {/* Indienen herinnering — alleen voor AP Clerks met klaargezette selectie */}
      {isClerk && stats.selectedPending !== null && stats.selectedPending > 0 && (
        <Link
          href="/dashboard/finance/ap/werkstroom"
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center gap-4 hover:bg-blue-100 transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">📤</span>
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-blue-900">
              {stats.selectedPending} {stats.selectedPending === 1 ? 'factuur klaar' : 'facturen klaar'} voor indiening
            </p>
            <p className="text-[12px] text-blue-800">
              Je hebt deze facturen geselecteerd maar nog niet ingediend bij de goedkeurder.
            </p>
          </div>
          <span className="text-blue-700 group-hover:text-blue-900">Naar werkstroom →</span>
        </Link>
      )}

      {/* Eagle Sync callout — heeft prioriteit: dit is werk dat in Eagle nog gedaan moet worden */}
      {stats.eaglePending !== null && stats.eaglePending > 0 && (
        <Link
          href="/dashboard/finance/ap/eagle-sync"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-center gap-4 hover:bg-amber-100 transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">🔄</span>
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-amber-900">
              {stats.eaglePending} {stats.eaglePending === 1 ? 'factuur wacht' : 'facturen wachten'} op afletteren in Eagle
            </p>
            <p className="text-[12px] text-amber-800">
              {isClerk
                ? 'Boek deze paren in Eagle af. Bij de volgende Compass-upload wordt automatisch gedetecteerd dat het rond is.'
                : 'Auto-matches bevestigd in portal, nog niet in Eagle afgeletterd.'}
            </p>
          </div>
          <span className="text-amber-700 group-hover:text-amber-900">Bekijk werklijst →</span>
        </Link>
      )}

      {/* Auto-match callout — alleen tonen als er kandidaten zijn */}
      {stats.autoMatchVendors !== null && stats.autoMatchVendors > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">⚖️</span>
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-emerald-900">
              {stats.autoMatchVendors} {stats.autoMatchVendors === 1 ? 'vendor' : 'vendors'} met auto-match kandidaten
            </p>
            <p className="text-[12px] text-emerald-700">
              {stats.autoMatchInvoices} facturen waarvan de openstaande saldi tegen elkaar wegvallen — geen bank-betaling nodig
            </p>
          </div>
          <span className="text-[11px] text-emerald-700 italic">werklijst volgt</span>
        </div>
      )}

      {/* Reguliere snelkoppelingen */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm mb-4">
        <h3 className="text-[14px] font-bold text-[#1B3A5C] mb-3">Snelkoppelingen</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            href="/dashboard/finance/ap/upload"
            icon="📥"
            label="Data Upload"
            desc="Compass CSV inlezen"
            available
          />
          <ActionCard
            href="/dashboard/finance/ap/werkstroom"
            icon="✅"
            label="Werkstroom"
            desc="Selectie → Goedkeuring → Bank"
            available
          />
          <ActionCard
            href="/dashboard/finance/ap/auto-match"
            icon="⚖️"
            label="Auto-match"
            desc="Compensaties zonder bank-betaling"
            badge={stats.autoMatchVendors > 0 ? `${stats.autoMatchVendors}` : null}
            available
          />
          <ActionCard
            href="/dashboard/finance/ap/eagle-sync"
            icon="🔄"
            label="Eagle Sync"
            desc="Afletteren door te voeren in Eagle"
            badge={stats.eaglePending > 0 ? `${stats.eaglePending}` : null}
            available
          />
          <ActionCard icon="📋" label="Audit log" desc="Volledig actie-spoor" />
        </div>
      </div>

      {/* Project Clean Up - tijdelijke sectie */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-xl p-5 shadow-sm mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-[14px] font-bold text-amber-900 flex items-center gap-2">
              <span className="text-lg">🧹</span> Project Clean Up
            </h3>
            <p className="text-[11px] text-amber-800/70 mt-0.5">
              Tijdelijke werklijst — oude facturen die in werkelijkheid al betaald zijn afletteren.
              Sluit zodra alles is opgeruimd.
            </p>
          </div>
          {(stats.pendingCandidates > 0 || stats.confirmedCandidates > 0) && (
            <div className="text-right">
              <div className="text-[10px] uppercase text-amber-800/60 font-semibold">Open werklijst</div>
              <div className="text-[20px] font-bold text-amber-900">
                {(stats.pendingCandidates || 0) + (stats.confirmedCandidates || 0)}
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            href="/dashboard/finance/ap/match/pcs"
            icon="📊"
            label="PCS Import"
            desc="Payment Control Sheet inlezen voor matching"
            cleanup
            available
          />
          <ActionCard
            href="/dashboard/finance/ap/match/worklist"
            icon="🎯"
            label="Afletter werklijst"
            desc="Te bevestigen + te verwerken in Eagle"
            badge={(stats.pendingCandidates + stats.confirmedCandidates) > 0 ? `${stats.pendingCandidates + stats.confirmedCandidates}` : null}
            cleanup
            available
          />
          <ActionCard
            href="/dashboard/finance/ap/match/bank"
            icon="🏦"
            label="Bank Statement Import"
            desc="MCB + RBC PDF parsen voor automatische matching"
            cleanup
            available
          />
          <ActionCard
            icon="📨"
            label="Vendor Statements"
            desc="Aljoma e.a. statements (binnenkort)"
            cleanup
          />
        </div>
      </div>

      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 p-4">
        <p className="text-[12px] text-[#1B3A5C]/70">
          <strong>Status:</strong> Werkstroom + Auto-match + Eagle Sync werken voor nieuwe facturen.
          Project Clean Up loopt voor oude betaalde facturen — sluit als de werklijst leeg is.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, sublabel, isText }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-[#1B3A5C]/40 font-semibold mb-1">{label}</p>
      <p className={`${isText ? 'text-[18px]' : 'text-[24px]'} font-bold text-[#1B3A5C]`} style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        {value === null ? '—' : value}
      </p>
      <p className="text-[10px] text-[#1B3A5C]/50">{sublabel}</p>
    </div>
  );
}

function ActionCard({ href, icon, label, desc, available, badge, cleanup }) {
  const bgClass = cleanup ? 'bg-white/70' : 'bg-[#f8fafc]';
  const borderClass = cleanup ? 'border-amber-200 hover:border-amber-400' : 'border-gray-200 hover:border-[#1B3A5C]/30';
  const labelClass = cleanup ? 'text-amber-900 group-hover:text-amber-950' : 'text-[#1B3A5C] group-hover:text-[#152e4a]';
  const descClass = cleanup ? 'text-amber-800/60' : 'text-[#1B3A5C]/50';

  if (available && href) {
    return (
      <Link
        href={href}
        className={`flex items-start gap-3 p-3 ${bgClass} rounded-lg border ${borderClass} hover:bg-white transition-all group relative`}
      >
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="flex-1">
          <p className={`text-[13px] font-semibold ${labelClass}`}>{label}</p>
          <p className={`text-[11px] ${descClass}`}>{desc}</p>
        </div>
        {badge ? (
          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {badge}
          </span>
        ) : (
          <span className="text-[#1B3A5C]/30 group-hover:text-[#1B3A5C]/60">→</span>
        )}
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 opacity-60 relative">
      <span className="text-lg flex-shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-[#1B3A5C]/60">{label}</p>
        <p className="text-[11px] text-[#1B3A5C]/40">{desc}</p>
      </div>
      <span className="text-[10px] text-[#1B3A5C]/40 italic">binnenkort</span>
    </div>
  );
}

function fmtMoney(amount) {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
