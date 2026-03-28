/* ============================================================
   BESTAND: page_index.js
   KOPIEER NAAR: src/app/dashboard/sales/index/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmt = n => (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtP = n => (n || 0).toFixed(1) + '%';
const SN = { '1': 'Curaçao', 'B': 'Bonaire' };

// BU mapping: manager (bum) → BU name
const BU_MAP = {
  'Pascal': 'BU-BUILDING MATERIALS',
  'Henk': 'BU-FLOORING-SANITARY-KITCHEN',
  'John': 'BU-HARDWARE',
  'Daniel': 'BU-HOUSEHOLD-APPLIANCES',
  'Gijs': 'BU-FURNITURE-DECORATION',
};

const BU_ORDER = ['Pascal', 'Henk', 'John', 'Daniel', 'Gijs'];

function Pill({ label, active, onClick }) {
  return (
    <button
      className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ${
        active
          ? 'bg-[#E84E1B] text-white border-[#E84E1B]'
          : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ValCell({ val, isMoney = true, isIndex = false, isDiff = false, className = '' }) {
  if (val === null || val === undefined || isNaN(val)) {
    return <td className={`p-2 text-right font-mono text-[12px] border-b border-[#e5ddd4] ${className}`}>-</td>;
  }
  
  let color = '#1a0a04';
  if (isIndex) {
    color = val < 100 ? '#dc2626' : '#1a0a04';
  } else if (isDiff) {
    color = val < 0 ? '#dc2626' : '#1a0a04';
  }

  let display;
  if (isIndex) {
    display = Math.round(val);
  } else if (isMoney) {
    display = fmt(Math.round(val));
  } else {
    display = fmtP(val);
  }

  return (
    <td className={`p-2 text-right font-mono text-[12px] border-b border-[#e5ddd4] ${className}`} style={{ color }}>
      {display}
    </td>
  );
}

export default function IndexDashboard() {
  const [data, setData] = useState([]);
  const [budgetData, setBudgetData] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [lastDate, setLastDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState('1');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [budgetMode, setBudgetMode] = useState('target');
  const [cgfUnlocked, setCgfUnlocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const supabase = createClient();

  useEffect(() => { loadData(); checkAuth(); }, []);

  // Auto-unlock CGF for admins
  useEffect(() => { if (isAdmin) setCgfUnlocked(true); }, [isAdmin]);

  async function loadData() {
    let allSales = [], allBudget = [], from = 0;
    const step = 1000;
    while (true) {
      const { data: b } = await supabase.from('sales_monthly').select('*').order('year').order('month').range(from, from + step - 1);
      if (!b || !b.length) break;
      allSales = allSales.concat(b);
      if (b.length < step) break;
      from += step;
    }
    from = 0;
    while (true) {
      const { data: b } = await supabase.from('budget_data').select('*').range(from, from + step - 1);
      if (!b || !b.length) break;
      allBudget = allBudget.concat(b);
      if (b.length < step) break;
      from += step;
    }
    const { data: corr } = await supabase.from('corrections').select('*').order('created_at', { ascending: false });
    const { data: md } = await supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1);
    if (md && md.length) {
      const d = md[0].sale_date;
      const [y, m, day] = d.split('-').map(Number);
      setLastDate(new Date(y, m - 1, day));
    }
    setData(allSales);
    setBudgetData(allBudget);
    if (corr) setCorrections(corr);
    setLoading(false);
  }

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsAdmin(prof?.role === 'admin');
    }
  }

  const currentYear = year;
  const priorYear = year - 1;
  const isBonaire = store === 'B';
  const curr = isBonaire ? 'US$' : 'XCG';
  const salesType = budgetMode === 'target' ? 'target_sales' : 'cgf_sales';
  const marginType = budgetMode === 'target' ? 'target_margin' : 'cgf_margin';
  const budgetLabel = budgetMode === 'target' ? 'Target' : 'CGF';

  const stores = useMemo(() => [...new Set(data.map(r => r.store_number))].sort(), [data]);
  const years = useMemo(() => [...new Set(data.map(r => r.year))].sort(), [data]);

  // Day fraction for prorating current month
  const dayFrac = useMemo(() => {
    if (!lastDate) return { month: 0, frac: 1, year: 0 };
    return {
      month: lastDate.getMonth() + 1,
      frac: lastDate.getDate() / new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0).getDate(),
      year: lastDate.getFullYear(),
    };
  }, [lastDate]);

  // Determine the max data month for current year
  const maxDataMonth = useMemo(() => {
    let m = 0;
    data.forEach(r => { if (r.year === currentYear && r.month > m) m = r.month; });
    return m;
  }, [data, currentYear]);

  // Check if a specific month needs prorating
  function needsProrate(m) {
    if (!dayFrac.month || dayFrac.frac >= 0.99) return false;
    if (m !== dayFrac.month || dayFrac.year !== currentYear) return false;
    return true;
  }

  // Build the index report data
  const reportData = useMemo(() => {
    if (!data.length) return { departments: [], buTotals: {}, grandTotal: null };

    // Filter sales for selected store
    const storeFilter = r => (store === 'all' || r.store_number === store);

    // --- MTD (selected month) ---
    const mtdCurrent = data.filter(r => storeFilter(r) && r.year === currentYear && r.month === month);
    const mtdPrior = data.filter(r => storeFilter(r) && r.year === priorYear && r.month === month);

    // MTD corrections
    const mtdCorr = corrections.filter(c => storeFilter(c) && c.year === currentYear && c.month === month);
    const mtdCorrPrior = corrections.filter(c => storeFilter(c) && c.year === priorYear && c.month === month);

    // MTD Budget for selected month
    const mtdBudget = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by, bm] = b.month.split('-').map(Number);
      return by === currentYear && bm === month;
    });

    // --- YTD (months 1..month) ---
    const ytdCurrent = data.filter(r => storeFilter(r) && r.year === currentYear && r.month <= month);
    const ytdBudget = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by, bm] = b.month.split('-').map(Number);
      return by === currentYear && bm <= month;
    });

    // --- Full year budget ---
    const fullYearBudget = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by] = b.month.split('-').map(Number);
      return by === currentYear;
    });

    // Helper: aggregate by dept
    function aggByDept(rows, salesKey = 'net_sales', marginKey = 'gross_margin') {
      const agg = {};
      rows.forEach(r => {
        const key = r.dept_code || r.dept_name;
        if (!agg[key]) agg[key] = { sales: 0, margin: 0, dept_code: r.dept_code, dept_name: r.dept_name, bum: r.bum };
        agg[key].sales += parseFloat(r[salesKey] || 0);
        agg[key].margin += parseFloat(r[marginKey] || 0);
      });
      return agg;
    }

    function aggBudgetByDept(rows) {
      const agg = {};
      rows.forEach(b => {
        const key = b.dept_code;
        if (!agg[key]) agg[key] = { sales: 0, margin: 0, dept_code: b.dept_code };
        if (b.budget_type === salesType) agg[key].sales += parseFloat(b.amount || 0);
        if (b.budget_type === marginType) agg[key].margin += parseFloat(b.amount || 0);
      });
      return agg;
    }

    function aggCorrByDept(rows) {
      const agg = {};
      rows.forEach(c => {
        const key = c.dept_code;
        if (!agg[key]) agg[key] = { sales: 0, margin: 0, dept_code: c.dept_code, dept_name: c.dept_name, bum: c.bum };
        agg[key].sales += parseFloat(c.sales_correction || 0);
        agg[key].margin += parseFloat(c.margin_correction || 0);
      });
      return agg;
    }

    const curAgg = aggByDept(mtdCurrent);
    const priorAgg = aggByDept(mtdPrior);
    const budAgg = aggBudgetByDept(mtdBudget);
    const corrAgg = aggCorrByDept(mtdCorr);

    const ytdCurAgg = aggByDept(ytdCurrent);
    const ytdBudAgg = aggBudgetByDept(ytdBudget);
    const fullBudAgg = aggBudgetByDept(fullYearBudget);

    // Prorate current month budget & prior year if needed
    const prorateFactor = needsProrate(month) ? dayFrac.frac : 1;

    // Get all department codes
    const allDeptCodes = new Set();
    [...Object.keys(curAgg), ...Object.keys(priorAgg), ...Object.keys(budAgg), ...Object.keys(corrAgg)].forEach(k => allDeptCodes.add(k));

    // Build department rows
    const departments = [];
    allDeptCodes.forEach(deptCode => {
      const cur = curAgg[deptCode] || { sales: 0, margin: 0 };
      const corr = corrAgg[deptCode] || { sales: 0, margin: 0 };
      const prior = priorAgg[deptCode] || { sales: 0, margin: 0 };
      const bud = budAgg[deptCode] || { sales: 0, margin: 0 };
      const ytdCur = ytdCurAgg[deptCode] || { sales: 0, margin: 0 };
      const ytdBud = ytdBudAgg[deptCode] || { sales: 0, margin: 0 };
      const fullBud = fullBudAgg[deptCode] || { sales: 0, margin: 0 };

      // Apply proration to budget for current month
      const proratedBudSales = bud.sales * prorateFactor;
      const proratedPriorSales = prior.sales * prorateFactor;

      const mtdSales = cur.sales + corr.sales;
      const mtdPriorSales = proratedPriorSales;
      const mtdBudgetSales = proratedBudSales;
      const mtdDiffBudget = mtdSales - mtdBudgetSales;
      const mtdIndexBudget = mtdBudgetSales ? (mtdSales / mtdBudgetSales) * 100 : 0;

      // Total budget for this month (full month, not prorated)
      const totalBudgetMonth = bud.sales;
      const remainingBudget = mtdSales - totalBudgetMonth;
      const remainingPct = totalBudgetMonth ? (remainingBudget / totalBudgetMonth) * 100 : 0;

      // YTD index vs budget
      const ytdSales = ytdCur.sales;
      const ytdBudgetSales = ytdBud.sales;
      const ytdIndex = ytdBudgetSales ? (ytdSales / ytdBudgetSales) * 100 : 0;

      // MTD vs prior year
      const mtdDiffPrior = mtdSales - mtdPriorSales;
      const mtdIndexPrior = mtdPriorSales ? (mtdSales / mtdPriorSales) * 100 : 0;

      // Determine BUM (manager) from data
      const bumName = cur.bum || corr.bum || prior.bum || '';
      const deptName = cur.dept_name || corr.dept_name || prior.dept_name || deptCode;

      departments.push({
        deptCode,
        deptName,
        bum: bumName,
        buName: BU_MAP[bumName] || 'OTHER',
        mtdBudgetSales: mtdBudgetSales,
        mtdSales2026: mtdSales,
        mtdDiffBudget,
        mtdIndexBudget: Math.round(mtdIndexBudget),
        totalBudgetMonth,
        remainingBudget,
        remainingPct,
        ytdIndex: Math.round(ytdIndex),
        mtdPriorSales,
        mtdDiffPrior,
        mtdIndexPrior: Math.round(mtdIndexPrior),
      });
    });

    // Sort by BU order, then dept code
    departments.sort((a, b) => {
      const aIdx = BU_ORDER.indexOf(a.bum);
      const bIdx = BU_ORDER.indexOf(b.bum);
      if (aIdx !== bIdx) return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      return (parseInt(a.deptCode) || 0) - (parseInt(b.deptCode) || 0);
    });

    // Calculate BU totals
    const buTotals = {};
    BU_ORDER.forEach(bum => {
      const buDepts = departments.filter(d => d.bum === bum);
      if (!buDepts.length) return;
      const total = {
        bum,
        buName: BU_MAP[bum],
        mtdBudgetSales: buDepts.reduce((s, d) => s + d.mtdBudgetSales, 0),
        mtdSales2026: buDepts.reduce((s, d) => s + d.mtdSales2026, 0),
        mtdDiffBudget: buDepts.reduce((s, d) => s + d.mtdDiffBudget, 0),
        totalBudgetMonth: buDepts.reduce((s, d) => s + d.totalBudgetMonth, 0),
        remainingBudget: buDepts.reduce((s, d) => s + d.remainingBudget, 0),
        mtdPriorSales: buDepts.reduce((s, d) => s + d.mtdPriorSales, 0),
        mtdDiffPrior: buDepts.reduce((s, d) => s + d.mtdDiffPrior, 0),
      };
      total.mtdIndexBudget = total.mtdBudgetSales ? Math.round((total.mtdSales2026 / total.mtdBudgetSales) * 100) : 0;
      total.remainingPct = total.totalBudgetMonth ? (total.remainingBudget / total.totalBudgetMonth * 100) : 0;
      // YTD for BU
      const buYtdSales = buDepts.reduce((s, d) => {
        const ytd = ytdCurAgg[d.deptCode];
        return s + (ytd ? ytd.sales : 0);
      }, 0);
      const buYtdBudget = buDepts.reduce((s, d) => {
        const ytd = ytdBudAgg[d.deptCode];
        return s + (ytd ? ytd.sales : 0);
      }, 0);
      total.ytdIndex = buYtdBudget ? Math.round((buYtdSales / buYtdBudget) * 100) : 0;
      total.mtdIndexPrior = total.mtdPriorSales ? Math.round((total.mtdSales2026 / total.mtdPriorSales) * 100) : 0;
      buTotals[bum] = total;
    });

    // Grand total
    const allDepts = departments;
    const grandTotal = {
      mtdBudgetSales: allDepts.reduce((s, d) => s + d.mtdBudgetSales, 0),
      mtdSales2026: allDepts.reduce((s, d) => s + d.mtdSales2026, 0),
      mtdDiffBudget: allDepts.reduce((s, d) => s + d.mtdDiffBudget, 0),
      totalBudgetMonth: allDepts.reduce((s, d) => s + d.totalBudgetMonth, 0),
      remainingBudget: allDepts.reduce((s, d) => s + d.remainingBudget, 0),
      mtdPriorSales: allDepts.reduce((s, d) => s + d.mtdPriorSales, 0),
      mtdDiffPrior: allDepts.reduce((s, d) => s + d.mtdDiffPrior, 0),
    };
    grandTotal.mtdIndexBudget = grandTotal.mtdBudgetSales ? Math.round((grandTotal.mtdSales2026 / grandTotal.mtdBudgetSales) * 100) : 0;
    grandTotal.remainingPct = grandTotal.totalBudgetMonth ? (grandTotal.remainingBudget / grandTotal.totalBudgetMonth * 100) : 0;
    const gtYtdSales = allDepts.reduce((s, d) => {
      const ytd = ytdCurAgg[d.deptCode];
      return s + (ytd ? ytd.sales : 0);
    }, 0);
    const gtYtdBudget = allDepts.reduce((s, d) => {
      const ytd = ytdBudAgg[d.deptCode];
      return s + (ytd ? ytd.sales : 0);
    }, 0);
    grandTotal.ytdIndex = gtYtdBudget ? Math.round((gtYtdSales / gtYtdBudget) * 100) : 0;
    grandTotal.mtdIndexPrior = grandTotal.mtdPriorSales ? Math.round((grandTotal.mtdSales2026 / grandTotal.mtdPriorSales) * 100) : 0;

    return { departments, buTotals, grandTotal };
  }, [data, budgetData, corrections, store, year, month, salesType, marginType, dayFrac, currentYear, priorYear]);

  const monthName = MN[month - 1] || '';
  const storeName = store === 'all' ? 'Alle' : SN[store] || store;

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Index rapport laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  // Group departments by BU for rendering
  const buGroups = BU_ORDER.map(bum => ({
    bum,
    buName: BU_MAP[bum],
    departments: reportData.departments.filter(d => d.bum === bum),
    total: reportData.buTotals[bum],
  })).filter(g => g.departments.length > 0);

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>
            Index Rapport
          </h1>
          <p className="text-[13px] text-[#6b5240]">
            Building Depot — {storeName}{lastDate ? ` — data t/m ${lastDate.getDate()} ${MN[lastDate.getMonth()]} ${lastDate.getFullYear()}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">
            {isBonaire ? `${storeName} · US$` : `${storeName} · XCG`}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span>
          <div className="flex gap-1">
            {stores.map(s => <Pill key={s} label={SN[s] || s} active={store === s} onClick={() => setStore(s)} />)}
          </div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Jaar</span>
          <div className="flex gap-1">
            {years.map(y => <Pill key={y} label={y + ''} active={currentYear === y} onClick={() => setYear(y)} />)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Maand</span>
          <div className="flex gap-1 flex-wrap">
            {MN.map((m, i) => <Pill key={i} label={m} active={month === i + 1} onClick={() => setMonth(i + 1)} />)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Budget</span>
          <div className="flex gap-1">
            <Pill label="Target" active={budgetMode === 'target'} onClick={() => setBudgetMode('target')} />
            {cgfUnlocked && <Pill label="CGF" active={budgetMode === 'cgf'} onClick={() => setBudgetMode('cgf')} />}
          </div>
        </div>
      </div>

      {/* Index Table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
            <thead>
              {/* Column group headers */}
              <tr className="bg-[#1B3A5C]">
                <th colSpan={2} className="p-0 border-r border-[#2a4f75]" />
                <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">
                  MTD Sales {monthName}
                </th>
                <th colSpan={3} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">
                  Total Budget {year} {monthName}
                </th>
                <th className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">
                  Index YTD
                </th>
                <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">
                  MTD Sales Vergelijking
                </th>
              </tr>
              {/* Sub-headers */}
              <tr className="bg-[#f0ebe5]">
                <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] w-[40px]">DEP</th>
                <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] min-w-[200px] border-r border-[#e5ddd4]">Departement</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Budget<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">{year}<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Diff<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap border-r border-[#e5ddd4]">Index MTD<br/>Bud-{year}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Totaal<br/>Budget {year}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Remaining<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap border-r border-[#e5ddd4]">in %</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap border-r border-[#e5ddd4]">Budget<br/>{year}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">{priorYear}<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">{year}<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Diff<br/>{monthName}</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap">Index MTD<br/>{year}-{priorYear}</th>
              </tr>
            </thead>
            <tbody>
              {/* Grand Total Row */}
              {reportData.grandTotal && (
                <tr className="bg-[#faf7f4] font-bold border-b-2 border-[#1B3A5C]">
                  <td className="p-2 text-[12px] border-b border-[#c5d4e6]" />
                  <td className="p-2 text-[12px] font-bold border-b border-[#c5d4e6] border-r border-[#e5ddd4]">TOTAAL</td>
                  <ValCell val={reportData.grandTotal.mtdBudgetSales} className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdSales2026} className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdDiffBudget} isDiff className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdIndexBudget} isIndex className="font-bold border-b border-[#c5d4e6] border-r border-[#e5ddd4]" />
                  <ValCell val={reportData.grandTotal.totalBudgetMonth} className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.remainingBudget} isDiff className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.remainingPct} isMoney={false} isDiff className="font-bold border-b border-[#c5d4e6] border-r border-[#e5ddd4]" />
                  <ValCell val={reportData.grandTotal.ytdIndex} isIndex className="font-bold border-b border-[#c5d4e6] border-r border-[#e5ddd4]" />
                  <ValCell val={reportData.grandTotal.mtdPriorSales} className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdSales2026} className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdDiffPrior} isDiff className="font-bold border-b border-[#c5d4e6]" />
                  <ValCell val={reportData.grandTotal.mtdIndexPrior} isIndex className="font-bold border-b border-[#c5d4e6]" />
                </tr>
              )}

              {/* BU Summary Rows */}
              {buGroups.map(g => g.total && (
                <tr key={`bu-sum-${g.bum}`} className="bg-[#f5f0ea] hover:bg-[#efe8df]">
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4]" />
                  <td className="p-2 text-[11px] font-bold border-b border-[#e5ddd4] border-r border-[#e5ddd4] whitespace-nowrap">
                    {g.buName} — <span className="text-[#6b5240] font-normal">Resp: {g.bum}</span>
                  </td>
                  <ValCell val={g.total.mtdBudgetSales} className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdSales2026} className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdDiffBudget} isDiff className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdIndexBudget} isIndex className="font-semibold border-b border-[#e5ddd4] border-r border-[#e5ddd4]" />
                  <ValCell val={g.total.totalBudgetMonth} className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.remainingBudget} isDiff className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.remainingPct} isMoney={false} isDiff className="font-semibold border-b border-[#e5ddd4] border-r border-[#e5ddd4]" />
                  <ValCell val={g.total.ytdIndex} isIndex className="font-semibold border-b border-[#e5ddd4] border-r border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdPriorSales} className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdSales2026} className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdDiffPrior} isDiff className="font-semibold border-b border-[#e5ddd4]" />
                  <ValCell val={g.total.mtdIndexPrior} isIndex className="font-semibold border-b border-[#e5ddd4]" />
                </tr>
              ))}

              {/* Spacer */}
              <tr><td colSpan={14} className="h-3 bg-[#faf7f4]" /></tr>

              {/* Per-BU detail sections */}
              {buGroups.map(g => (
                <>
                  {/* BU Header */}
                  <tr key={`bu-hdr-${g.bum}`} className="bg-[#1B3A5C]/5">
                    <td colSpan={14} className="p-3 border-b border-[#c5d4e6] border-t-2 border-[#1B3A5C]/20">
                      <div className="flex items-center gap-3">
                        <span className="text-[14px] font-bold text-[#1B3A5C]">{g.buName}</span>
                        <span className="text-[12px] text-[#6b5240]">Responsible: {g.bum}</span>
                      </div>
                    </td>
                  </tr>

                  {/* Department rows */}
                  {g.departments.map((d, i) => (
                    <tr key={`dept-${d.deptCode}`} className={`hover:bg-[#faf5f0] ${i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]'}`}>
                      <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[220px]" title={d.deptName}>
                        {d.deptName?.replace(/^\d+\s*/, '')}
                      </td>
                      <ValCell val={d.mtdBudgetSales} className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdSales2026} className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdDiffBudget} isDiff className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdIndexBudget} isIndex className="border-b border-[#f0ebe5] border-r border-[#e5ddd4]" />
                      <ValCell val={d.totalBudgetMonth} className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.remainingBudget} isDiff className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.remainingPct} isMoney={false} isDiff className="border-b border-[#f0ebe5] border-r border-[#e5ddd4]" />
                      <ValCell val={d.ytdIndex} isIndex className="border-b border-[#f0ebe5] border-r border-[#e5ddd4]" />
                      <ValCell val={d.mtdPriorSales} className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdSales2026} className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdDiffPrior} isDiff className="border-b border-[#f0ebe5]" />
                      <ValCell val={d.mtdIndexPrior} isIndex className="border-b border-[#f0ebe5]" />
                    </tr>
                  ))}

                  {/* BU Subtotal */}
                  {g.total && (
                    <tr key={`bu-tot-${g.bum}`} className="bg-[#f5f0ea] border-t border-[#d4c9bc]">
                      <td className="p-2 text-[12px] border-b-2 border-[#c5bfb3]" />
                      <td className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4] italic text-[#6b5240]">TOTAAL {g.buName.replace('BU-','')}</td>
                      <ValCell val={g.total.mtdBudgetSales} className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdSales2026} className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdDiffBudget} isDiff className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdIndexBudget} isIndex className="font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]" />
                      <ValCell val={g.total.totalBudgetMonth} className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.remainingBudget} isDiff className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.remainingPct} isMoney={false} isDiff className="font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]" />
                      <ValCell val={g.total.ytdIndex} isIndex className="font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]" />
                      <ValCell val={g.total.mtdPriorSales} className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdSales2026} className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdDiffPrior} isDiff className="font-bold border-b-2 border-[#c5bfb3]" />
                      <ValCell val={g.total.mtdIndexPrior} isIndex className="font-bold border-b-2 border-[#c5bfb3]" />
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-6 text-[11px] text-[#6b5240]">
          <div className="flex items-center gap-2">
            <span className="font-bold">Index</span>
            <span>= (Actueel / Budget) × 100</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }} />
            <span>Index &lt; 100 (onder budget/vorig jaar)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#1a0a04' }} />
            <span>Index ≥ 100 (op of boven budget/vorig jaar)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold">MTD</span>
            <span>= Month-To-Date</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold">YTD</span>
            <span>= Year-To-Date</span>
          </div>
        </div>
      </div>
    </div>
  );
}
