/* ============================================================
   BESTAND: page_inventory.js
   KOPIEER NAAR: src/app/dashboard/inventory/budget/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : (a / 1e3).toFixed(0) + 'K'); };
var fmtP = function(n) { return (n || 0).toFixed(1) + '%'; };
var BU_MAP = {
  'PASCAL': 'BU-BUILDING MATERIALS', 'HENK': 'BU-FLOORING-SANITARY-KITCHEN',
  'JOHN': 'BU-HARDWARE', 'DANIEL': 'BU-HOUSEHOLD-APPLIANCES', 'GIJS': 'BU-FURNITURE-DECORATION',
};
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

/* ── Horizontal % bar for a single department ── */
function PctBar({ pct, name, deptCode }) {
  var capped = Math.max(-100, Math.min(100, pct));
  var isOver = pct > 0;
  var barColor = isOver ? '#dc2626' : '#16a34a';
  var barWidth = Math.abs(capped);
  var label = (pct >= 0 ? '+' : '') + Math.round(pct) + '%';
  return (
    <div className="flex items-center gap-2 py-1" style={{ minHeight: '24px' }}>
      <div className="w-[40px] text-right text-[10px] font-mono text-[#6b5240] flex-shrink-0">{deptCode}</div>
      <div className="flex-1 flex items-center relative" style={{ height: '20px' }}>
        {/* Center line (budget = 0%) */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#1B3A5C]/30" style={{ zIndex: 2 }}></div>
        {/* Bar */}
        <div className="absolute top-1 bottom-1 rounded-sm" style={{
          backgroundColor: barColor,
          width: (barWidth / 2) + '%',
          left: isOver ? '50%' : (50 - barWidth / 2) + '%',
          zIndex: 1,
        }}></div>
        {/* Label */}
        <div className="absolute text-[9px] font-bold font-mono" style={{
          color: barColor,
          left: isOver ? (50 + barWidth / 2 + 1) + '%' : (50 - barWidth / 2 - 1) + '%',
          transform: isOver ? 'none' : 'translateX(-100%)',
          top: '2px', zIndex: 3,
        }}>{label}</div>
      </div>
      <div className="w-[160px] text-[10px] text-[#1a0a04] truncate flex-shrink-0" title={name}>{name}</div>
    </div>
  );
}

export default function InventoryDashboard() {
  var _s = useState;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _vw = _s('overview'), view = _vw[0], setView = _vw[1];
  var _bum = _s('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _dept = _s(null), selDept = _dept[0], setSelDept = _dept[1];
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
    setData(all);
    setLoading(false);
  }

  /* ── Compute departments with history ── */
  var departments = useMemo(function() {
    if (!data.length) return [];
    var map = {};
    data.forEach(function(r) {
      var key = r.dept_code;
      if (!map[key]) map[key] = { deptCode: r.dept_code, deptName: r.dept_name, bum: r.bum, budget: parseFloat(r.budget) || 0, history: [] };
      map[key].history.push({ date: r.inventory_date, value: parseFloat(r.inventory_value) || 0 });
    });
    var list = Object.values(map);
    // Sort history by date
    list.forEach(function(d) { d.history.sort(function(a, b) { return a.date.localeCompare(b.date); }); });
    // Latest value = actual
    list.forEach(function(d) { d.actual = d.history.length ? d.history[d.history.length - 1].value : 0; });
    // Diff and pct
    list.forEach(function(d) {
      d.diff = d.actual - d.budget;
      d.pct = d.budget ? ((d.actual - d.budget) / d.budget) * 100 : 0;
    });
    // Sort by dept code numerically
    list.sort(function(a, b) { return (parseInt(a.deptCode) || 999) - (parseInt(b.deptCode) || 999); });
    return list;
  }, [data]);

  var bums = useMemo(function() {
    var s = {};
    departments.forEach(function(d) { if (d.bum) s[d.bum] = true; });
    var list = Object.keys(s);
    list.sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return list;
  }, [departments]);

  var filtered = useMemo(function() {
    if (selBum === 'all') return departments;
    return departments.filter(function(d) { return d.bum === selBum; });
  }, [departments, selBum]);

  var totals = useMemo(function() {
    var budget = 0, actual = 0;
    filtered.forEach(function(d) { budget += d.budget; actual += d.actual; });
    return { budget: budget, actual: actual, diff: actual - budget, pct: budget ? ((actual - budget) / budget) * 100 : 0 };
  }, [filtered]);

  var dates = useMemo(function() {
    if (!departments.length) return [];
    var s = {};
    departments.forEach(function(d) { d.history.forEach(function(h) { s[h.date] = true; }); });
    return Object.keys(s).sort();
  }, [departments]);

  /* ── Trend chart ── */
  useEffect(function() {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    if (!trendRef.current || !selDept) return;
    var dept = departments.find(function(d) { return d.deptCode === selDept; });
    if (!dept || !dept.history.length) return;

    var labels = dept.history.map(function(h) {
      var p = h.date.split('-');
      return MN[parseInt(p[1]) - 1] + ' ' + p[2];
    });
    var values = dept.history.map(function(h) { return h.value; });
    var budgetLine = dept.history.map(function() { return dept.budget; });

    chartRef.current = new Chart(trendRef.current, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Voorraad', data: values, borderColor: '#E84E1B', backgroundColor: 'rgba(232,78,27,0.1)', pointBackgroundColor: '#E84E1B', pointRadius: 5, tension: 0.3, fill: true },
          { label: 'Budget', data: budgetLine, borderColor: '#1B3A5C', borderDash: [6, 3], pointRadius: 0, tension: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } }, tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(c.raw); } } } },
        scales: { y: { ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } }, x: { grid: { display: false } } },
      },
    });
  }, [selDept, departments]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Voorraad rapport laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen inventory data beschikbaar. Upload data via Supabase.</p></div>;

  var latestDate = dates.length ? dates[dates.length - 1] : '';
  var dateParts = latestDate.split('-');
  var dateLabel = dateParts.length === 3 ? (parseInt(dateParts[2]) + ' ' + MN[parseInt(dateParts[1]) - 1] + ' ' + dateParts[0]) : '';

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Voorraad vs Budget</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot — Curaçao' + (dateLabel ? ' — data t/m ' + dateLabel : '')}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); }} />; })}
          </div>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['overview', 'Overzicht'], ['visual', 'Visueel % Budget'], ['trend', 'Trend per Departement']].map(function(item) {
          return <button key={item[0]} onClick={function() { setView(item[0]); }}
            className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Budget Voorraad', value: fmtK(totals.budget) },
          { label: 'Actuele Voorraad', value: fmtK(totals.actual) },
          { label: 'Verschil', value: (totals.diff >= 0 ? '+' : '') + fmtK(totals.diff), color: totals.diff > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Index vs Budget', value: fmtP(totals.pct), color: totals.pct > 0 ? '#dc2626' : '#16a34a' },
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

      {/* ═══ OVERVIEW TABLE ═══ */}
      {view === 'overview' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-[#1B3A5C]">
                  <th colSpan={2} className="p-0 border-r border-[#2a4f75]"></th>
                  <th colSpan={4} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2 border-r border-[#2a4f75]">Actual vs Budget</th>
                  <th colSpan={dates.length} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">Maandelijks Verloop</th>
                </tr>
                <tr className="bg-[#f0ebe5]">
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">DEP</th>
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] min-w-[160px] border-r border-[#e5ddd4]">Departement</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Budget</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Actual</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Verschil</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">%</th>
                  {dates.map(function(dt) {
                    var p = dt.split('-');
                    return <th key={dt} className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap">{MN[parseInt(p[1]) - 1] + "'" + p[0].slice(2)}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Total row */}
                <tr className="bg-[#faf7f4]">
                  <td colSpan={2} className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">TOTAAL</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(totals.budget))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(totals.actual))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: totals.diff > 0 ? '#dc2626' : '#16a34a' }}>{fmt(Math.round(totals.diff))}</td>
                  <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]" style={{ color: totals.pct > 0 ? '#dc2626' : '#16a34a' }}>{fmtP(totals.pct)}</td>
                  {dates.map(function(dt) {
                    var sum = 0;
                    filtered.forEach(function(d) { var h = d.history.find(function(x) { return x.date === dt; }); if (h) sum += h.value; });
                    return <td key={dt} className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(sum))}</td>;
                  })}
                </tr>
                {/* Department rows */}
                {filtered.map(function(d, i) {
                  var diffColor = d.diff > 0 ? '#dc2626' : '#16a34a';
                  return (
                    <tr key={d.deptCode} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'} onClick={function() { setSelDept(d.deptCode); setView('trend'); }}>
                      <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[180px]" title={d.deptName}>{d.deptName}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(Math.round(d.budget))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(Math.round(d.actual))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: diffColor }}>{fmt(Math.round(d.diff))}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: diffColor }}>{fmtP(d.pct)}</td>
                      {dates.map(function(dt) {
                        var h = d.history.find(function(x) { return x.date === dt; });
                        return <td key={dt} className="p-2 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{h ? fmt(Math.round(h.value)) : '-'}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ VISUAL % BAR CHART ═══ */}
      {view === 'visual' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-6 mb-8">
          <h3 className="text-[15px] font-bold mb-1">Voorraad vs Budget per Departement</h3>
          <p className="text-[12px] text-[#6b5240] mb-4">Procentueel verschil t.o.v. budget — <span style={{ color: '#dc2626' }}>rood = boven budget</span>, <span style={{ color: '#16a34a' }}>groen = onder budget</span></p>
          <div className="space-y-0">
            {filtered.map(function(d) {
              return <PctBar key={d.deptCode} pct={d.pct} name={d.deptName} deptCode={d.deptCode} />;
            })}
          </div>
        </div>
      )}

      {/* ═══ TREND PER DEPARTMENT ═══ */}
      {view === 'trend' && (
        <div className="space-y-5 mb-8">
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px]">Departement</span>
              <select value={selDept || ''} onChange={function(e) { setSelDept(e.target.value); }}
                className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg">
                <option value="">Kies departement...</option>
                {filtered.map(function(d) { return <option key={d.deptCode} value={d.deptCode}>{d.deptCode + ' - ' + d.deptName}</option>; })}
              </select>
            </div>
          </div>

          {selDept && (function() {
            var dept = departments.find(function(d) { return d.deptCode === selDept; });
            if (!dept) return null;
            return (
              <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-[15px] font-bold">{dept.deptCode + ' — ' + dept.deptName}</h3>
                    <p className="text-[12px] text-[#6b5240]">{'Manager: ' + dept.bum + ' · Budget: ' + fmt(Math.round(dept.budget)) + ' · Actual: ' + fmt(Math.round(dept.actual))}</p>
                  </div>
                  <span className={'text-[20px] font-bold font-mono ' + (dept.diff > 0 ? 'text-red-600' : 'text-green-600')}>{(dept.pct >= 0 ? '+' : '') + fmtP(dept.pct)}</span>
                </div>
                <div style={{ height: '300px' }}>
                  <canvas ref={trendRef}></canvas>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span style={{ color: '#dc2626' }}>Rood = boven budget (teveel voorraad)</span>
          <span style={{ color: '#16a34a' }}>Groen = onder budget</span>
          <span>Klik op een rij in het overzicht om de trend te bekijken</span>
        </div>
      </div>
    </div>
  );
}
