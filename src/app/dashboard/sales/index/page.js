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
const BU_MAP = {
  'Pascal': 'BU-BUILDING MATERIALS', 'Henk': 'BU-FLOORING-SANITARY-KITCHEN',
  'John': 'BU-HARDWARE', 'Daniel': 'BU-HOUSEHOLD-APPLIANCES', 'Gijs': 'BU-FURNITURE-DECORATION',
};
const BU_ORDER = ['Pascal', 'Henk', 'John', 'Daniel', 'Gijs'];

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

function VC({ val, isIdx, isDf, className }) {
  if (val === null || val === undefined || isNaN(val)) return <td className={'p-1.5 text-right font-mono text-[11px] border-b border-[#e5ddd4] ' + (className || '')}>-</td>;
  var color = '#1a0a04';
  if (isIdx) color = val < 100 ? '#dc2626' : '#1a0a04';
  else if (isDf) color = val < 0 ? '#dc2626' : '#1a0a04';
  var display = isIdx ? Math.round(val) : fmt(Math.round(val));
  return <td className={'p-1.5 text-right font-mono text-[11px] border-b border-[#e5ddd4] ' + (className || '')} style={{ color: color }}>{display}</td>;
}

/* ── Data cells: MTD actual, diff bud, idx bud, diff ly, idx ly | YTD actual, diff bud, idx bud, diff ly, idx ly | Bud month, Bud YTD ── */
function RowCells({ d, bold }) {
  var c = bold ? ' font-bold' : '';
  var b = bold ? ' border-b-2 border-[#c5bfb3]' : ' border-b border-[#f0ebe5]';
  return (
    <>
      {/* MTD block */}
      <VC val={d.mtdActual} className={c + b} />
      <VC val={d.mtdBudget} className={c + b} />
      <VC val={d.mtdDiffBud} isDf className={c + b} />
      <VC val={d.mtdIdxBud} isIdx className={c + b} />
      <VC val={d.mtdLY} className={c + b} />
      <VC val={d.mtdDiffLY} isDf className={c + b} />
      <VC val={d.mtdIdxLY} isIdx className={c + b + ' border-r border-[#c5d4e6]'} />
      {/* YTD block */}
      <VC val={d.ytdActual} className={c + b} />
      <VC val={d.ytdBudget} className={c + b} />
      <VC val={d.ytdDiffBud} isDf className={c + b} />
      <VC val={d.ytdIdxBud} isIdx className={c + b} />
      <VC val={d.ytdLY} className={c + b} />
      <VC val={d.ytdDiffLY} isDf className={c + b} />
      <VC val={d.ytdIdxLY} isIdx className={c + b + ' border-r border-[#c5d4e6]'} />
      {/* Budget ref */}
      <VC val={d.budMonth} className={c + b} />
      <VC val={d.budYTD} className={c + b} />
    </>
  );
}

