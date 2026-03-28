/* ============================================================
   BESTAND: page_index.js
   KOPIEER NAAR: src/app/dashboard/sales/index/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmt = n => (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtP = n => (n || 0).toFixed(1) + '%';
const SN = { '1': 'Curaçao', 'B': 'Bonaire' };

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
    <button className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ${active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]'}`} onClick={onClick}>{label}</button>
  );
}

function ValCell({ val, isMoney = true, isIndex = false, isDiff = false, className = '' }) {
  if (val === null || val === undefined || isNaN(val)) return <td className={`p-2 text-right font-mono text-[12px] border-b border-[#e5ddd4] ${className}`}>-</td>;
  let color = '#1a0a04';
  if (isIndex) color = val < 100 ? '#dc2626' : '#1a0a04';
  else if (isDiff) color = val < 0 ? '#dc2626' : '#1a0a04';
  let display;
  if (isIndex) display = Math.round(val);
  else if (isMoney) display = fmt(Math.round(val));
  else display = fmtP(val);
  return <td className={`p-2 text-right font-mono text-[12px] border-b border-[#e5ddd4] ${className}`} style={{ color }}>{display}</td>;
}

/* ── Reusable data row ── */
function DataRow({ d, bg = 'bg-white', bold = false, label = null, colSpanLabel = false }) {
  const cls = bold ? 'font-bold' : '';
  const bdr = bold ? 'border-b-2 border-[#c5bfb3]' : 'border-b border-[#f0ebe5]';
  return (
    <tr className={`${bg} hover:bg-[#faf5f0]`}>
      {colSpanLabel ? (
        <td colSpan={2} className={`p-2 text-[12px] ${cls} ${bdr} border-r border-[#e5ddd4]`}>{label}</td>
      ) : (
        <>
          <td className={`p-2 text-[12px] text-[#6b5240] ${bdr} font-mono`}>{d.deptCode || ''}</td>
          <td className={`p-2 text-[12px] ${cls} ${bdr} border-r border-[#e5ddd4] truncate max-w-[220px]`} title={d.deptName}>{label || d.deptName?.replace(/^\d+\s*/, '')}</td>
        </>
      )}
      <ValCell val={d.mtdBudgetSales} className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdSales2026} className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdDiffBudget} isDiff className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdIndexBudget} isIndex className={`${cls} ${bdr} border-r border-[#e5ddd4]`} />
      <ValCell val={d.totalBudgetMonth} className={`${cls} ${bdr}`} />
      <ValCell val={d.remainingBudget} isDiff className={`${cls} ${bdr}`} />
      <ValCell val={d.remainingPct} isMoney={false} isDiff className={`${cls} ${bdr} border-r border-[#e5ddd4]`} />
      <ValCell val={d.ytdIndex} isIndex className={`${cls} ${bdr} border-r border-[#e5ddd4]`} />
      <ValCell val={d.mtdPriorSales} className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdSales2026} className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdDiffPrior} isDiff className={`${cls} ${bdr}`} />
      <ValCell val={d.mtdIndexPrior} isIndex className={`${cls} ${bdr}`} />
    </tr>
  );
}

