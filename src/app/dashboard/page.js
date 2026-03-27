'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmtM = n => { const a = Math.abs(n||0); return (n<0?'-':'') + (a >= 1e6 ? (a/1e6).toFixed(2)+'M' : (a/1e3).toFixed(0)+'K') };
const fmtP = n => (n||0).toFixed(1)+'%';
const SN = {'1':'Curaçao','B':'Bonaire'};

export default function OverviewPage() {
  const [salesData, setSalesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastDate, setLastDate] = useState(null);
  const supabase = createClient();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      // Get last date
      const { data: md } = await supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1);
      if (md && md.length) setLastDate(new Date(md[0].sale_date));

      // Get current year sales summary
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

      // Current year, current month, Curaçao
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
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  // Inventory static data (same as inventory page)
  const totalBudget = 21776079;
  const totalInvY = 21316338;
  const invPct = (totalInvY / totalBudget * 100);

  const pctChg = (c, p) => p ? ((c - p) / Math.abs(p) * 100) : 0;

  return (
    <div className="max-w-[1520px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>

      {/* Header */}
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
          {/* Omzet Section */}
          <div className="mb-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📈</span>
              <h2 className="text-[16px] font-bold text-[#1a0a04]">Omzet & Marge</h2>
              <span className="text-[11px] text-[#6b5240] ml-1">— {MN[(salesData?.currentMonth || 1) - 1]} 2026 · Curaçao</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Link href="/dashboard/sales" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Netto Omzet (Mnd)</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtM(salesData?.monthSales)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">LY: {fmtM(salesData?.monthLySales)}</p>
                  {salesData?.monthLySales > 0 && <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${pctChg(salesData.monthSales, salesData.monthLySales) >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{pctChg(salesData.monthSales, salesData.monthLySales) >= 0 ? '+' : ''}{fmtP(pctChg(salesData.monthSales, salesData.monthLySales))}</span>}
                </div>
              </Link>

              <Link href="/dashboard/sales" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Bruto Marge % (Mnd)</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtP(salesData?.monthGMpct)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">Marge: {fmtM(salesData?.monthGM)}</p>
                </div>
              </Link>

              <Link href="/dashboard/sales" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#d97706]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Netto Omzet (YTD)</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtM(salesData?.ytdSales)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">LY: {fmtM(salesData?.ytdLySales)}</p>
                  {salesData?.ytdLySales > 0 && <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${pctChg(salesData.ytdSales, salesData.ytdLySales) >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{pctChg(salesData.ytdSales, salesData.ytdLySales) >= 0 ? '+' : ''}{fmtP(pctChg(salesData.ytdSales, salesData.ytdLySales))}</span>}
                </div>
              </Link>

              <Link href="/dashboard/sales" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#d97706]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Bruto Marge % (YTD)</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtP(salesData?.ytdGMpct)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">Marge: {fmtM(salesData?.ytdGM)}</p>
                </div>
              </Link>
            </div>
          </div>

          {/* Voorraad Section */}
          <div className="mb-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">📦</span>
              <h2 className="text-[16px] font-bold text-[#1a0a04]">Voorraad</h2>
              <span className="text-[11px] text-[#6b5240] ml-1">— Curaçao · per 26 Mrt 2026</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Link href="/dashboard/inventory/budget" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#2563eb]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Voorraad Gisteren</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtM(totalInvY)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">Budget: {fmtM(totalBudget)}</p>
                  <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${totalInvY <= totalBudget ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{totalInvY <= totalBudget ? '' : '+'}{fmtP(pctChg(totalInvY, totalBudget))}</span>
                </div>
              </Link>

              <Link href="/dashboard/inventory/budget" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#2563eb]" />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Budget Voorraad '26</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtM(totalBudget)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">Verschil: {fmtM(totalInvY - totalBudget)}</p>
                </div>
              </Link>

              <Link href="/dashboard/inventory/budget" className="block group">
                <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm group-hover:border-[#E84E1B] group-hover:shadow-md transition-all cursor-pointer">
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: totalInvY > totalBudget ? '#d97706' : '#16a34a' }} />
                  <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">% van Budget</p>
                  <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{fmtP(invPct)}</p>
                  <p className="text-[13px] text-[#6b5240] font-mono mt-1">64 departementen</p>
                </div>
              </Link>
            </div>
          </div>

          {/* Quick links */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Snelle Links</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Link href="/dashboard/sales" className="flex items-center gap-3 p-3 rounded-lg border border-[#e5ddd4] hover:border-[#E84E1B] hover:bg-[#faf5f0] transition-all">
                <span className="text-xl">📈</span>
                <div><p className="text-[13px] font-semibold">Omzet en Marge</p><p className="text-[11px] text-[#6b5240]">Volledig sales dashboard</p></div>
              </Link>
              <Link href="/dashboard/inventory/budget" className="flex items-center gap-3 p-3 rounded-lg border border-[#e5ddd4] hover:border-[#E84E1B] hover:bg-[#faf5f0] transition-all">
                <span className="text-xl">📦</span>
                <div><p className="text-[13px] font-semibold">Voorraad vs Budget</p><p className="text-[11px] text-[#6b5240]">Inventory per department</p></div>
              </Link>
              <Link href="/dashboard/reports" className="flex items-center gap-3 p-3 rounded-lg border border-[#e5ddd4] hover:border-[#E84E1B] hover:bg-[#faf5f0] transition-all">
                <span className="text-xl">📋</span>
                <div><p className="text-[13px] font-semibold">Rapportages</p><p className="text-[11px] text-[#6b5240]">Overzichten & exports</p></div>
              </Link>
              <Link href="/dashboard/files" className="flex items-center gap-3 p-3 rounded-lg border border-[#e5ddd4] hover:border-[#E84E1B] hover:bg-[#faf5f0] transition-all">
                <span className="text-xl">📁</span>
                <div><p className="text-[13px] font-semibold">Bestanden</p><p className="text-[11px] text-[#6b5240]">Documenten & uploads</p></div>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