function THead({ monthName, year, priorYear, sortable, sortCol, sortDir, onSort }) {
  var th = 'p-1.5 text-[9px] text-[#6b5240] font-bold uppercase tracking-[0.3px] border-b-2 border-[#e5ddd4] whitespace-nowrap';
  var sc = sortable ? ' cursor-pointer hover:text-[#E84E1B]' : '';
  var fn = sortable ? onSort : undefined;
  var ar = function(c) { return sortable && sortCol === c ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''; };
  return (
    <thead>
      <tr className="bg-[#1B3A5C]">
        <th colSpan={2} className="p-0 border-r border-[#2a4f75]"></th>
        <th colSpan={7} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">{'MTD ' + monthName + ' ' + year}</th>
        <th colSpan={7} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">{'YTD Jan-' + monthName + ' ' + year}</th>
        <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5">Budget</th>
      </tr>
      <tr className="bg-[#f0ebe5]">
        <th className={'text-left ' + th + sc} onClick={fn ? function() { fn('deptCode'); } : undefined}>DEP{ar('deptCode')}</th>
        <th className={'text-left ' + th + ' min-w-[160px] border-r border-[#e5ddd4]' + sc} onClick={fn ? function() { fn('deptName'); } : undefined}>Departement{ar('deptName')}</th>
        {/* MTD */}
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdActual'); } : undefined}>Actual{ar('mtdActual')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdBudget'); } : undefined}>Budget{ar('mtdBudget')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdDiffBud'); } : undefined}>Diff{ar('mtdDiffBud')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdIdxBud'); } : undefined}>Idx{ar('mtdIdxBud')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdLY'); } : undefined}>{priorYear}{ar('mtdLY')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('mtdDiffLY'); } : undefined}>Diff{ar('mtdDiffLY')}</th>
        <th className={'text-right ' + th + ' border-r border-[#c5d4e6]' + sc} onClick={fn ? function() { fn('mtdIdxLY'); } : undefined}>Idx{ar('mtdIdxLY')}</th>
        {/* YTD */}
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdActual'); } : undefined}>Actual{ar('ytdActual')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdBudget'); } : undefined}>Budget{ar('ytdBudget')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdDiffBud'); } : undefined}>Diff{ar('ytdDiffBud')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdIdxBud'); } : undefined}>Idx{ar('ytdIdxBud')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdLY'); } : undefined}>{priorYear}{ar('ytdLY')}</th>
        <th className={'text-right ' + th + sc} onClick={fn ? function() { fn('ytdDiffLY'); } : undefined}>Diff{ar('ytdDiffLY')}</th>
        <th className={'text-right ' + th + ' border-r border-[#c5d4e6]' + sc} onClick={fn ? function() { fn('ytdIdxLY'); } : undefined}>Idx{ar('ytdIdxLY')}</th>
        {/* Budget ref */}
        <th className={'text-right ' + th}>{monthName}</th>
        <th className={'text-right ' + th}>YTD</th>
      </tr>
    </thead>
  );
}

function sumRows(rows) {
  var t = { mtdActual:0, mtdBudget:0, mtdLY:0, ytdActual:0, ytdBudget:0, ytdLY:0, budMonth:0, budYTD:0 };
  rows.forEach(function(r) {
    t.mtdActual += r.mtdActual || 0; t.mtdBudget += r.mtdBudget || 0; t.mtdLY += r.mtdLY || 0;
    t.ytdActual += r.ytdActual || 0; t.ytdBudget += r.ytdBudget || 0; t.ytdLY += r.ytdLY || 0;
    t.budMonth += r.budMonth || 0; t.budYTD += r.budYTD || 0;
  });
  t.mtdDiffBud = t.mtdActual - t.mtdBudget;
  t.mtdIdxBud = t.mtdBudget ? (t.mtdActual / t.mtdBudget) * 100 : 0;
  t.mtdDiffLY = t.mtdActual - t.mtdLY;
  t.mtdIdxLY = t.mtdLY ? (t.mtdActual / t.mtdLY) * 100 : 0;
  t.ytdDiffBud = t.ytdActual - t.ytdBudget;
  t.ytdIdxBud = t.ytdBudget ? (t.ytdActual / t.ytdBudget) * 100 : 0;
  t.ytdDiffLY = t.ytdActual - t.ytdLY;
  t.ytdIdxLY = t.ytdLY ? (t.ytdActual / t.ytdLY) * 100 : 0;
  return t;
}