/* ── Sum helper ── */
function sumRows(rows) {
  const t = { mtdBudgetSales: 0, mtdSales2026: 0, mtdDiffBudget: 0, totalBudgetMonth: 0, remainingBudget: 0, mtdPriorSales: 0, mtdDiffPrior: 0, _ytdSales: 0, _ytdBudget: 0 };
  rows.forEach(r => { t.mtdBudgetSales += r.mtdBudgetSales; t.mtdSales2026 += r.mtdSales2026; t.mtdDiffBudget += r.mtdDiffBudget; t.totalBudgetMonth += r.totalBudgetMonth; t.remainingBudget += r.remainingBudget; t.mtdPriorSales += r.mtdPriorSales; t.mtdDiffPrior += r.mtdDiffPrior; t._ytdSales += (r._ytdSales || 0); t._ytdBudget += (r._ytdBudget || 0); });
  t.mtdIndexBudget = t.mtdBudgetSales ? (t.mtdSales2026 / t.mtdBudgetSales) * 100 : 0;
  t.remainingPct = t.totalBudgetMonth ? (t.remainingBudget / t.totalBudgetMonth * 100) : 0;
  t.ytdIndex = t._ytdBudget ? (t._ytdSales / t._ytdBudget) * 100 : 0;
  t.mtdIndexPrior = t.mtdPriorSales ? (t.mtdSales2026 / t.mtdPriorSales) * 100 : 0;
  return t;
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
  const [view, setView] = useState('bu');
  const [isYTD, setIsYTD] = useState(false);
  const [sortCol, setSortCol] = useState('mtdSales2026');
  const [sortDir, setSortDir] = useState('desc');

  const supabase = createClient();
  useEffect(() => { loadData(); checkAuth(); }, []);
  useEffect(() => { if (isAdmin) setCgfUnlocked(true); }, [isAdmin]);

  async function loadData() {
    let allSales = [], allBudget = [], from = 0;
    const step = 1000;
    while (true) { const { data: b } = await supabase.from('sales_monthly').select('*').order('year').order('month').range(from, from + step - 1); if (!b || !b.length) break; allSales = allSales.concat(b); if (b.length < step) break; from += step; }
    from = 0;
    while (true) { const { data: b } = await supabase.from('budget_data').select('*').range(from, from + step - 1); if (!b || !b.length) break; allBudget = allBudget.concat(b); if (b.length < step) break; from += step; }
    const { data: corr } = await supabase.from('corrections').select('*').order('created_at', { ascending: false });
    const { data: md } = await supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1);
    if (md && md.length) { const d = md[0].sale_date; const [y, m, day] = d.split('-').map(Number); setLastDate(new Date(y, m - 1, day)); }
    setData(allSales); setBudgetData(allBudget); if (corr) setCorrections(corr); setLoading(false);
  }
  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(); setIsAdmin(prof?.role === 'admin'); }
  }

  const currentYear = year, priorYear = year - 1;
  const isBonaire = store === 'B';
  const salesType = budgetMode === 'target' ? 'target_sales' : 'cgf_sales';
  const marginType = budgetMode === 'target' ? 'target_margin' : 'cgf_margin';
  const stores = useMemo(() => [...new Set(data.map(r => r.store_number))].sort(), [data]);
  const years = useMemo(() => [...new Set(data.map(r => r.year))].sort(), [data]);

  const dayFrac = useMemo(() => {
    if (!lastDate) return { month: 0, frac: 1, year: 0 };
    return { month: lastDate.getMonth() + 1, frac: lastDate.getDate() / new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0).getDate(), year: lastDate.getFullYear() };
  }, [lastDate]);

  function needsProrate(m) {
    if (!dayFrac.month || dayFrac.frac >= 0.99) return false;
    return m === dayFrac.month && dayFrac.year === currentYear;
  }

  /* ── Core data ── */
  const reportData = useMemo(() => {
    if (!data.length) return { departments: [], buTotals: {}, grandTotal: null };
    const sf = r => (store === 'all' || r.store_number === store);
    const monthsRange = isYTD ? Array.from({ length: month }, (_, i) => i + 1) : [month];

    const curRows = data.filter(r => sf(r) && r.year === currentYear && monthsRange.includes(r.month));
    const priorRows = data.filter(r => sf(r) && r.year === priorYear && monthsRange.includes(r.month));
    const curCorr = corrections.filter(c => sf(c) && c.year === currentYear && monthsRange.includes(c.month));

    const periodBudget = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by, bm] = b.month.split('-').map(Number);
      return by === currentYear && monthsRange.includes(bm);
    });
    const ytdBudgetRows = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by, bm] = b.month.split('-').map(Number);
      return by === currentYear && bm <= month;
    });
    const ytdSalesRows = data.filter(r => sf(r) && r.year === currentYear && r.month <= month);
    const fullYearBudget = budgetData.filter(b => {
      if (store !== 'all' && b.store_number !== store) return false;
      const [by] = b.month.split('-').map(Number);
      return by === currentYear;
    });

    function aggS(rows) { const a = {}; rows.forEach(r => { const k = r.dept_code; if (!a[k]) a[k] = { s: 0, m: 0, dept_code: r.dept_code, dept_name: r.dept_name, bum: r.bum }; a[k].s += parseFloat(r.net_sales || 0); a[k].m += parseFloat(r.gross_margin || 0); }); return a; }
    function aggC(rows) { const a = {}; rows.forEach(c => { const k = c.dept_code; if (!a[k]) a[k] = { s: 0, m: 0, dept_code: c.dept_code, dept_name: c.dept_name, bum: c.bum }; a[k].s += parseFloat(c.sales_correction || 0); a[k].m += parseFloat(c.margin_correction || 0); }); return a; }
    function aggB(rows) { const a = {}; rows.forEach(b => { const k = b.dept_code; if (!a[k]) a[k] = { s: 0, m: 0 }; if (b.budget_type === salesType) a[k].s += parseFloat(b.amount || 0); if (b.budget_type === marginType) a[k].m += parseFloat(b.amount || 0); }); return a; }

    const curA = aggS(curRows), priorA = aggS(priorRows), corrA = aggC(curCorr);
    const budA = aggB(periodBudget), ytdCurA = aggS(ytdSalesRows), ytdBudA = aggB(ytdBudgetRows), fullBudA = aggB(fullYearBudget);
    const proFactor = needsProrate(month) ? dayFrac.frac : 1;

    const allCodes = new Set([...Object.keys(curA), ...Object.keys(priorA), ...Object.keys(budA), ...Object.keys(corrA)]);
    const departments = [];

    allCodes.forEach(dc => {
      const cur = curA[dc] || { s: 0, m: 0 }, cor = corrA[dc] || { s: 0, m: 0 }, pri = priorA[dc] || { s: 0, m: 0 };
      const bud = budA[dc] || { s: 0, m: 0 }, ytdC = ytdCurA[dc] || { s: 0, m: 0 }, ytdB = ytdBudA[dc] || { s: 0, m: 0 }, fB = fullBudA[dc] || { s: 0, m: 0 };

      const pBudS = isYTD ? bud.s : bud.s * proFactor;
      const pPriS = isYTD ? pri.s : pri.s * proFactor;
      const sales = cur.s + cor.s;
      const totBud = isYTD ? fB.s : bud.s;
      const bumName = cur.bum || cor.bum || pri.bum || '';
      const deptName = cur.dept_name || cor.dept_name || pri.dept_name || dc;

      departments.push({
        deptCode: dc, deptName, bum: bumName, buName: BU_MAP[bumName] || 'OTHER',
        mtdBudgetSales: pBudS, mtdSales2026: sales,
        mtdDiffBudget: sales - pBudS,
        mtdIndexBudget: pBudS ? (sales / pBudS) * 100 : 0,
        totalBudgetMonth: totBud,
        remainingBudget: sales - totBud,
        remainingPct: totBud ? ((sales - totBud) / totBud * 100) : 0,
        _ytdSales: ytdC.s, _ytdBudget: ytdB.s,
        ytdIndex: ytdB.s ? (ytdC.s / ytdB.s) * 100 : 0,
        mtdPriorSales: pPriS,
        mtdDiffPrior: sales - pPriS,
        mtdIndexPrior: pPriS ? (sales / pPriS) * 100 : 0,
      });
    });

    departments.sort((a, b) => {
      const ai = BU_ORDER.indexOf(a.bum), bi = BU_ORDER.indexOf(b.bum);
      if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return (parseInt(a.deptCode) || 0) - (parseInt(b.deptCode) || 0);
    });

    const buTotals = {};
    BU_ORDER.forEach(bum => { const depts = departments.filter(d => d.bum === bum); if (depts.length) buTotals[bum] = sumRows(depts); });
    const grandTotal = sumRows(departments);
    return { departments, buTotals, grandTotal };
  }, [data, budgetData, corrections, store, year, month, salesType, marginType, dayFrac, currentYear, priorYear, isYTD]);

  const monthName = MN[month - 1] || '';
  const periodLabel = isYTD ? `Jan - ${monthName}` : monthName;
  const storeName = store === 'all' ? 'Alle' : SN[store] || store;
  const colLabel = isYTD ? 'YTD' : 'MTD';

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Index rapport laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  /* ── Sorting for dept view ── */
  function toggleSort(col) { if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortCol(col); setSortDir('desc'); } }
  const sortedDepts = [...reportData.departments].sort((a, b) => {
    const av = a[sortCol] || 0, bv = b[sortCol] || 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const buGroups = BU_ORDER.map(bum => ({ bum, buName: BU_MAP[bum], departments: reportData.departments.filter(d => d.bum === bum), total: reportData.buTotals[bum] })).filter(g => g.departments.length > 0);

  const bumGroups = useMemo(() => {
    const allBums = [...new Set(reportData.departments.map(d => d.bum))].filter(Boolean);
    allBums.sort((a, b) => { const ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); });
    return allBums.map(bum => ({ bum, buName: BU_MAP[bum] || '', departments: reportData.departments.filter(d => d.bum === bum), total: sumRows(reportData.departments.filter(d => d.bum === bum)) }));
  }, [reportData.departments]);

  /* ── Shared table header ── */
  function THead({ sortable = false }) {
    const thCls = "text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] whitespace-nowrap";
    const sc = sortable ? 'cursor-pointer hover:text-[#E84E1B]' : '';
    const sC = sortable ? toggleSort : () => {};
    const arr = (c) => sortable && sortCol === c ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
    return (
      <thead>
        <tr className="bg-[#1B3A5C]">
          <th colSpan={2} className="p-0 border-r border-[#2a4f75]" />
          <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">{colLabel} Sales {periodLabel}</th>
          <th colSpan={3} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">{isYTD ? `Totaal Budget ${year}` : `Total Budget ${year} ${monthName}`}</th>
          <th className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">Index YTD</th>
          <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">{colLabel} Sales Vergelijking</th>
        </tr>
        <tr className="bg-[#f0ebe5]">
          <th className={`text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] w-[40px] ${sc}`} onClick={() => sC('deptCode')}>DEP{arr('deptCode')}</th>
          <th className={`text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.5px] border-b-2 border-[#e5ddd4] min-w-[200px] border-r border-[#e5ddd4] ${sc}`} onClick={() => sC('deptName')}>Departement{arr('deptName')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdBudgetSales')}>Budget{arr('mtdBudgetSales')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdSales2026')}>{year}{arr('mtdSales2026')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdDiffBudget')}>Diff{arr('mtdDiffBudget')}</th>
          <th className={`${thCls} border-r border-[#e5ddd4] ${sc}`} onClick={() => sC('mtdIndexBudget')}>Index {colLabel}{arr('mtdIndexBudget')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('totalBudgetMonth')}>Totaal Bud{arr('totalBudgetMonth')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('remainingBudget')}>Remaining{arr('remainingBudget')}</th>
          <th className={`${thCls} border-r border-[#e5ddd4] ${sc}`} onClick={() => sC('remainingPct')}>in %{arr('remainingPct')}</th>
          <th className={`${thCls} border-r border-[#e5ddd4] ${sc}`} onClick={() => sC('ytdIndex')}>YTD Idx{arr('ytdIndex')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdPriorSales')}>{priorYear}{arr('mtdPriorSales')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdSales2026')}>{year}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdDiffPrior')}>Diff{arr('mtdDiffPrior')}</th>
          <th className={`${thCls} ${sc}`} onClick={() => sC('mtdIndexPrior')}>Index{arr('mtdIndexPrior')}</th>
        </tr>
      </thead>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Index Rapport</h1>
          <p className="text-[13px] text-[#6b5240]">Building Depot — {storeName}{lastDate ? ` — data t/m ${lastDate.getDate()} ${MN[lastDate.getMonth()]} ${lastDate.getFullYear()}` : ''}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{isBonaire ? `${storeName} · US$` : `${storeName} · XCG`}</div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span>
          <div className="flex gap-1">{stores.map(s => <Pill key={s} label={SN[s] || s} active={store === s} onClick={() => setStore(s)} />)}</div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Jaar</span>
          <div className="flex gap-1">{years.map(y => <Pill key={y} label={y + ''} active={currentYear === y} onClick={() => setYear(y)} />)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Maand</span>
          <div className="flex gap-1 flex-wrap">{MN.map((m, i) => <Pill key={i} label={m} active={month === i + 1} onClick={() => setMonth(i + 1)} />)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Budget</span>
          <div className="flex gap-1">
            <Pill label="Target" active={budgetMode === 'target'} onClick={() => setBudgetMode('target')} />
            {cgfUnlocked && <Pill label="CGF" active={budgetMode === 'cgf'} onClick={() => setBudgetMode('cgf')} />}
          </div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Periode</span>
          <div className="flex gap-1">
            <Pill label="MTD" active={!isYTD} onClick={() => setIsYTD(false)} />
            <Pill label="YTD" active={isYTD} onClick={() => setIsYTD(true)} />
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['bu', 'Per BU'], ['dept', 'Per Departement'], ['bum', 'Per Manager']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ${view === k ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ═══ VIEW: PER BU ═══ */}
      {view === 'bu' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
              <THead />
              <tbody>
                {reportData.grandTotal && <DataRow d={reportData.grandTotal} bg="bg-[#faf7f4]" bold colSpanLabel label="TOTAAL" />}
                {buGroups.map(g => g.total && (
                  <DataRow key={`bs-${g.bum}`} d={g.total} bg="bg-[#f5f0ea]"
                    colSpanLabel label={<><span className="font-semibold">{g.buName}</span><span className="text-[#6b5240] font-normal"> — Resp: {g.bum}</span></>} />
                ))}
                <tr><td colSpan={14} className="h-3 bg-[#faf7f4]" /></tr>
                {buGroups.map(g => (
                  <React.Fragment key={`bg-${g.bum}`}>
                    <tr className="bg-[#1B3A5C]/5">
                      <td colSpan={14} className="p-3 border-b border-[#c5d4e6] border-t-2 border-[#1B3A5C]/20">
                        <div className="flex items-center gap-3">
                          <span className="text-[14px] font-bold text-[#1B3A5C]">{g.buName}</span>
                          <span className="text-[12px] text-[#6b5240]">Responsible: {g.bum}</span>
                        </div>
                      </td>
                    </tr>
                    {g.departments.map((d, i) => <DataRow key={d.deptCode} d={d} bg={i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]'} />)}
                    {g.total && <DataRow d={g.total} bg="bg-[#f5f0ea]" bold colSpanLabel label={<span className="italic text-[#6b5240]">TOTAAL {g.buName.replace('BU-', '')}</span>} />}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ VIEW: PER DEPARTEMENT ═══ */}
      {view === 'dept' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
              <THead sortable />
              <tbody>
                {reportData.grandTotal && <DataRow d={reportData.grandTotal} bg="bg-[#faf7f4]" bold colSpanLabel label="TOTAAL" />}
                {sortedDepts.map((d, i) => (
                  <tr key={d.deptCode} className={`hover:bg-[#faf5f0] ${i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]'}`}>
                    <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" title={d.deptName}>
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[180px]">{d.deptName?.replace(/^\d+\s*/, '')}</span>
                        <span className="text-[10px] text-[#a08a74] whitespace-nowrap">({d.bum})</span>
                      </div>
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
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ VIEW: PER MANAGER (BUM) ═══ */}
      {view === 'bum' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
              <THead />
              <tbody>
                {reportData.grandTotal && <DataRow d={reportData.grandTotal} bg="bg-[#faf7f4]" bold colSpanLabel label="TOTAAL ALLE MANAGERS" />}
                <tr><td colSpan={14} className="h-3 bg-[#faf7f4]" /></tr>
                {bumGroups.map(g => (
                  <React.Fragment key={`bum-${g.bum}`}>
                    <tr className="bg-[#1B3A5C]/5">
                      <td colSpan={14} className="p-3 border-b border-[#c5d4e6] border-t-2 border-[#1B3A5C]/20">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-[#E84E1B] text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">{g.bum.charAt(0)}</span>
                          <div>
                            <span className="text-[14px] font-bold text-[#1B3A5C]">{g.bum}</span>
                            {g.buName && <span className="text-[11px] text-[#6b5240] ml-2">— {g.buName}</span>}
                          </div>
                          <div className="ml-auto flex items-center gap-4 text-[11px]">
                            <span className="text-[#6b5240]">{g.departments.length} dept.</span>
                            <span className={`font-bold font-mono ${g.total.mtdIndexBudget < 100 ? 'text-red-600' : 'text-green-700'}`}>Index: {Math.round(g.total.mtdIndexBudget)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                    <DataRow d={g.total} bg="bg-[#f5f0ea]" bold colSpanLabel label={<span className="font-bold">TOTAAL {g.bum.toUpperCase()}</span>} />
                    {g.departments.map((d, i) => <DataRow key={d.deptCode} d={d} bg={i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]'} />)}
                    <tr><td colSpan={14} className="h-2" /></tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-6 text-[11px] text-[#6b5240]">
          <div className="flex items-center gap-2"><span className="font-bold">Index</span><span>= (Actueel / Budget) × 100</span></div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }} /><span>Index &lt; 100</span></div>
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#1a0a04' }} /><span>Index ≥ 100</span></div>
          <div className="flex items-center gap-2"><span className="font-bold">MTD</span><span>= Month-To-Date</span></div>
          <div className="flex items-center gap-2"><span className="font-bold">YTD</span><span>= Year-To-Date (Jan t/m {monthName})</span></div>
        </div>
      </div>
    </div>
  );
}
