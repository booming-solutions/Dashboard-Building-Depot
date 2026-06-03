/* ============================================================
   BESTAND: ap_page_v6.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/page.js
   (overschrijft v5, hernoemen naar page.js)

   WIJZIGINGEN T.O.V. v5:
   - Auto-match snelkoppeling is nu klikbaar (href naar werklijst)
   - Auto-match callout telt nu PAREN ipv vendors met som=0.
     De echte data heeft 0 vendors waar volledige som = 0, maar
     38 paren waar +X/-X tegen elkaar wegvallen — dat is wat we
     willen detecteren.
   - Algoritme matcht abs-bedragen in centen om floating-point
     issues te vermijden (zelfde logica als auto-match pagina).
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

      setStats({
        vendors: vc,
        invoices: ic,
        openInvoices,
        totalOpen,
        autoMatchVendors,
        autoMatchInvoices,
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

      {/* Snelkoppelingen */}
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
          <ActionCard icon="📄" label="Openstaande AP" desc="Filterbaar overzicht" />
          <ActionCard icon="✅" label="Werkstroom" desc="Selectie → Goedkeuring → Bank" />
          <ActionCard
            href="/dashboard/finance/ap/auto-match"
            icon="⚖️"
            label="Auto-match"
            desc="Compensaties zonder bank-betaling"
            badge={stats.autoMatchVendors > 0 ? `${stats.autoMatchVendors}` : null}
            available
          />
          <ActionCard icon="🏦" label="Bank-bestanden" desc="MCB FEP + RBC export" />
          <ActionCard icon="📋" label="Audit log" desc="Volledig actie-spoor" />
        </div>
      </div>

      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 p-4">
        <p className="text-[12px] text-[#1B3A5C]/70">
          <strong>Status:</strong> Data Upload werkt — Compass CSV's kunnen worden ingelezen.
          De werkstroom-pagina's worden stap voor stap toegevoegd.
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

function ActionCard({ href, icon, label, desc, available, badge }) {
  if (available && href) {
    return (
      <Link
        href={href}
        className="flex items-start gap-3 p-3 bg-[#f8fafc] rounded-lg border border-gray-200 hover:border-[#1B3A5C]/30 hover:bg-white transition-all group relative"
      >
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-[#1B3A5C] group-hover:text-[#152e4a]">{label}</p>
          <p className="text-[11px] text-[#1B3A5C]/50">{desc}</p>
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