export default function IndexDashboard() {
  var _s = useState, _e = useEffect, _m = useMemo, _cb = useCallback;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _b = _s([]), budgetData = _b[0], setBudgetData = _b[1];
  var _c = _s([]), corrections = _c[0], setCorrections = _c[1];
  var _ld = _s(null), lastDate = _ld[0], setLastDate = _ld[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _st = _s('1'), store = _st[0], setStore = _st[1];
  var _yr = _s(2026), year = _yr[0], setYear = _yr[1];
  var _mo = _s(new Date().getMonth() + 1), month = _mo[0], setMonth = _mo[1];
  var _bm = _s('target'), budgetMode = _bm[0], setBudgetMode = _bm[1];
  var _cu = _s(false), cgfUnlocked = _cu[0], setCgfUnlocked = _cu[1];
  var _ia = _s(false), isAdmin = _ia[0], setIsAdmin = _ia[1];
  var _vw = _s('bu'), view = _vw[0], setView = _vw[1];
  var _sc = _s('mtdActual'), sortCol = _sc[0], setSortCol = _sc[1];
  var _sd = _s('desc'), sortDir = _sd[0], setSortDir = _sd[1];

  var supabase = createClient();
  _e(function() { loadData(); checkAuth(); }, []);
  // CGF is only unlocked via the admin menu toggle
  _e(function() {
    function onCGFToggle() { setCgfUnlocked(function(u) { var nv = !u; if (!nv) setBudgetMode('target'); return nv; }); }
    window.addEventListener('toggle-cgf', onCGFToggle);
    return function() { window.removeEventListener('toggle-cgf', onCGFToggle); };
  }, []);

  async function loadData() {
    var allSales = [], allBudget = [], from = 0, step = 1000;
    while (true) { var r = await supabase.from('sales_monthly').select('*').order('year').order('month').range(from, from + step - 1); if (!r.data || !r.data.length) break; allSales = allSales.concat(r.data); if (r.data.length < step) break; from += step; }
    from = 0;
    while (true) { var r2 = await supabase.from('budget_data').select('*').range(from, from + step - 1); if (!r2.data || !r2.data.length) break; allBudget = allBudget.concat(r2.data); if (r2.data.length < step) break; from += step; }
    var cr = await supabase.from('corrections').select('*').order('created_at', { ascending: false });
    var md = await supabase.from('sales_data').select('sale_date').order('sale_date', { ascending: false }).limit(1);
    if (md.data && md.data.length) { var d2 = md.data[0].sale_date; var p = d2.split('-').map(Number); setLastDate(new Date(p[0], p[1] - 1, p[2])); }
    setData(allSales); setBudgetData(allBudget); if (cr.data) setCorrections(cr.data); setLoading(false);
  }
  async function checkAuth() {
    var u = await supabase.auth.getUser();
    if (u.data.user) { var pr = await supabase.from('profiles').select('role').eq('id', u.data.user.id).maybeSingle(); setIsAdmin(pr.data && pr.data.role === 'admin'); }
  }

  var currentYear = year, priorYear = year - 1;
  var salesType = budgetMode === 'target' ? 'target_sales' : 'cgf_sales';
  var marginType = budgetMode === 'target' ? 'target_margin' : 'cgf_margin';
  var stores = _m(function() { return [].concat(new Set(data.map(function(r) { return r.store_number; }))).sort(); }, [data]);
  var years = _m(function() { return [].concat(new Set(data.map(function(r) { return r.year; }))).sort(); }, [data]);
  var monthName = MN[month - 1] || '';
  var storeName = store === 'all' ? 'Alle' : (SN[store] || store);

  var dayFrac = _m(function() {
    if (!lastDate) return { month: 0, frac: 1, year: 0 };
    return { month: lastDate.getMonth() + 1, frac: lastDate.getDate() / new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0).getDate(), year: lastDate.getFullYear() };
  }, [lastDate]);

  /* ── Core data ── */
  var reportData = _m(function() {
    if (!data.length) return { departments: [], grandTotal: null, buTotals: {} };
    var sf = function(r) { return store === 'all' || r.store_number === store; };
    var mtdMonths = [month];
    var ytdMonths = [];
    for (var i = 1; i <= month; i++) ytdMonths.push(i);

    // Sales aggregation
    function aggS(rows) {
      var a = {};
      rows.forEach(function(r) {
        var k = r.dept_code;
        if (!a[k]) a[k] = { s: 0, dept_code: r.dept_code, dept_name: r.dept_name, bum: r.bum };
        a[k].s += parseFloat(r.net_sales || 0);
      });
      return a;
    }
    function aggB(rows, btype) {
      var a = {};
      rows.forEach(function(b) {
        if (b.budget_type !== btype) return;
        var k = b.dept_code;
        if (!a[k]) a[k] = 0;
        a[k] += parseFloat(b.amount || 0);
      });
      return a;
    }
    function aggC(rows) {
      var a = {};
      rows.forEach(function(c) {
        var k = c.dept_code;
        if (!a[k]) a[k] = { s: 0, dept_code: c.dept_code, dept_name: c.dept_name, bum: c.bum };
        a[k].s += parseFloat(c.sales_correction || 0);
      });
      return a;
    }

    // MTD
    var mtdCur = aggS(data.filter(function(r) { return sf(r) && r.year === currentYear && r.month === month; }));
    var mtdLY = aggS(data.filter(function(r) { return sf(r) && r.year === priorYear && r.month === month; }));
    var mtdCorr = aggC(corrections.filter(function(c) { return sf(c) && c.year === currentYear && c.month === month; }));
    var mtdBud = aggB(budgetData.filter(function(b) {
      if (store !== 'all' && b.store_number !== store) return false;
      var p = b.month.split('-').map(Number);
      return p[0] === currentYear && p[1] === month;
    }), salesType);

    // YTD
    var ytdCur = aggS(data.filter(function(r) { return sf(r) && r.year === currentYear && ytdMonths.indexOf(r.month) >= 0; }));
    var ytdLY = aggS(data.filter(function(r) { return sf(r) && r.year === priorYear && ytdMonths.indexOf(r.month) >= 0; }));
    var ytdCorr = aggC(corrections.filter(function(c) { return sf(c) && c.year === currentYear && ytdMonths.indexOf(c.month) >= 0; }));
    var ytdBud = aggB(budgetData.filter(function(b) {
      if (store !== 'all' && b.store_number !== store) return false;
      var p = b.month.split('-').map(Number);
      return p[0] === currentYear && ytdMonths.indexOf(p[1]) >= 0;
    }), salesType);

    // Budget month (full, unprorated) and budget YTD
    var budMonthFull = aggB(budgetData.filter(function(b) {
      if (store !== 'all' && b.store_number !== store) return false;
      var p = b.month.split('-').map(Number);
      return p[0] === currentYear && p[1] === month;
    }), salesType);
    var budYTDFull = aggB(budgetData.filter(function(b) {
      if (store !== 'all' && b.store_number !== store) return false;
      var p = b.month.split('-').map(Number);
      return p[0] === currentYear && ytdMonths.indexOf(p[1]) >= 0;
    }), salesType);

    // All dept codes
    var allCodes = {};
    [mtdCur, mtdLY, mtdCorr, ytdCur, ytdLY].forEach(function(agg) {
      Object.keys(agg).forEach(function(k) { allCodes[k] = true; });
    });
    Object.keys(mtdBud).forEach(function(k) { allCodes[k] = true; });
    Object.keys(ytdBud).forEach(function(k) { allCodes[k] = true; });

    var departments = [];
    Object.keys(allCodes).forEach(function(dc) {
      var mc = mtdCur[dc] || { s: 0 };
      var mco = mtdCorr[dc] || { s: 0 };
      var ml = mtdLY[dc] || { s: 0 };
      var mb = mtdBud[dc] || 0;
      var yc = ytdCur[dc] || { s: 0 };
      var yco = ytdCorr[dc] || { s: 0 };
      var yl = ytdLY[dc] || { s: 0 };
      var yb = ytdBud[dc] || 0;

      var mtdA = mc.s + mco.s;
      var ytdA = yc.s + yco.s;
      var bumName = mc.bum || mco.bum || ml.bum || yc.bum || '';
      var deptName = mc.dept_name || mco.dept_name || ml.dept_name || yc.dept_name || dc;

      // Clean dept code: remove ".0" 
      var cleanCode = String(dc).replace(/\.0$/, '');

      // Prorate MTD budget: if we have data through day X of the month, budget = full month × (X / days in month)
      var mtdBudProrated = mb;
      if (dayFrac.month === month && dayFrac.year === currentYear && dayFrac.frac < 1) {
        mtdBudProrated = mb * dayFrac.frac;
      }

      // Prorate YTD budget: full budget for completed months + prorated current month
      var ytdBudProrated = yb;
      if (dayFrac.month === month && dayFrac.year === currentYear && dayFrac.frac < 1) {
        // YTD full budget minus the unprorated part of current month
        ytdBudProrated = yb - mb + (mb * dayFrac.frac);
      }

      departments.push({
        deptCode: cleanCode,
        deptName: deptName,
        bum: bumName,
        buName: BU_MAP[bumName] || 'OTHER',
        mtdActual: mtdA,
        mtdBudget: mtdBudProrated,
        mtdDiffBud: mtdA - mtdBudProrated,
        mtdIdxBud: mtdBudProrated ? (mtdA / mtdBudProrated) * 100 : 0,
        mtdLY: ml.s,
        mtdDiffLY: mtdA - ml.s,
        mtdIdxLY: ml.s ? (mtdA / ml.s) * 100 : 0,
        ytdActual: ytdA,
        ytdBudget: ytdBudProrated,
        ytdDiffBud: ytdA - ytdBudProrated,
        ytdIdxBud: ytdBudProrated ? (ytdA / ytdBudProrated) * 100 : 0,
        ytdLY: yl.s,
        ytdDiffLY: ytdA - yl.s,
        ytdIdxLY: yl.s ? (ytdA / yl.s) * 100 : 0,
        budMonth: budMonthFull[dc] || 0,
        budYTD: budYTDFull[dc] || 0,
      });
    });

    // Sort by dept code numerically
    departments.sort(function(a, b) {
      var an = parseInt(a.deptCode) || 999;
      var bn = parseInt(b.deptCode) || 999;
      return an - bn;
    });

    var buTotals = {};
    BU_ORDER.forEach(function(bum) {
      var d2 = departments.filter(function(d) { return d.bum === bum; });
      if (d2.length) buTotals[bum] = sumRows(d2);
    });

    return { departments: departments, grandTotal: sumRows(departments), buTotals: buTotals };
  }, [data, budgetData, corrections, store, year, month, salesType, currentYear, priorYear]);

  var toggleSort = _cb(function(col) {
    setSortCol(function(prev) { if (prev === col) { setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; }); return prev; } setSortDir('desc'); return col; });
  }, []);

  var sortedDepts = _m(function() {
    if (!reportData.departments) return [];
    return [].concat(reportData.departments).sort(function(a, b) {
      var av = a[sortCol] || 0, bv = b[sortCol] || 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [reportData.departments, sortCol, sortDir]);

  var buGroups = _m(function() {
    if (!reportData.departments) return [];
    return BU_ORDER.map(function(bum) {
      return { bum: bum, buName: BU_MAP[bum], departments: reportData.departments.filter(function(d) { return d.bum === bum; }), total: reportData.buTotals[bum] };
    }).filter(function(g) { return g.departments.length > 0; });
  }, [reportData]);

  var bumGroups = _m(function() {
    if (!reportData.departments) return [];
    var all = [];
    var seen = {};
    reportData.departments.forEach(function(d) { if (d.bum && !seen[d.bum]) { seen[d.bum] = true; all.push(d.bum); } });
    all.sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return all.map(function(bum) {
      var deps = reportData.departments.filter(function(d) { return d.bum === bum; });
      return { bum: bum, buName: BU_MAP[bum] || '', departments: deps, total: sumRows(deps) };
    });
  }, [reportData.departments]);

  var theadProps = { monthName: monthName, year: year, priorYear: priorYear };
  var storesArr = _m(function() { return Array.from(new Set(data.map(function(r) { return r.store_number; }))).sort(); }, [data]);
  var yearsArr = _m(function() { return Array.from(new Set(data.map(function(r) { return r.year; }))).sort(); }, [data]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Index rapport laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  var gt = reportData.grandTotal;
  var COLS = 18; // 2 label + 7 MTD + 7 YTD + 2 budget ref

  return (
    <div className="max-w-[1800px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Index Rapport</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot — ' + storeName + (lastDate ? (' — data t/m ' + lastDate.getDate() + ' ' + MN[lastDate.getMonth()] + ' ' + lastDate.getFullYear()) : '')}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeName + ' · XCG'}</div>
      </div>

      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">{storesArr.map(function(s) { return <Pill key={s} label={SN[s] || s} active={store === s} onClick={function() { setStore(s); }} />; })}</div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Jaar</span>
          <div className="flex gap-1">{yearsArr.map(function(y) { return <Pill key={y} label={String(y)} active={year === y} onClick={function() { setYear(y); }} />; })}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Maand</span>
          <div className="flex gap-1 flex-wrap">{MN.map(function(m, i) { return <Pill key={i} label={m} active={month === i + 1} onClick={function() { setMonth(i + 1); }} />; })}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Budget</span>
          <div className="flex gap-1">
            <Pill label="Target (70M)" active={budgetMode === 'target'} onClick={function() { setBudgetMode('target'); }} />
            {cgfUnlocked && <Pill label="CGF (65M)" active={budgetMode === 'cgf'} onClick={function() { setBudgetMode('cgf'); }} />}
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['bu', 'Per BU'], ['dept', 'Per Departement'], ['bum', 'Per Manager']].map(function(item) {
          return <button key={item[0]} onClick={function() { setView(item[0]); }}
            className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* ═══ BU VIEW ═══ */}
      {view === 'bu' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1400px' }}>
              <THead {...theadProps} sortable={false} sortCol="" sortDir="" onSort={null} />
              <tbody>
                {gt && <tr className="bg-[#faf7f4]"><td colSpan={2} className="p-1.5 text-[11px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">TOTAAL</td><RowCells d={gt} bold /></tr>}
                {buGroups.map(function(g) {
                  if (!g.total) return null;
                  return <tr key={'bs-' + g.bum} className="bg-[#f5f0ea]"><td colSpan={2} className="p-1.5 text-[11px] border-b border-[#e5ddd4] border-r border-[#e5ddd4]"><span className="font-semibold">{g.buName}</span><span className="text-[#6b5240]">{' — ' + g.bum}</span></td><RowCells d={g.total} /></tr>;
                })}
                <tr><td colSpan={COLS} className="h-3 bg-[#faf7f4]"></td></tr>
                {buGroups.map(function(g) {
                  var rows = [];
                  rows.push(<tr key={'hdr-' + g.bum} className="bg-[#1B3A5C]/5"><td colSpan={COLS} className="p-2.5 border-b border-[#c5d4e6] border-t-2 border-[#1B3A5C]/20"><span className="text-[13px] font-bold text-[#1B3A5C]">{g.buName}</span><span className="text-[11px] text-[#6b5240] ml-3">{'Responsible: ' + g.bum}</span></td></tr>);
                  g.departments.forEach(function(d, i) {
                    rows.push(<tr key={'d-' + d.deptCode} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}><td className="p-1.5 text-[11px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td><td className="p-1.5 text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[180px]" title={d.deptName}>{d.deptName ? d.deptName.replace(/^\d+\s*/, '') : ''}</td><RowCells d={d} /></tr>);
                  });
                  if (g.total) rows.push(<tr key={'tot-' + g.bum} className="bg-[#f5f0ea]"><td colSpan={2} className="p-1.5 text-[11px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4] italic text-[#6b5240]">{'TOTAAL ' + g.buName.replace('BU-', '')}</td><RowCells d={g.total} bold /></tr>);
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ DEPT VIEW ═══ */}
      {view === 'dept' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1400px' }}>
              <THead {...theadProps} sortable sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
              <tbody>
                {gt && <tr className="bg-[#faf7f4]"><td colSpan={2} className="p-1.5 text-[11px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">TOTAAL</td><RowCells d={gt} bold /></tr>}
                {sortedDepts.map(function(d, i) {
                  return <tr key={d.deptCode} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}><td className="p-1.5 text-[11px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td><td className="p-1.5 text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" title={d.deptName}><div className="flex items-center gap-1"><span className="truncate max-w-[140px]">{d.deptName ? d.deptName.replace(/^\d+\s*/, '') : ''}</span><span className="text-[9px] text-[#a08a74]">{'(' + d.bum + ')'}</span></div></td><RowCells d={d} /></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ BUM VIEW ═══ */}
      {view === 'bum' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1400px' }}>
              <THead {...theadProps} sortable={false} sortCol="" sortDir="" onSort={null} />
              <tbody>
                {gt && <tr className="bg-[#faf7f4]"><td colSpan={2} className="p-1.5 text-[11px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">TOTAAL ALLE MANAGERS</td><RowCells d={gt} bold /></tr>}
                <tr><td colSpan={COLS} className="h-3 bg-[#faf7f4]"></td></tr>
                {bumGroups.map(function(g) {
                  var rows = [];
                  rows.push(<tr key={'bh-' + g.bum} className="bg-[#1B3A5C]/5"><td colSpan={COLS} className="p-2.5 border-b border-[#c5d4e6] border-t-2 border-[#1B3A5C]/20"><div className="flex items-center gap-3"><span className="w-7 h-7 rounded-full bg-[#E84E1B] text-white flex items-center justify-center text-[11px] font-bold">{g.bum.charAt(0)}</span><span className="text-[13px] font-bold text-[#1B3A5C]">{g.bum}</span>{g.buName ? <span className="text-[10px] text-[#6b5240]">{'— ' + g.buName}</span> : null}<span className="ml-auto text-[10px] text-[#6b5240]">{g.departments.length + ' dept.'}</span><span className={'ml-2 font-bold font-mono text-[11px] ' + (g.total.mtdIdxBud < 100 ? 'text-red-600' : 'text-green-700')}>{'Idx: ' + Math.round(g.total.mtdIdxBud)}</span></div></td></tr>);
                  rows.push(<tr key={'bt-' + g.bum} className="bg-[#f5f0ea]"><td colSpan={2} className="p-1.5 text-[11px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">{'TOTAAL ' + g.bum.toUpperCase()}</td><RowCells d={g.total} bold /></tr>);
                  g.departments.forEach(function(d, i) {
                    rows.push(<tr key={'bd-' + d.deptCode} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}><td className="p-1.5 text-[11px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td><td className="p-1.5 text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[180px]" title={d.deptName}>{d.deptName ? d.deptName.replace(/^\d+\s*/, '') : ''}</td><RowCells d={d} /></tr>);
                  });
                  rows.push(<tr key={'bs2-' + g.bum}><td colSpan={COLS} className="h-2"></td></tr>);
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span><b>Idx</b> = (Actual / Budget) x 100</span>
          <span style={{ color: '#dc2626' }}>Rood = Index onder 100 of negatief verschil</span>
          <span><b>MTD</b> = Month-To-Date</span>
          <span><b>YTD</b> = Year-To-Date (Jan t/m {monthName})</span>
        </div>
      </div>
    </div>
  );
}
