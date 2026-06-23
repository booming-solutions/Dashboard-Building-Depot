/* ============================================================
   BESTAND: page.js (Bezoekers & Conversie)
   KOPIEER NAAR: src/app/dashboard/sales/traffic/page.js
   VERSIE: v5.0 — Week-based view

   Veranderingen vs v4:
   - Bezoekers per week i.p.v. per dag, uit nieuwe tabel visitor_data_weekly
   - Tickets/sales geaggregeerd vanuit traffic_data (daily → weekly)
   - 4 tabs: Building Depot Curaçao, Bonaire, Multimart, Keuken Depot
   - Keuken Depot heeft alleen bezoekers (sales zitten bij Curaçao)
   - Bezoekers-per-dag chart verwijderd
   - Day-of-week chart verwijderd (niet meer relevant zonder daily visitors)
   - YTD vergelijking vs zelfde week vorig jaar
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a)); };
var fmtP = function(n) { return (n || 0).toFixed(1) + '%'; };
var pctChg = function(cur, prev) { return prev ? ((cur - prev) / Math.abs(prev) * 100) : 0; };

// ISO week from date string YYYY-MM-DD
function isoWeek(dateStr) {
  var d = new Date(dateStr);
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var wk = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week: wk };
}

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

var STORES = {
  bd: { label: 'Building Depot Curaçao', store_number: '1', currency: 'XCG', hasSales: true },
  bonaire: { label: 'Bonaire', store_number: 'B', currency: 'US$', hasSales: true },
  multimart: { label: 'Multimart', store_number: 'M', currency: 'XCG', hasSales: true },
  keuken: { label: 'Keuken Depot', store_number: 'KK', currency: 'XCG', hasSales: false },
};

export default function TrafficDashboard() {
  var supabase = createClient();
  var [trafficData, setTrafficData] = useState([]);
  var [visitorData, setVisitorData] = useState([]);
  var [loading, setLoading] = useState(true);
  var [tab, setTab] = useState('bd');
  var [yearFilter, setYearFilter] = useState('all');

  var visitorsRef = useRef(null);
  var conversionRef = useRef(null);
  var ticketRef = useRef(null);
  var comboRef = useRef(null);
  var chartsRef = useRef({});

  useEffect(function() { loadData(); }, []);

  async function loadData() {
    // Load traffic_data (daily, will aggregate to weekly)
    var allTraffic = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('traffic_data').select('*').order('date').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      allTraffic = allTraffic.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setTrafficData(allTraffic);

    // Load visitor_data_weekly
    var allVisitors = [], from2 = 0;
    while (true) {
      var r2 = await supabase.from('visitor_data_weekly').select('*').range(from2, from2 + step - 1);
      if (!r2.data || !r2.data.length) break;
      allVisitors = allVisitors.concat(r2.data);
      if (r2.data.length < step) break;
      from2 += step;
    }
    setVisitorData(allVisitors);
    setLoading(false);
  }

  var storeMeta = STORES[tab];

  // Visitors for current tab (from visitor_data_weekly)
  var weeklyVisitors = useMemo(function() {
    return visitorData
      .filter(function(r) { return r.store_number === storeMeta.store_number; })
      .map(function(r) { return { year: r.year, week: r.week, visitors: r.visitors, customer_count: r.customer_count }; });
  }, [visitorData, storeMeta.store_number]);

  // Aggregate traffic_data (daily) to weekly per store
  var weeklyTraffic = useMemo(function() {
    var map = {};
    trafficData
      .filter(function(r) { return r.store_number === storeMeta.store_number; })
      .forEach(function(r) {
        var iw = isoWeek(r.date);
        var key = iw.year + '-' + iw.week;
        if (!map[key]) map[key] = { year: iw.year, week: iw.week, tickets: 0, sales: 0 };
        map[key].tickets += (r.tickets || 0);
        map[key].sales += parseFloat(r.total_sales || 0);
      });
    return Object.values(map).sort(function(a, b) {
      return a.year !== b.year ? a.year - b.year : a.week - b.week;
    });
  }, [trafficData, storeMeta.store_number]);

  // Merge visitors + traffic per (year, week)
  var weekly = useMemo(function() {
    var map = {};
    weeklyVisitors.forEach(function(v) {
      var key = v.year + '-' + v.week;
      map[key] = { year: v.year, week: v.week, visitors: v.visitors, customer_count: v.customer_count, tickets: 0, sales: 0 };
    });
    weeklyTraffic.forEach(function(t) {
      var key = t.year + '-' + t.week;
      if (!map[key]) map[key] = { year: t.year, week: t.week, visitors: 0, customer_count: null, tickets: 0, sales: 0 };
      map[key].tickets = t.tickets;
      map[key].sales = t.sales;
    });
    return Object.values(map).sort(function(a, b) {
      return a.year !== b.year ? a.year - b.year : a.week - b.week;
    });
  }, [weeklyVisitors, weeklyTraffic]);

  // Years available
  var years = useMemo(function() {
    var s = new Set();
    weekly.forEach(function(w) { s.add(w.year); });
    return [...s].sort();
  }, [weekly]);

  var currentYear = years.length ? years[years.length - 1] : new Date().getFullYear();
  var lastVisitorWeek = useMemo(function() {
    var withV = weekly.filter(function(w) { return w.year === currentYear && w.visitors > 0; });
    if (!withV.length) return null;
    return withV[withV.length - 1].week;
  }, [weekly, currentYear]);
  var lastTicketWeek = useMemo(function() {
    var withT = weekly.filter(function(w) { return w.year === currentYear && w.tickets > 0; });
    if (!withT.length) return null;
    return withT[withT.length - 1].week;
  }, [weekly, currentYear]);

  // YTD = sum t/m lastVisitorWeek (or t/m latest week if no visitors)
  // Both visitors and tickets clipped to same week for consistent conversion
  var ytdCutoff = lastVisitorWeek || lastTicketWeek || 53;

  var cyYTD = useMemo(function() {
    var f = weekly.filter(function(w) { return w.year === currentYear && w.week <= ytdCutoff; });
    return {
      visitors: f.reduce(function(s, w) { return s + (w.visitors || 0); }, 0),
      tickets: f.reduce(function(s, w) { return s + (w.tickets || 0); }, 0),
      sales: f.reduce(function(s, w) { return s + (w.sales || 0); }, 0),
    };
  }, [weekly, currentYear, ytdCutoff]);

  var lyYTD = useMemo(function() {
    var f = weekly.filter(function(w) { return w.year === currentYear - 1 && w.week <= ytdCutoff; });
    return {
      visitors: f.reduce(function(s, w) { return s + (w.visitors || 0); }, 0),
      tickets: f.reduce(function(s, w) { return s + (w.tickets || 0); }, 0),
      sales: f.reduce(function(s, w) { return s + (w.sales || 0); }, 0),
    };
  }, [weekly, currentYear, ytdCutoff]);

  // For table: filtered by yearFilter
  var weeklyFiltered = useMemo(function() {
    if (yearFilter === 'all') return [...weekly].sort(function(a, b) { return b.year !== a.year ? b.year - a.year : b.week - a.week; });
    return weekly.filter(function(w) { return w.year === yearFilter }).sort(function(a, b) { return b.week - a.week; });
  }, [weekly, yearFilter]);

  // CY / LY arrays for charts: weeks 1-53
  var cyArr = useMemo(function() {
    var arr = [];
    for (var i = 1; i <= 53; i++) {
      var r = weekly.find(function(w) { return w.year === currentYear && w.week === i; });
      arr.push(r || null);
    }
    return arr;
  }, [weekly, currentYear]);

  var lyArr = useMemo(function() {
    var arr = [];
    for (var i = 1; i <= 53; i++) {
      var r = weekly.find(function(w) { return w.year === currentYear - 1 && w.week === i; });
      arr.push(r || null);
    }
    return arr;
  }, [weekly, currentYear]);

  // Find last week with data to determine chart x-axis
  var maxWeek = useMemo(function() {
    var m = 0;
    cyArr.forEach(function(w, i) { if (w && (w.visitors || w.tickets)) m = Math.max(m, i + 1); });
    lyArr.forEach(function(w, i) { if (w && (w.visitors || w.tickets)) m = Math.max(m, i + 1); });
    return Math.max(m, 52);
  }, [cyArr, lyArr]);

  // Render charts
  useEffect(function() {
    Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); });
    chartsRef.current = {};
    if (loading || !weekly.length) return;

    var labels = [];
    for (var i = 1; i <= maxWeek; i++) labels.push('W' + i);
    var cyV = cyArr.slice(0, maxWeek).map(function(w) { return w ? w.visitors : null; });
    var lyV = lyArr.slice(0, maxWeek).map(function(w) { return w ? w.visitors : null; });
    var cyT = cyArr.slice(0, maxWeek).map(function(w) { return w ? w.tickets : null; });
    var lyT = lyArr.slice(0, maxWeek).map(function(w) { return w ? w.tickets : null; });
    var cyConv = cyArr.slice(0, maxWeek).map(function(w) { return w && w.visitors ? (w.tickets / w.visitors * 100) : null; });
    var lyConv = lyArr.slice(0, maxWeek).map(function(w) { return w && w.visitors ? (w.tickets / w.visitors * 100) : null; });
    var cyAvg = cyArr.slice(0, maxWeek).map(function(w) { return w && w.tickets ? (w.sales / w.tickets) : null; });
    var lyAvg = lyArr.slice(0, maxWeek).map(function(w) { return w && w.tickets ? (w.sales / w.tickets) : null; });

    var co = {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      interaction: { mode: 'index', intersect: false },
    };

    if (visitorsRef.current) {
      chartsRef.current.v = new Chart(visitorsRef.current, { type: 'bar', data: { labels: labels, datasets: [
        { label: currentYear + ' Bezoekers', data: cyV, backgroundColor: 'rgba(232,78,27,0.25)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, order: 2 },
        { label: (currentYear - 1) + ' Bezoekers', data: lyV, type: 'line', borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 3, tension: 0.3, fill: false, order: 1, spanGaps: true },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(c.raw); } } } }) }) });
    }

    if (conversionRef.current && cyConv.some(function(v) { return v !== null; })) {
      chartsRef.current.c = new Chart(conversionRef.current, { type: 'line', data: { labels: labels, datasets: [
        { label: currentYear + ' Conversie %', data: cyConv, borderColor: '#E84E1B', backgroundColor: 'rgba(232,78,27,0.08)', pointBackgroundColor: '#E84E1B', pointRadius: 3, tension: 0.3, fill: true, borderWidth: 2.5, spanGaps: true },
        { label: (currentYear - 1) + ' Conversie %', data: lyConv, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 3, tension: 0.3, fill: false, borderWidth: 2, spanGaps: true },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: function(v) { return v + '%'; } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmtP(c.raw); } } } }) }) });
    }

    if (ticketRef.current && storeMeta.hasSales) {
      chartsRef.current.t = new Chart(ticketRef.current, { type: 'line', data: { labels: labels, datasets: [
        { label: currentYear + ' Gem. Bon', data: cyAvg, borderColor: '#1B3A5C', backgroundColor: 'rgba(27,58,92,0.08)', pointBackgroundColor: '#1B3A5C', pointRadius: 3, tension: 0.3, fill: true, borderWidth: 2.5, spanGaps: true },
        { label: (currentYear - 1) + ' Gem. Bon', data: lyAvg, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 3, tension: 0.3, fill: false, borderWidth: 2, spanGaps: true },
      ] }, options: Object.assign({}, co, { scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: function(v) { return storeMeta.currency + ' ' + v; } }, grid: { color: '#f0ebe5' } } }, plugins: Object.assign({}, co.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + storeMeta.currency + ' ' + fmt(Math.round(c.raw)); } } } }) }) });
    }

    if (comboRef.current && storeMeta.hasSales) {
      chartsRef.current.cb = new Chart(comboRef.current, { type: 'bar', data: { labels: labels, datasets: [
        { label: currentYear + ' Tickets', data: cyT, backgroundColor: 'rgba(232,78,27,0.2)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
        { label: (currentYear - 1) + ' Tickets', data: lyT, backgroundColor: 'rgba(136,136,136,0.15)', borderColor: '#888', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 3 },
        { label: currentYear + ' Gem. Bon', data: cyAvg, type: 'line', borderColor: '#1B3A5C', pointBackgroundColor: '#1B3A5C', pointRadius: 3, tension: 0.3, fill: false, borderWidth: 2.5, yAxisID: 'y1', order: 1, spanGaps: true },
      ] }, options: { responsive: true, maintainAspectRatio: false, plugins: co.plugins, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { position: 'left', ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } }, y1: { position: 'right', ticks: { callback: function(v) { return storeMeta.currency + ' ' + v; } }, grid: { display: false } } } } });
    }

    return function() { Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); }); };
  }, [weekly, currentYear, cyArr, lyArr, maxWeek, loading, tab, storeMeta]);

  if (loading) return <LoadingLogo text="Bezoekers & conversie laden..." />;
  if (!trafficData.length && !visitorData.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  var cyConvYTD = cyYTD.visitors ? (cyYTD.tickets / cyYTD.visitors * 100) : 0;
  var lyConvYTD = lyYTD.visitors ? (lyYTD.tickets / lyYTD.visitors * 100) : 0;
  var cyAvgYTD = cyYTD.tickets ? (cyYTD.sales / cyYTD.tickets) : 0;
  var lyAvgYTD = lyYTD.tickets ? (lyYTD.sales / lyYTD.tickets) : 0;
  var hasVisitors = cyYTD.visitors > 0;

  return (
    <div className="max-w-[1520px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Bezoekers & Conversie</h1>
          <p className="text-[13px] text-[#6b5240]">{storeMeta.label} · vergelijking met {currentYear - 1}</p>
          <div className="flex flex-col gap-0.5 mt-1">
            {lastVisitorWeek && <span className="text-[11px] text-[#a08a74]">{'Alle vergelijkingen t/m W' + lastVisitorWeek + ' ' + currentYear + ' (laatste bezoekersweek)'}</span>}
            {lastTicketWeek && lastTicketWeek !== lastVisitorWeek && <span className="text-[10px] text-[#c4a890] italic">{'Tickets data beschikbaar t/m W' + lastTicketWeek + ', maar afgekapt voor consistente conversie'}</span>}
          </div>
        </div>
      </div>

      {/* Store tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['bd', 'Building Depot Curaçao'], ['bonaire', 'Bonaire'], ['multimart', 'Multimart'], ['keuken', 'Keuken Depot']].map(function(item) {
          return <button key={item[0]} onClick={function() { setTab(item[0]); setYearFilter('all'); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (tab === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* KPIs */}
      <div className={'grid grid-cols-2 gap-4 mb-5 ' + (storeMeta.hasSales && hasVisitors ? 'md:grid-cols-5' : storeMeta.hasSales ? 'md:grid-cols-3' : hasVisitors ? 'md:grid-cols-1' : '')}>
        {hasVisitors && <KPI label="Bezoekers YTD" value={fmtK(cyYTD.visitors)} sub={lyYTD.visitors ? ('LY: ' + fmtK(lyYTD.visitors) + ' (' + (pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.visitors, lyYTD.visitors)) + ')') : '—'} subColor={pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '#16a34a' : '#dc2626'} icon="👥" />}
        {storeMeta.hasSales && <KPI label="Tickets YTD" value={fmtK(cyYTD.tickets)} sub={lyYTD.tickets ? ('LY: ' + fmtK(lyYTD.tickets) + ' (' + (pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.tickets, lyYTD.tickets)) + ')') : '—'} subColor={pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '#16a34a' : '#dc2626'} icon="🧾" />}
        {storeMeta.hasSales && hasVisitors && <KPI label="Conversie YTD" value={fmtP(cyConvYTD)} sub={lyConvYTD ? ('LY: ' + fmtP(lyConvYTD) + ' (' + (cyConvYTD - lyConvYTD >= 0 ? '+' : '') + (cyConvYTD - lyConvYTD).toFixed(1) + 'pp)') : '—'} subColor={cyConvYTD >= lyConvYTD ? '#16a34a' : '#dc2626'} icon="🎯" />}
        {storeMeta.hasSales && <KPI label="Gem. Bonbedrag" value={storeMeta.currency + ' ' + fmt(Math.round(cyAvgYTD))} sub={lyAvgYTD ? ('LY: ' + storeMeta.currency + ' ' + fmt(Math.round(lyAvgYTD)) + ' (' + (pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '+' : '') + fmtP(pctChg(cyAvgYTD, lyAvgYTD)) + ')') : '—'} subColor={pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '#16a34a' : '#dc2626'} icon="💰" />}
        {storeMeta.hasSales && <KPI label="Omzet YTD" value={storeMeta.currency + ' ' + fmtK(cyYTD.sales)} sub={lyYTD.sales ? ('LY: ' + storeMeta.currency + ' ' + fmtK(lyYTD.sales) + ' (' + (pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.sales, lyYTD.sales)) + ')') : '—'} subColor={pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '#16a34a' : '#dc2626'} icon="📊" />}
      </div>

      {/* Charts */}
      {hasVisitors && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-4">
          <h3 className="text-[15px] font-bold mb-4">{storeMeta.label} — Bezoekers per week</h3>
          <div style={{ height: '300px' }}><canvas ref={visitorsRef}></canvas></div>
        </div>
      )}

      {storeMeta.hasSales && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          {hasVisitors && <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[15px] font-bold mb-4">Conversie % (tickets / bezoekers)</h3>
            <div style={{ height: '280px' }}><canvas ref={conversionRef}></canvas></div>
          </div>}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[15px] font-bold mb-4">Gemiddeld bonbedrag ({storeMeta.currency})</h3>
            <div style={{ height: '280px' }}><canvas ref={ticketRef}></canvas></div>
          </div>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm lg:col-span-2">
            <h3 className="text-[15px] font-bold mb-4">Tickets & Gemiddeld Bonbedrag</h3>
            <div style={{ height: '280px' }}><canvas ref={comboRef}></canvas></div>
          </div>
        </div>
      )}

      {/* Weekly table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="flex items-center justify-between p-4 border-b border-[#e5ddd4]">
          <h3 className="text-[15px] font-bold">Wekelijks Overzicht</h3>
          <div className="flex gap-1">
            <Pill label="Alle jaren" active={yearFilter === 'all'} onClick={function() { setYearFilter('all'); }} />
            {years.map(function(y) { return <Pill key={y} label={y} active={yearFilter === y} onClick={function() { setYearFilter(y); }} />; })}
          </div>
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f0ebe5] sticky top-0">
                <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-left">Week</th>
                {hasVisitors && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">Bezoekers</th>}
                {storeMeta.hasSales && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">Tickets</th>}
                {storeMeta.hasSales && hasVisitors && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">Conversie</th>}
                {storeMeta.hasSales && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">Omzet</th>}
                {storeMeta.hasSales && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">Gem. Bon</th>}
                {hasVisitors && <th className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right">vs LY Bez.</th>}
              </tr>
            </thead>
            <tbody>
              {weeklyFiltered.map(function(r, i) {
                var ly = weekly.find(function(d) { return d.year === r.year - 1 && d.week === r.week; });
                var conv = r.visitors ? (r.tickets / r.visitors * 100) : 0;
                var avg = r.tickets ? (r.sales / r.tickets) : 0;
                var vChg = ly && ly.visitors ? pctChg(r.visitors, ly.visitors) : null;
                return (
                  <tr key={r.year + '-' + r.week} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{'W' + r.week + ' ' + r.year}</td>
                    {hasVisitors && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{r.visitors ? fmt(r.visitors) : '-'}</td>}
                    {storeMeta.hasSales && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{r.tickets ? fmt(r.tickets) : '-'}</td>}
                    {storeMeta.hasSales && hasVisitors && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: conv >= 50 ? '#16a34a' : '#d97706' }}>{r.visitors && r.tickets ? fmtP(conv) : '-'}</td>}
                    {storeMeta.hasSales && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{r.sales ? (storeMeta.currency + ' ' + fmtK(r.sales)) : '-'}</td>}
                    {storeMeta.hasSales && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold">{r.tickets ? (storeMeta.currency + ' ' + fmt(Math.round(avg))) : '-'}</td>}
                    {hasVisitors && <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: vChg !== null ? (vChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{vChg !== null ? ((vChg >= 0 ? '+' : '') + fmtP(vChg)) : '-'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="text-[10px] text-[#6b5240] space-y-1">
          <p><strong>Conversie</strong> = tickets ÷ bezoekers × 100%. <strong>Gem. Bonbedrag</strong> = omzet ÷ tickets.</p>
          <p>Bezoekers per week komen uit wekelijkse export van Marketing. Tickets en omzet zijn geaggregeerd uit dagelijkse Compass data.</p>
          {!storeMeta.hasSales && <p><em>Keuken Depot heeft alleen bezoekersaantallen — omzet zit bij Building Depot Curaçao.</em></p>}
        </div>
      </div>
    </div>
  );
}