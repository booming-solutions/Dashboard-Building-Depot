/* ============================================================
   BESTAND: ap_page_v3.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/page.js
   (overschrijft v2, hernoemen naar page.js)

   WIJZIGINGEN T.O.V. v2:
   - Snelkoppelingen naar sub-pagina's toegevoegd (alleen Data Upload werkt nu)
   - Andere kaarten tonen "binnenkort"-state met grijze achtergrond
   - Database health-cards iets compacter
   ============================================================ */
'use client';

import { useApRole } from './layout';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

export default function APDashboard() {
  const {
    actualName, actualRole,
    effectiveName, effectiveRole, effectiveBums,
    isPlayingRole
  } = useApRole();

  const [vendorCount, setVendorCount] = useState(null);
  const [invoiceCount, setInvoiceCount] = useState(null);
  const [openInvoiceCount, setOpenInvoiceCount] = useState(null);
  const [totalOpen, setTotalOpen] = useState(null);

  useEffect(() => {
    async function loadStats() {
      const supabase = createClient();
      const { count: vc } = await supabase.from('ap_vendors').select('*', { count: 'exact', head: true });
      setVendorCount(vc);

      const { count: ic } = await supabase.from('ap_invoices').select('*', { count: 'exact', head: true });
      setInvoiceCount(ic);

      const { count: oc } = await supabase
        .from('ap_invoices')
        .select('*', { count: 'exact', head: true })
        .not('status', 'in', '(paid,disappeared_from_export)');
      setOpenInvoiceCount(oc);

      const { data: openRows } = await supabase
        .from('ap_invoices')
        .select('balance')
        .not('status', 'in', '(paid,disappeared_from_export)');
      if (openRows) {
        const total = openRows.reduce((s, r) => s + parseFloat(r.balance || 0), 0);
        setTotalOpen(total);
      }
    }
    loadStats();
  }, []);

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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Vendors" value={vendorCount} sublabel="in master" />
        <StatCard label="Totaal facturen" value={invoiceCount} sublabel="historisch" />
        <StatCard label="Openstaand" value={openInvoiceCount} sublabel="actief in werkstroom" />
        <StatCard
          label="Openstaand bedrag"
          value={totalOpen === null ? null : `XCG ${fmtMoney(totalOpen)}`}
          sublabel="te betalen"
          isText
        />
      </div>

      {/* Snelkoppelingen naar sub-pagina's */}
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
          <ActionCard icon="🏦" label="Bank-bestanden" desc="MCB FEP + RBC export" />
          <ActionCard icon="🔄" label="Afletteren" desc="Verdwenen + voltooide batches" />
          <ActionCard icon="📋" label="Audit log" desc="Volledig actie-spoor" />
        </div>
      </div>

      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 p-4">
        <p className="text-[12px] text-[#1B3A5C]/70">
          <strong>Status:</strong> Data Upload werkt — Compass CSV's kunnen worden ingelezen.
          De andere modules worden stap voor stap toegevoegd.
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

function ActionCard({ href, icon, label, desc, available }) {
  if (available && href) {
    return (
      <Link
        href={href}
        className="flex items-start gap-3 p-3 bg-[#f8fafc] rounded-lg border border-gray-200 hover:border-[#1B3A5C]/30 hover:bg-white transition-all group"
      >
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-[#1B3A5C] group-hover:text-[#152e4a]">{label}</p>
          <p className="text-[11px] text-[#1B3A5C]/50">{desc}</p>
        </div>
        <span className="text-[#1B3A5C]/30 group-hover:text-[#1B3A5C]/60">→</span>
      </Link>
    );
  }
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 opacity-60">
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
