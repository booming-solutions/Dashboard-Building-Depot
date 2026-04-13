/* ============================================================
   BESTAND: page_traffic_v4.js
   KOPIEER NAAR: src/app/dashboard/sales/traffic/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var DAYS = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
var DAYS_FULL = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a); };
var fmtP = function(n) { return (n || 0).toFixed(1) + '%'; };

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

function KPI({ label, value, sub, subColor, icon }) {
  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{label}</p>
          <p className="text-[28px] font-semibold font-mono mt-1">{value}</p>
          {sub && <p className="text-[13px] font-mono mt-0.5" style={{ color: subColor || '#6b5240' }}>{sub}</p>}
        </div>
        {icon && <span className="text-[28px] opacity-20">{icon}</span>}
      </div>
    </div>
  );
}

export default function TrafficDashboard() {
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _tab = useState('bd'), tab = _tab[0], setTab = _tab[1];
  var _yr = useState('all'), yearFilter = _yr[0], setYearFilter = _yr[1];

  var visitorsRef = useRef(null);
  var conversionRef = useRef(null);
  var ticketRef = useRef(null);
  var comboRef = useRef(null);
  var dowRef = useRef(null);
  var dowRef2 = useRef(null);
  var chartsRef = useRef({});

  var supabase = createClient();
  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('traffic_data').select('*').order('date').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all); setLoading(false);
  }

  // Get store data based on tab
  var storeNumber = tab === 'bonaire' ? 'B' : '1';
  var storeData = useMemo(function() {
    return data.filter(function(r) { return r.store_number === storeNumber; });
  }, [data, storeNumber]);

  // Visitor field based on tab
  var getVisitors = function(r) {
    if (tab === 'bd') return r.visitors || 0;
    if (tab === 'multimart') return r.visitors_multimart || 0;
    if (tab === 'bonaire') return r.visitors || 0;
    return 0;
  };

  var lastDate = useMemo(function() {
    if (!storeData.length) return null;
    return storeData.reduce(function(max, r) { return r.date > max ? r.date : max; }, storeData[0].date);
  }, [storeData]);

  var currentYear = useMemo(function() { return lastDate ? parseInt(lastDate.split('-')[0]) : 2026; }, [lastDate]);

  // Aggregate daily → monthly with correct visitor source
  var monthly = useMemo(function() {
    var map = {};
    storeData.forEach(function(r) {
      var parts = r.date.split('-');
      var y = parseInt(parts[0]); var m = parseInt(parts[1]);
      var key = y + '-' + String(m).padStart(2, '0');
      if (!map[key]) map[key] = { year: y, month: m, visitors: 0, visitors_keuken: 0, tickets: 0, sales: 0 };
      map[key].visitors += getVisitors(r);
      if (tab === 'bd') map[key].visitors_keuken += r.visitors_keuken || 0;
      map[key].tickets += r.tickets || 0;
      map[key].sales += parseFloat(r.total_sales) || 0;
    });
    return Object.values(map).sort(function(a, b) { return (b.year * 100 + b.month) - (a.year * 100 + a.month); });
  }, [storeData, tab]);

  var years = useMemo(function() {
    var s = {}; monthly.forEach(function(r) { s[r.year] = true; });
    return Object.keys(s).sort();
  }, [monthly]);

  var filteredMonthly = useMemo(function() {
    if (yearFilter === 'all') return monthly;
    return monthly.filter(function(r) { return String(r.year) === yearFilter; });
  }, [monthly, yearFilter]);

  // YTD exact same day comparison
  var cyYTD = useMemo(function() {
    if (!lastDate) return { visitors: 0, tickets: 0, sales: 0 };
    var d = storeData.filter(function(r) { return r.date.startsWith(String(currentYear)) && r.date <= lastDate; });
    return { visitors: d.reduce(function(s, r) { return s + getVisitors(r); }, 0), tickets: d.reduce(function(s, r) { return s + (r.tickets || 0); }, 0), sales: d.reduce(function(s, r) { return s + parseFloat(r.total_sales || 0); }, 0) };
  }, [storeData, currentYear, lastDate, tab]);

  var lyYTD = useMemo(function() {
    if (!lastDate) return { visitors: 0, tickets: 0, sales: 0 };
    var lyCutoff = (currentYear - 1) + lastDate.substring(4);
    var d = storeData.filter(function(r) { return r.date.startsWith(String(currentYear - 1)) && r.date <= lyCutoff; });
    return { visitors: d.reduce(function(s, r) { return s + getVisitors(r); }, 0), tickets: d.reduce(function(s, r) { return s + (r.tickets || 0); }, 0), sales: d.reduce(function(s, r) { return s + parseFloat(r.total_sales || 0); }, 0) };
  }, [storeData, currentYear, lastDate, tab]);

  // Day of week analysis for current year
  var dowData = useMemo(function() {
    var totals = [0,0,0,0,0,0,0]; var counts = [0,0,0,0,0,0,0];
    storeData.forEach(function(r) {
      if (!r.date.startsWith(String(currentYear))) return;
      var v = getVisitors(r);
      if (!v) return;
      var dt = new Date(r.date + 'T12:00:00');
      var dow = (dt.getDay() + 6) % 7; // Monday=0
      totals[dow] += v; counts[dow]++;
    });
    var total = totals.reduce(function(a, b) { return a + b; }, 0);
    return DAYS.map(function(d, i) { return { day: d, dayFull: DAYS_FULL[i], total: totals[i], avg: counts[i] ? Math.round(totals[i] / counts[i]) : 0, pct: total ? (totals[i] / total * 100) : 0 }; });
  }, [storeData, currentYear, tab]);

  // KeukenDepot day of week (only for BD tab)
  var dowKeuken = useMemo(function() {
    if (tab !== 'bd') return null;
    var totals = [0,0,0,0,0,0,0]; var counts = [0,0,0,0,0,0,0];
    storeData.forEach(function(r) {
      if (!r.date.startsWith(String(currentYear))) return;
      var v = r.visitors_keuken || 0;
      if (!v) return;
      var dt = new Date(r.date + 'T12:00:00');
      var dow = (dt.getDay() + 6) % 7;
      totals[dow] += v; counts[dow]++;
    });
    var total = totals.reduce(function(a, b) { return a + b; }, 0);
    return DAYS.map(function(d, i) { return { day: d, total: totals[i], avg: counts[i] ? Math.round(totals[i] / counts[i]) : 0, pct: total ? (totals[i] / total * 100) : 0 }; });
  }, [storeData, currentYear, tab]);

  var pctChg = function(a, b) { return b ? ((a - b) / Math.abs(b) * 100) : 0; };

  // Monthly chart data
  var monthlyAsc = useMemo(function() { return monthly.slice().sort(function(a, b) { return (a.year * 100 + a.month) - (b.year * 100 + b.month); }); }, [monthly]);
  var cyMonthly = useMemo(function() { return monthlyAsc.filter(function(r) { return r.year === currentYear; }); }, [monthlyAsc, currentYear]);
  var lyMonthly = useMemo(function() { return monthlyAsc.filter(function(r) { return r.year === currentYear - 1; }); }, [monthlyAsc, currentYear]);

  // Render charts
  useEffect(function() {
    Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); });
    chartsRef.current = {};
    if (!storeData.length) return;

    var labels = [], cyV = [], lyV = [], cyConv = [], lyConv = [], cyAvg = [], lyAvg = [], cyT = [], lyT = [];
    for (var m = 1; m <= 12; m++) {
      labels.push(MN[m - 1]);
      var cy = cyMonthly.find(function(r) { return r.month === m; });
      var ly = lyMonthly.find(function(r) { return r.month === m; });
      cyV.push(cy ? cy.visitors : null); lyV.push(ly ? ly.visitors : null);
      cyConv.push(cy && cy.visitors ? (cy.tickets / cy.visitors * 100) : null);
      lyConv.push(ly && ly.visitors ? (ly.tickets / ly.visitors * 100) : null);
      cyAvg.push(cy && cy.tickets ? (cy.sales / cy.tickets) : null);
      lyAvg.push(ly && ly.tickets ? (ly.sales / ly.tickets) : null);
      cyT.push(cy ? cy.tickets : null); lyT.push(ly ? ly.tickets : null);
    }

    var co = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f0ebe5' } } } };

    if (visitorsRef.current) {
      chartsRef.current.v = new Chart(visitorsRef.current, { type: 'bar', data: { labels: labels, datasets: [
        { label: currentYear + ' Bezoekers', data: cyV, backgroundColor: 'rgba(232,78,27,0.25)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, order: 2 },
        { label: (currentYear - 1) + ' Bezoekers', data: lyV, type: 'line', borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, order: 1 },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(c.raw); } } } }) }) });
    }

    if (conversionRef.current && cyConv.some(function(v) { return v !== null; })) {
      chartsRef.current.c = new Chart(conversionRef.current, { type: 'line', data: { labels: labels, datasets: [
        { label: currentYear + ' Conversie %', data: cyConv, borderColor: '#E84E1B', backgroundColor: 'rgba(232,78,27,0.08)', pointBackgroundColor: '#E84E1B', pointRadius: 5, tension: 0.3, fill: true, borderWidth: 2.5 },
        { label: (currentYear - 1) + ' Conversie %', data: lyConv, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2 },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return v + '%'; } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmtP(c.raw); } } } }) }) });
    }

    if (ticketRef.current) {
      chartsRef.current.t = new Chart(ticketRef.current, { type: 'line', data: { labels: labels, datasets: [
        { label: currentYear + ' Gem. Bon', data: cyAvg, borderColor: '#1B3A5C', backgroundColor: 'rgba(27,58,92,0.08)', pointBackgroundColor: '#1B3A5C', pointRadius: 5, tension: 0.3, fill: true, borderWidth: 2.5 },
        { label: (currentYear - 1) + ' Gem. Bon', data: lyAvg, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2 },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return 'Cg ' + v; } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': Cg ' + fmt(Math.round(c.raw)); } } } }) }) });
    }

    if (comboRef.current) {
      chartsRef.current.cb = new Chart(comboRef.current, { type: 'bar', data: { labels: labels, datasets: [
        { label: currentYear + ' Tickets', data: cyT, backgroundColor: 'rgba(232,78,27,0.2)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
        { label: (currentYear - 1) + ' Tickets', data: lyT, backgroundColor: 'rgba(136,136,136,0.15)', borderColor: '#888', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 3 },
        { label: currentYear + ' Gem. Bon', data: cyAvg, type: 'line', borderColor: '#1B3A5C', pointBackgroundColor: '#1B3A5C', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2.5, yAxisID: 'y1', order: 1 },
      ] }, options: { responsive: true, maintainAspectRatio: false, plugins: co.plugins, scales: { x: { grid: { display: false } }, y: { position: 'left', ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } }, y1: { position: 'right', ticks: { callback: function(v) { return 'Cg ' + v; } }, grid: { display: false } } } } });
    }

    // Day of week chart
    if (dowRef.current && dowData.some(function(d) { return d.total > 0; })) {
      chartsRef.current.dow = new Chart(dowRef.current, { type: 'bar', data: { labels: dowData.map(function(d) { return d.day; }), datasets: [
        { data: dowData.map(function(d) { return d.pct; }), backgroundColor: dowData.map(function(d, i) { return i === 5 ? '#E84E1B' : i === 6 ? '#d4a574' : 'rgba(27,58,92,0.3)'; }), borderColor: dowData.map(function(d, i) { return i === 5 ? '#E84E1B' : i === 6 ? '#c4956a' : '#1B3A5C'; }), borderWidth: 1, borderRadius: 4 },
      ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { var d = dowData[c.dataIndex]; return d.dayFull + ': ' + fmtP(d.pct) + ' (gem. ' + fmt(d.avg) + '/dag)'; } } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return v + '%'; } }, grid: { color: '#f0ebe5' } } } } });
    }

    // KeukenDepot day of week
    if (dowRef2.current && dowKeuken && dowKeuken.some(function(d) { return d.total > 0; })) {
      chartsRef.current.dow2 = new Chart(dowRef2.current, { type: 'bar', data: { labels: dowKeuken.map(function(d) { return d.day; }), datasets: [
        { data: dowKeuken.map(function(d) { return d.pct; }), backgroundColor: dowKeuken.map(function(d, i) { return i === 5 ? '#16a34a' : i === 6 ? '#a3d9a5' : 'rgba(22,163,74,0.25)'; }), borderColor: dowKeuken.map(function(d, i) { return i === 5 ? '#16a34a' : i === 6 ? '#6bc06d' : '#16a34a'; }), borderWidth: 1, borderRadius: 4 },
      ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { var d = dowKeuken[c.dataIndex]; return DAYS_FULL[c.dataIndex] + ': ' + fmtP(d.pct) + ' (gem. ' + fmt(d.avg) + '/dag)'; } } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: function(v) { return v + '%'; } }, grid: { color: '#f0ebe5' } } } } });
    }

    return function() { Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); }); };
  }, [storeData, cyMonthly, lyMonthly, currentYear, dowData, dowKeuken, tab]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Bezoekers & conversie laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen traffic data beschikbaar.</p></div>;

  var cyConvYTD = cyYTD.visitors ? (cyYTD.tickets / cyYTD.visitors * 100) : 0;
  var lyConvYTD = lyYTD.visitors ? (lyYTD.tickets / lyYTD.visitors * 100) : 0;
  var cyAvgYTD = cyYTD.tickets ? (cyYTD.sales / cyYTD.tickets) : 0;
  var lyAvgYTD = lyYTD.tickets ? (lyYTD.sales / lyYTD.tickets) : 0;
  var hasVisitors = cyYTD.visitors > 0;
  var dateLabel = lastDate ? parseInt(lastDate.split('-')[2]) + ' ' + MN[parseInt(lastDate.split('-')[1]) - 1] + ' ' + lastDate.split('-')[0] : '';
  var tabNames = { bd: 'Building Depot', multimart: 'MultiMart', bonaire: 'Bonaire' };

  return (
    <div className="max-w-[1520px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Bezoekers & Conversie</h1>
          <p className="text-[13px] text-[#6b5240]">{tabNames[tab] + ' — data t/m ' + dateLabel + ' vs ' + (currentYear - 1)}</p>
        </div>
      </div>

      {/* Store tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['bd', 'Building Depot'], ['multimart', 'MultiMart'], ['bonaire', 'Bonaire']].map(function(item) {
          return <button key={item[0]} onClick={function() { setTab(item[0]); setYearFilter('all'); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (tab === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {!hasVisitors && (tab === 'bonaire') && (
        <div className="bg-amber-50 border border-amber-200 rounded-[14px] p-4 mb-5 text-[13px] text-amber-700">Bezoekersaantallen voor Bonaire zijn nog niet beschikbaar.</div>
      )}

      {/* KPI tiles */}
      <div className={'grid grid-cols-2 gap-4 mb-5 ' + (hasVisitors ? 'md:grid-cols-5' : 'md:grid-cols-3')}>
        {hasVisitors && <KPI label="Bezoekers YTD" value={fmtK(cyYTD.visitors)} sub={'LY: ' + fmtK(lyYTD.visitors) + ' (' + (pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.visitors, lyYTD.visitors)) + ')'} subColor={pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '#16a34a' : '#dc2626'} icon="👥" />}
        <KPI label="Tickets YTD" value={fmtK(cyYTD.tickets)} sub={'LY: ' + fmtK(lyYTD.tickets) + ' (' + (pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.tickets, lyYTD.tickets)) + ')'} subColor={pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '#16a34a' : '#dc2626'} icon="🧾" />
        {hasVisitors && <KPI label="Conversie YTD" value={fmtP(cyConvYTD)} sub={'LY: ' + fmtP(lyConvYTD) + ' (' + (cyConvYTD - lyConvYTD >= 0 ? '+' : '') + (cyConvYTD - lyConvYTD).toFixed(1) + 'pp)'} subColor={cyConvYTD >= lyConvYTD ? '#16a34a' : '#dc2626'} icon="🎯" />}
        <KPI label="Gem. Bonbedrag" value={'Cg ' + fmt(Math.round(cyAvgYTD))} sub={'LY: Cg ' + fmt(Math.round(lyAvgYTD)) + ' (' + (pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '+' : '') + fmtP(pctChg(cyAvgYTD, lyAvgYTD)) + ')'} subColor={pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '#16a34a' : '#dc2626'} icon="💰" />
        <KPI label="Omzet YTD" value={fmtK(cyYTD.sales)} sub={'LY: ' + fmtK(lyYTD.sales) + ' (' + (pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.sales, lyYTD.sales)) + ')'} subColor={pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '#16a34a' : '#dc2626'} icon="📊" />
      </div>

      {/* Visitor overview + day-of-week */}
      {hasVisitors && (
        <div className={'grid gap-4 mb-5 ' + (tab === 'bd' ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2')}>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[15px] font-bold mb-2">{tab === 'bd' ? 'Building Depot' : tab === 'multimart' ? 'MultiMart' : 'Bonaire'} — Bezoekers {currentYear}</h3>
            <p className="text-[12px] text-[#6b5240] mb-3">Verdeling over weekdagen</p>
            <div style={{ height: '220px' }}><canvas ref={dowRef}></canvas></div>
            <div className="mt-3 text-[10px] text-[#6b5240]">
              {dowData.map(function(d) { return d.total > 0 ? (d.dayFull + ': gem. ' + fmt(d.avg) + '/dag') : null; }).filter(Boolean).join(' · ')}
            </div>
          </div>
          {tab === 'bd' && dowKeuken && (
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <h3 className="text-[15px] font-bold mb-2">KeukenDepot — Bezoekers {currentYear}</h3>
              <p className="text-[12px] text-[#6b5240] mb-3">Verdeling over weekdagen</p>
              <div style={{ height: '220px' }}><canvas ref={dowRef2}></canvas></div>
              <div className="mt-3 text-[10px] text-[#6b5240]">
                {dowKeuken.map(function(d) { return d.total > 0 ? (DAYS_FULL[dowKeuken.indexOf(d)] + ': gem. ' + fmt(d.avg) + '/dag') : null; }).filter(Boolean).join(' · ')}
              </div>
            </div>
          )}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[15px] font-bold mb-4">Bezoekers per maand</h3>
            <div style={{ height: '250px' }}><canvas ref={visitorsRef}></canvas></div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {hasVisitors && <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Conversie % (tickets / bezoekers)</h3>
          <div style={{ height: '280px' }}><canvas ref={conversionRef}></canvas></div>
        </div>}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Gemiddeld bonbedrag (Cg)</h3>
          <div style={{ height: '280px' }}><canvas ref={ticketRef}></canvas></div>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Tickets & Gemiddeld Bonbedrag</h3>
          <div style={{ height: '280px' }}><canvas ref={comboRef}></canvas></div>
        </div>
      </div>

      {/* Monthly table — newest first */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="flex items-center justify-between p-4 border-b border-[#e5ddd4]">
          <h3 className="text-[15px] font-bold">Maandelijks Overzicht</h3>
          <div className="flex gap-1">
            <Pill label="Alle jaren" active={yearFilter === 'all'} onClick={function() { setYearFilter('all'); }} />
            {years.map(function(y) { return <Pill key={y} label={y} active={yearFilter === y} onClick={function() { setYearFilter(y); }} />; })}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f0ebe5]">
                {['Maand', hasVisitors ? 'Bezoekers' : null, 'Tickets', hasVisitors ? 'Conversie' : null, 'Omzet', 'Gem. Bon', hasVisitors ? 'vs LY Bez.' : null, hasVisitors ? 'vs LY Conv.' : null, 'vs LY Bon'].filter(Boolean).map(function(h) {
                  return <th key={h} className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right first:text-left">{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filteredMonthly.map(function(r, i) {
                var ly = monthlyAsc.find(function(d) { return d.year === r.year - 1 && d.month === r.month; });
                var conv = r.visitors ? (r.tickets / r.visitors * 100) : 0;
                var lyConv = ly && ly.visitors ? (ly.tickets / ly.visitors * 100) : 0;
                var avg = r.tickets ? (r.sales / r.tickets) : 0;
                var lyAvgV = ly && ly.tickets ? (ly.sales / ly.tickets) : 0;
                var vChg = ly && ly.visitors ? pctChg(r.visitors, ly.visitors) : null;
                var cChg = ly && r.visitors && ly.visitors ? (conv - lyConv) : null;
                var aChg = ly && ly.tickets ? pctChg(avg, lyAvgV) : null;
                var cells = [<td key="m" className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{MN[r.month - 1] + ' ' + r.year}</td>];
                if (hasVisitors) cells.push(<td key="v" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{r.visitors ? fmt(r.visitors) : '-'}</td>);
                cells.push(<td key="t" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(r.tickets)}</td>);
                if (hasVisitors) cells.push(<td key="c" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: conv >= 50 ? '#16a34a' : '#d97706' }}>{r.visitors ? fmtP(conv) : '-'}</td>);
                cells.push(<td key="s" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmtK(r.sales)}</td>);
                cells.push(<td key="a" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold">{'Cg ' + fmt(Math.round(avg))}</td>);
                if (hasVisitors) cells.push(<td key="vl" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: vChg !== null ? (vChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{vChg !== null ? ((vChg >= 0 ? '+' : '') + fmtP(vChg)) : '-'}</td>);
                if (hasVisitors) cells.push(<td key="cl" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: cChg !== null ? (cChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{cChg !== null ? ((cChg >= 0 ? '+' : '') + cChg.toFixed(1) + 'pp') : '-'}</td>);
                cells.push(<td key="al" className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: aChg !== null ? (aChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{aChg !== null ? ((aChg >= 0 ? '+' : '') + fmtP(aChg)) : '-'}</td>);
                return <tr key={r.year + '-' + r.month} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>{cells}</tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="text-[10px] text-[#6b5240] space-y-1">
          <p><strong>Conversie</strong> = tickets ÷ bezoekers × 100%. <strong>Gem. Bonbedrag</strong> = omzet ÷ tickets.</p>
          <p><strong>YTD vergelijking</strong> is t/m exact {dateLabel} vs {dateLabel ? dateLabel.replace(String(currentYear), String(currentYear - 1)) : ''}.</p>
        </div>
      </div>
    </div>
  );
}
