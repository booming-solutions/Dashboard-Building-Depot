/* ============================================================
   BESTAND: page_inventory.js
   KOPIEER NAAR: src/app/dashboard/inventory/budget/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : (a / 1e3).toFixed(0) + 'K'); };
var fmtP = function(n) { return (n || 0).toFixed(1) + '%'; };
var SN = { '1': 'Curaçao', 'B': 'Bonaire' };
var BU_MAP = { 'PASCAL': 'BU-BUILDING MATERIALS', 'HENK': 'BU-FLOORING-SANITARY-KITCHEN', 'JOHN': 'BU-HARDWARE', 'DANIEL': 'BU-HOUSEHOLD-APPLIANCES', 'GIJS': 'BU-FURNITURE-DECORATION' };
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

/* ── 3-tier color: green ≤15%, orange 15-25%, red >25% ── */
function pctColor(pct) {
  var abs = Math.abs(pct || 0);
  if (abs <= 15) return '#16a34a';
  if (abs <= 25) return '#d97706';
  return '#dc2626';
}

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

/* ── Visual % bar with 3-tier colors + hover tooltip ── */
function PctBar({ pct, name, deptCode, actual, budget }) {
  var _h = useState(false), hovered = _h[0], setHovered = _h[1];
  var capped = Math.max(-80, Math.min(80, pct));
  var isOver = pct > 0;
  var barColor = pctColor(pct);
  var barWidth = Math.min(Math.abs(capped), 80);
  var label = (pct >= 0 ? '+' : '') + Math.round(pct) + '%';

  return (
    <div className="flex items-center gap-2 py-[3px] relative" style={{ minHeight: '28px' }}
      onMouseEnter={function() { setHovered(true); }}
      onMouseLeave={function() { setHovered(false); }}>
      <div className="w-[180px] text-right text-[10px] text-[#1a0a04] truncate flex-shrink-0 pr-2" title={name}>
        <span className="font-mono text-[#6b5240] mr-1">{deptCode}</span>{name ? name.replace(/^\d+\s*/, '') : ''}
      </div>
      <div className="flex-1 flex items-center relative" style={{ height: '22px' }}>
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] bg-[#1B3A5C]/40" style={{ zIndex: 2 }}></div>
        {/* ±15% green zone */}
        <div className="absolute top-0 bottom-0 bg-[#16a34a]/5 border-l border-r border-[#16a34a]/20" style={{ left: 'calc(50% - 7.5%)', width: '15%', zIndex: 0 }}></div>
        {/* ±25% orange zone edges */}
        <div className="absolute top-0 bottom-0 border-l border-r border-[#d97706]/15" style={{ left: 'calc(50% - 12.5%)', width: '25%', zIndex: 0 }}></div>
        <div className="absolute top-1 bottom-1 rounded-sm transition-all" style={{
          backgroundColor: barColor, width: (barWidth / 2) + '%',
          left: isOver ? '50%' : (50 - barWidth / 2) + '%', zIndex: 1,
        }}></div>
        <div className="absolute text-[9px] font-bold font-mono whitespace-nowrap" style={{
          color: barColor,
          left: isOver ? (50 + barWidth / 2 + 0.5) + '%' : undefined,
          right: !isOver ? (50 + barWidth / 2 + 0.5) + '%' : undefined,
          top: '3px', zIndex: 3,
        }}>{label}</div>
      </div>
      {hovered && (
        <div style={{ position: 'absolute', left: '200px', top: '-28px', backgroundColor: '#1B3A5C', color: 'white', fontSize: '10px', fontFamily: 'monospace', padding: '5px 10px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', zIndex: 100, pointerEvents: 'none' }}>
          {'Actual: ' + fmt(Math.round(actual || 0)) + '  ·  Budget: ' + fmt(Math.round(budget || 0)) + '  ·  Verschil: ' + fmt(Math.round((actual || 0) - (budget || 0)))}
        </div>
      )}
    </div>
  );
}

