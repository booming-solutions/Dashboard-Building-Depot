/* ============================================================
   BESTAND: page_overzicht.js
   KOPIEER NAAR: src/app/dashboard/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmtM = n => { const a = Math.abs(n||0); return (n<0?'-':'') + (a >= 1e6 ? (a/1e6).toFixed(2)+'M' : (a/1e3).toFixed(0)+'K') };
const fmtP = n => (n||0).toFixed(1)+'%';

export default function OverviewPage() {
  const [salesData, setSalesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastDate, setLastDate] = useState(null);
  const supabase = createClient();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const { data: md } = await supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1);
      if (md && md.length) setLastDate(new Date(md[0].sale_date));

      const currentYear = 2026;
      const currentMonth = new Date().getMonth() + 1;
      let allSales = [], from = 0;
      const step = 1000;
      while (true) {
        const { data: b } = await supabase.from('sales_monthly').select('*').order('year').order('month').range(from, from + step - 1);
        if (!b || !b.length) break;
        allSales = allSales.concat(b);
        if (b.length < step) break;
        from += step;
      }

      const cyData = allSales.filter(r => r.year === currentYear && r.store_number === '1');
      const cyMonth = cyData.filter(r => r.month === currentMonth);
      const cyYTD = cyData.filter(r => r.month <= currentMonth);
      const lyData = allSales.filter(r => r.year === currentYear - 1 && r.store_number === '1');
      const lyMonth = lyData.filter(r => r.month === currentMonth);
      const lyYTD = lyData.filter(r => r.month <= currentMonth);

      const sum = (a, k) => a.reduce((s, r) => s + parseFloat(r[k] || 0), 0);

      setSalesData({
        monthSales: sum(cyMonth, 'net_sales'),
        monthGM: sum(cyMonth, 'gross_margin'),
        monthGMpct: sum(cyMonth, 'net_sales') ? sum(cyMonth, 'gross_margin') / sum(cyMonth, 'net_sales') * 100 : 0,
        monthLySales: sum(lyMonth, 'net_sales'),
        ytdSales: sum(cyYTD, 'net_sales'),
        ytdGM: sum(cyYTD, 'gross_margin'),
        ytdGMpct: sum(cyYTD, 'net_sales') ? sum(cyYTD, 'gross_margin') / sum(cyYTD, 'net_sales') * 100 : 0,
        ytdLySales: sum(lyYTD, 'net_sales'),
        currentMonth,
      });
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const totalBudget = 21776079;
  const totalInvY = 21316338;
  const invPct = (totalInvY / totalBudget * 100);
  const pctChg = (c, p) => p ? ((c - p) / Math.abs(p) * 100) : 0;

  return (
    <div className="max-w-[1520px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 mb-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Logo" className="h-12 rounded-lg" />
          <div>
            <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: '24px', fontWeight: 900 }}>Dashboard Overzicht</h1>
            <p className="text-[13px] text-[#6b5240]">Building Depot{lastDate ? ` — data t/m ${lastDate.getDate()} ${MN[lastDate.getMonth()]} ${lastDate.getFullYear()}` : ''}</p>
          </div>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">Curaçao · XCG</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Dashboard laden...</p></div>
      ) : (
        <>
          <div className="mb-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📈</span>
              <h2 className="text-[16px] font-bold text-[#1a0a04]">Omzet & Marge</h2>
              <span className="text-[11px] text-[#6b5240] ml-1">— {MN[(salesData?.currentMonth || 1) - 1]} 2026 · Curaçao</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Netto Omzet (Mnd)', value: fmtM(salesData?.monthSales), sub: `LY: ${fmtM(salesData?.monthLySales)}`, pct: salesData?.monthLySales > 0 ? pctChg(salesData.monthSales, salesData.monthLySales) : null, color: '#E84E1B' },
                { label: 'Bruto Marge % (Mnd)', value: fmtP(salesData?.monthGMpct), sub: `Marge: ${fmtM(salesData?.monthGM)}`, pct: null, color: '#E84E1B' },
                { label: 'Netto Omzet (YTD)', value: fmtM(salesData?.ytdSales), sub: `LY: ${fmtM(salesData?.ytdLySales)}`, pct: salesData?.ytdLySales > 0 ? pctChg(salesData.ytdSales, salesData.ytdLySales) : null, color: '#d97706' },
                { label: 'Bruto Marge % (YTD)', value: fmtP(salesData?.ytdGMpct), sub: `Marge: ${fmtM(salesData?.ytdGM)}`, pct: null, color: '#d97706' },
              ].map((kpi, i) => (
                <Link key={i} href="/dashboard/sales" className="block group">
                  <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                    <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: kpi.color }} />
                    <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{kpi.label}</p>
                    <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{kpi.value}</p>
                    <p className="text-[13px] text-[#6b5240] font-mono mt-1">{kpi.sub}</p>
                    {kpi.pct !== null && <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${kpi.pct >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{kpi.pct >= 0 ? '+' : ''}{fmtP(kpi.pct)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="mb-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📦</span>
              <h2 className="text-[16px] font-bold text-[#1a0a04]">Voorraad</h2>
              <span className="text-[11px] text-[#6b5240] ml-1">— Curaçao · per 26 Mrt 2026</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Voorraad Gisteren', value: fmtM(totalInvY), sub: `Budget: ${fmtM(totalBudget)}`, pct: pctChg(totalInvY, totalBudget), color: '#2563eb' },
                { label: "Budget Voorraad '26", value: fmtM(totalBudget), sub: `Verschil: ${fmtM(totalInvY - totalBudget)}`, pct: null, color: '#2563eb' },
                { label: '% van Budget', value: fmtP(invPct), sub: '64 departementen', pct: null, color: totalInvY > totalBudget ? '#d97706' : '#16a34a' },
              ].map((kpi, i) => (
                <Link key={i} href="/dashboard/inventory/budget" className="block group">
                  <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                    <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: kpi.color }} />
                    <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{kpi.label}</p>
                    <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{kpi.value}</p>
                    <p className="text-[13px] text-[#6b5240] font-mono mt-1">{kpi.sub}</p>
                    {kpi.pct !== null && <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${kpi.pct <= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{kpi.pct >= 0 ? '+' : ''}{fmtP(kpi.pct)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Snelle Links</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { href: '/dashboard/sales', icon: '📈', title: 'Omzet en Marge', desc: 'Volledig sales dashboard' },
                { href: '/dashboard/inventory/budget', icon: '📦', title: 'Voorraad vs Budget', desc: 'Inventory per department' },
                { href: '/dashboard/reports', icon: '📋', title: 'Rapportages', desc: 'Overzichten & exports' },
                { href: '/dashboard/files', icon: '📁', title: 'Bestanden', desc: 'Documenten & uploads' },
              ].map((link, i) => (
                <Link key={i} href={link.href} className="flex items-center gap-3 p-3 rounded-lg border border-[#e5ddd4] hover:border-[#E84E1B] hover:bg-[#faf5f0] transition-all">
                  <span className="text-xl">{link.icon}</span>
                  <div><p className="text-[13px] font-semibold">{link.title}</p><p className="text-[11px] text-[#6b5240]">{link.desc}</p></div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