export default function InventoryDashboard() {
  var _s = useState;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _vw = _s('overview'), view = _vw[0], setView = _vw[1];
  var _store = _s('1'), store = _store[0], setStore = _store[1];
  var _bum = _s('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _tStore = _s('1'), trendStore = _tStore[0], setTrendStore = _tStore[1];
  var _tBum = _s('all'), trendBum = _tBum[0], setTrendBum = _tBum[1];
  var _tDept = _s('__total__'), trendDept = _tDept[0], setTrendDept = _tDept[1];
  var trendRef = useRef(null);
  var chartRef = useRef(null);

  var supabase = createClient();
  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('inventory_data').select('*').order('dept_code').order('inventory_date').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all); setLoading(false);
  }

  var stores = useMemo(function() { var s = {}; data.forEach(function(r) { if (r.store_number) s[r.store_number] = true; }); return Object.keys(s).sort(); }, [data]);

  function buildDepartments(storeFilter, bumFilter) {
    var filtered = data.filter(function(r) { return storeFilter === 'all' || r.store_number === storeFilter; });
    var map = {};
    filtered.forEach(function(r) {
      var key = r.dept_code;
      if (!map[key]) map[key] = { deptCode: r.dept_code, deptName: r.dept_name, bum: r.bum, budget: parseFloat(r.budget) || 0, history: [] };
      map[key].history.push({ date: r.inventory_date, value: parseFloat(r.inventory_value) || 0 });
    });
    var list = Object.values(map);
    list.forEach(function(d) {
      d.history.sort(function(a, b) { return a.date.localeCompare(b.date); });
      d.actual = d.history.length ? d.history[d.history.length - 1].value : 0;
      d.diff = d.actual - d.budget;
      d.pct = d.budget ? ((d.actual - d.budget) / d.budget) * 100 : 0;
    });
    // For Bonaire (no budget): only show departments that have actual inventory
    if (storeFilter === 'B') {
      list = list.filter(function(d) {
        return d.history.some(function(h) { return h.value !== 0; });
      });
    }
    list.sort(function(a, b) { return (parseInt(a.deptCode) || 999) - (parseInt(b.deptCode) || 999); });
    if (bumFilter && bumFilter !== 'all') list = list.filter(function(d) { return d.bum === bumFilter; });
    return list;
  }

  var departments = useMemo(function() { return buildDepartments(store, selBum); }, [data, store, selBum]);
  var trendDepartments = useMemo(function() { return buildDepartments(trendStore, trendBum); }, [data, trendStore, trendBum]);

  var bums = useMemo(function() { var s = {}; data.filter(function(r) { return store === 'all' || r.store_number === store; }).forEach(function(r) { if (r.bum) s[r.bum] = true; }); var l = Object.keys(s); l.sort(function(a, b) { var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); }); return l; }, [data, store]);
  var trendBums = useMemo(function() { var s = {}; data.filter(function(r) { return trendStore === 'all' || r.store_number === trendStore; }).forEach(function(r) { if (r.bum) s[r.bum] = true; }); var l = Object.keys(s); l.sort(function(a, b) { var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); }); return l; }, [data, trendStore]);

  var totals = useMemo(function() { var budget = 0, actual = 0; departments.forEach(function(d) { budget += d.budget; actual += d.actual; }); return { budget: budget, actual: actual, diff: actual - budget, pct: budget ? ((actual - budget) / budget) * 100 : 0 }; }, [departments]);

  var dates = useMemo(function() { var s = {}; departments.forEach(function(d) { d.history.forEach(function(h) { s[h.date] = true; }); }); return Object.keys(s).sort(); }, [departments]);
  var historyDates = useMemo(function() { if (dates.length <= 1) return []; return dates.slice(0, -1).reverse(); }, [dates]);
  var isBonaire = store === 'B';

  /* ── Trend chart data ── */
  var trendChartData = useMemo(function() {
    if (!trendDepartments.length) return null;
    var allDates = {};
    trendDepartments.forEach(function(d) { d.history.forEach(function(h) { allDates[h.date] = true; }); });
    var sortedDates = Object.keys(allDates).sort();
    if (!sortedDates.length) return null;
    var labels = sortedDates.map(function(dt) { var p = dt.split('-'); return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + " '" + p[0].slice(2); });
    var title = '', values = [], budgetValues = [];
    if (trendDept === '__total__') {
      title = trendBum !== 'all' ? ('Totaal ' + trendBum) : ('Totaal ' + (trendStore === '1' ? 'Curaçao' : trendStore === 'B' ? 'Bonaire' : trendStore));
      var totalBudget = 0;
      trendDepartments.forEach(function(d) { totalBudget += d.budget; });
      values = sortedDates.map(function(dt) { var sum = 0; trendDepartments.forEach(function(d) { var h = d.history.find(function(x) { return x.date === dt; }); if (h) sum += h.value; }); return sum; });
      budgetValues = sortedDates.map(function() { return totalBudget; });
    } else {
      var dept = trendDepartments.find(function(d) { return d.deptCode === trendDept; });
      if (!dept) return null;
      title = dept.deptCode + ' — ' + dept.deptName;
      values = sortedDates.map(function(dt) { var h = dept.history.find(function(x) { return x.date === dt; }); return h ? h.value : 0; });
      budgetValues = sortedDates.map(function() { return dept.budget; });
    }
    return { labels: labels, values: values, budgetValues: budgetValues, title: title };
  }, [trendDepartments, trendDept, trendBum, trendStore]);

  /* ── Render chart ── */
  useEffect(function() {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    if (view !== 'visual' || !trendChartData || !trendRef.current) return;
    var raf = requestAnimationFrame(function() {
      if (!trendRef.current) return;
      chartRef.current = new Chart(trendRef.current, {
        type: 'line',
        data: { labels: trendChartData.labels, datasets: [
          { label: 'Voorraad', data: trendChartData.values, borderColor: '#E84E1B', backgroundColor: 'rgba(232,78,27,0.08)', pointBackgroundColor: '#E84E1B', pointRadius: 5, tension: 0.3, fill: true, borderWidth: 2.5 },
          { label: 'Budget', data: trendChartData.budgetValues, borderColor: '#1B3A5C', borderDash: [6, 3], pointRadius: 0, tension: 0, borderWidth: 2 },
        ] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } }, tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(Math.round(c.raw)); } } } },
          scales: { y: { ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } }, x: { grid: { display: false } } },
        },
      });
    });
    return function() { cancelAnimationFrame(raf); };
  }, [trendChartData, view]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Voorraad rapport laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen inventory data beschikbaar.</p></div>;

  var latestDate = dates.length ? dates[dates.length - 1] : '';
  var dateParts = latestDate.split('-');
  var dateLabel = dateParts.length === 3 ? (parseInt(dateParts[2]) + ' ' + MN[parseInt(dateParts[1]) - 1] + ' ' + dateParts[0]) : '';
  var storeName = SN[store] || store;

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Voorraad vs Budget</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot — ' + storeName + (dateLabel ? ' — data t/m ' + dateLabel : '')}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeName + ' · XCG'}</div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">{stores.map(function(s) { return <Pill key={s} label={s === '1' ? 'Curaçao' : s === 'B' ? 'Bonaire' : s} active={store === s} onClick={function() { setStore(s); setSelBum('all'); }} />; })}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); }} />; })}
          </div>
        </div>
        {isBonaire && <div className="text-[11px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">Bonaire heeft geen richtinggevend budget — alleen actuele voorraad wordt getoond.</div>}
      </div>

      {/* View tabs — only 2 now */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['overview', 'Overzicht'], ['visual', 'Voorraad vs Budget']].map(function(item) {
          return <button key={item[0]} onClick={function() { setView(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* KPI tiles with 3-tier colors */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Budget Voorraad', value: isBonaire ? 'n.v.t.' : fmtK(totals.budget) },
          { label: 'Actuele Voorraad', value: fmtK(totals.actual) },
          { label: 'Verschil', value: isBonaire ? 'n.v.t.' : ((totals.diff >= 0 ? '+' : '') + fmtK(totals.diff)), color: isBonaire ? undefined : pctColor(totals.pct) },
          { label: '% vs Budget', value: isBonaire ? 'n.v.t.' : fmtP(totals.pct), color: isBonaire ? undefined : pctColor(totals.pct) },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
              <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[28px] font-semibold font-mono mt-1" style={{ color: k.color || '#1a0a04' }}>{k.value}</p>
            </div>
          );
        })}
      </div>

      {/* ═══ OVERVIEW TABLE with 3-tier colors ═══ */}
      {view === 'overview' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-[#1B3A5C]">
                  <th colSpan={2} className="p-0 border-r border-[#2a4f75]"></th>
                  <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">Actual vs Budget</th>
                  <th colSpan={historyDates.length} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">Maandelijks Verloop</th>
                </tr>
                <tr className="bg-[#f0ebe5]">
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">DEP</th>
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] min-w-[160px] border-r border-[#e5ddd4]">Departement</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Budget</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Actual</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Verschil</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">%</th>
                  {historyDates.map(function(dt) { var p = dt.split('-'); return <th key={dt} className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap">{MN[parseInt(p[1]) - 1] + " '" + p[0].slice(2)}</th>; })}
                </tr>
              </thead>
              <tbody>
                {/* Total row */}
                <tr className="bg-[#faf7f4]">
                  <td colSpan={2} className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">TOTAAL</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(totals.budget))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(totals.actual))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: pctColor(totals.pct) }}>{fmt(Math.round(totals.diff))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]" style={{ color: pctColor(totals.pct) }}>{totals.budget ? fmtP(totals.pct) : '-'}</td>
                  {historyDates.map(function(dt) { var sum = 0; departments.forEach(function(d) { var h = d.history.find(function(x) { return x.date === dt; }); if (h) sum += h.value; }); return <td key={dt} className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(sum))}</td>; })}
                </tr>
                {/* Department rows */}
                {departments.map(function(d, i) {
                  var dc = pctColor(d.pct);
                  return (
                    <tr key={d.deptCode} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'} onClick={function() { setTrendDept(d.deptCode); setTrendStore(store); setTrendBum(selBum); setView('visual'); }}>
                      <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[180px]" title={d.deptName}>{d.deptName}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(Math.round(d.budget))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(Math.round(d.actual))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: dc }}>{fmt(Math.round(d.diff))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: dc }}>{d.budget ? fmtP(d.pct) : '-'}</td>
                      {historyDates.map(function(dt) { var h = d.history.find(function(x) { return x.date === dt; }); return <td key={dt} className="p-2 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{h ? fmt(Math.round(h.value)) : '-'}</td>; })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ VOORRAAD VS BUDGET (trend chart + bar chart combined) ═══ */}
      {view === 'visual' && (
        <div className="space-y-5 mb-8">
          {/* Trend filters */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
              <div className="flex gap-1">{stores.map(function(s) { return <Pill key={s} label={s === '1' ? 'Curaçao' : s === 'B' ? 'Bonaire' : s} active={trendStore === s} onClick={function() { setTrendStore(s); setTrendBum('all'); setTrendDept('__total__'); }} />; })}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
              <div className="flex gap-1">
                <Pill label="Alle" active={trendBum === 'all'} onClick={function() { setTrendBum('all'); setTrendDept('__total__'); }} />
                {trendBums.map(function(b) { return <Pill key={b} label={b} active={trendBum === b} onClick={function() { setTrendBum(b); setTrendDept('__total__'); }} />; })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
              <select value={trendDept || '__total__'} onChange={function(e) { setTrendDept(e.target.value); }}
                className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
                <option value="__total__">{trendBum !== 'all' ? 'Totaal ' + trendBum : 'Totaal alle departementen'}</option>
                {trendDepartments.map(function(d) { return <option key={d.deptCode} value={d.deptCode}>{d.deptCode + ' - ' + d.deptName}</option>; })}
              </select>
            </div>
          </div>

          {/* Trend chart */}
          {trendChartData && (
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[15px] font-bold">{trendChartData.title}</h3>
                  <p className="text-[12px] text-[#6b5240]">
                    {'Store: ' + (trendStore === '1' ? 'Curaçao' : trendStore === 'B' ? 'Bonaire' : trendStore) +
                    ' · Budget: ' + fmt(Math.round(trendChartData.budgetValues[0] || 0)) +
                    ' · Actual: ' + fmt(Math.round(trendChartData.values[trendChartData.values.length - 1] || 0))}
                  </p>
                </div>
                {trendChartData.budgetValues[0] > 0 && (function() {
                  var lastVal = trendChartData.values[trendChartData.values.length - 1] || 0;
                  var budVal = trendChartData.budgetValues[0] || 1;
                  var p = ((lastVal - budVal) / budVal) * 100;
                  return <span className="text-[20px] font-bold font-mono" style={{ color: pctColor(p) }}>{(p >= 0 ? '+' : '') + fmtP(p)}</span>;
                })()}
              </div>
              <div style={{ height: '320px' }}>
                <canvas ref={trendRef}></canvas>
              </div>
            </div>
          )}

          {/* Bar chart below trend */}
          {trendStore !== 'B' && (
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-6" style={{ overflow: 'visible' }}>
              <h3 className="text-[15px] font-bold mb-1">Procentueel verschil per departement</h3>
              <p className="text-[12px] text-[#6b5240] mb-2">t.o.v. budget — hover voor details</p>
              <div className="flex items-center gap-4 text-[10px] mb-4">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> Binnen ±15%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> 15-25%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Meer dan 25%</span>
              </div>
              <div style={{ overflow: 'visible' }}>
                {trendDepartments.filter(function(d) { return d.budget > 0; }).map(function(d) {
                  return <PctBar key={d.deptCode} pct={d.pct} name={d.deptName} deptCode={d.deptCode} actual={d.actual} budget={d.budget} />;
                })}
              </div>
            </div>
          )}

          {trendStore === 'B' && (
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-8 shadow-sm text-center">
              <p className="text-[13px] text-amber-600">Bonaire heeft geen budget — visuele vergelijking niet beschikbaar.</p>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span style={{ color: '#16a34a' }}>Groen = binnen ±15% van budget</span>
          <span style={{ color: '#d97706' }}>Oranje = 15-25% afwijking</span>
          <span style={{ color: '#dc2626' }}>Rood = meer dan 25% afwijking</span>
          <span>Klik op een rij in het overzicht om de trend te bekijken</span>
        </div>
      </div>
    </div>
  );
}
