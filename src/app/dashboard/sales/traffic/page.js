/* ============================================================
   BESTAND: page_traffic.js
   KOPIEER NAAR: src/app/dashboard/sales/traffic/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a); };
var fmtP = function(n) { return (n || 0).toFixed(1) + '%'; };
var fmtC = function(n) { return 'Cg ' + fmt(Math.round(n || 0)); };

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
  var _yr = useState('all'), yearFilter = _yr[0], setYearFilter = _yr[1];
  var _st = useState('1'), store = _st[0], setStore = _st[1];

  var visitorsRef = useRef(null);
  var conversionRef = useRef(null);
  var ticketRef = useRef(null);
  var comboRef = useRef(null);
  var chartsRef = useRef({});

  var supabase = createClient();
  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var r = await supabase.from('traffic_data').select('*').order('year').order('month');
    if (r.data) setData(r.data);
    setLoading(false);
  }

  var years = useMemo(function() {
    var s = {};
    data.filter(function(r) { return r.store_number === store; }).forEach(function(r) { s[r.year] = true; });
    return Object.keys(s).sort();
  }, [data, store]);

  var storeData = useMemo(function() {
    return data.filter(function(r) { return r.store_number === store; });
  }, [data, store]);

  var filtered = useMemo(function() {
    if (yearFilter === 'all') return storeData;
    return storeData.filter(function(r) { return String(r.year) === yearFilter; });
  }, [storeData, yearFilter]);

  // Current year & LY comparison
  var currentYear = useMemo(function() { return storeData.length ? Math.max.apply(null, storeData.map(function(r) { return r.year; })) : 2026; }, [storeData]);

  var cyData = useMemo(function() { return storeData.filter(function(r) { return r.year === currentYear; }); }, [storeData, currentYear]);
  var lyData = useMemo(function() { return storeData.filter(function(r) { return r.year === currentYear - 1; }); }, [storeData, currentYear]);

  // YTD totals
  var maxMonth = useMemo(function() { return cyData.length ? Math.max.apply(null, cyData.map(function(r) { return r.month; })) : 0; }, [cyData]);
  var cyYTD = useMemo(function() {
    var d = cyData.filter(function(r) { return r.month <= maxMonth; });
    return { visitors: d.reduce(function(s, r) { return s + (r.visitors || 0); }, 0), tickets: d.reduce(function(s, r) { return s + (r.tickets || 0); }, 0), sales: d.reduce(function(s, r) { return s + parseFloat(r.total_sales || 0); }, 0) };
  }, [cyData, maxMonth]);
  var lyYTD = useMemo(function() {
    var d = lyData.filter(function(r) { return r.month <= maxMonth; });
    return { visitors: d.reduce(function(s, r) { return s + (r.visitors || 0); }, 0), tickets: d.reduce(function(s, r) { return s + (r.tickets || 0); }, 0), sales: d.reduce(function(s, r) { return s + parseFloat(r.total_sales || 0); }, 0) };
  }, [lyData, maxMonth]);

  var pctChg = function(a, b) { return b ? ((a - b) / Math.abs(b) * 100) : 0; };

  // Render charts
  useEffect(function() {
    Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); });
    chartsRef.current = {};
    if (!storeData.length) return;

    var labels = [], cyVisitors = [], lyVisitors = [], cyConv = [], lyConv = [], cyAvg = [], lyAvg = [], cyTickets = [], lyTickets = [];

    for (var m = 1; m <= 12; m++) {
      labels.push(MN[m - 1]);
      var cy = cyData.find(function(r) { return r.month === m; });
      var ly = lyData.find(function(r) { return r.month === m; });
      cyVisitors.push(cy ? cy.visitors : null);
      lyVisitors.push(ly ? ly.visitors : null);
      cyConv.push(cy ? parseFloat(cy.conversion_rate) : null);
      lyConv.push(ly ? parseFloat(ly.conversion_rate) : null);
      cyAvg.push(cy ? parseFloat(cy.avg_ticket_value) : null);
      lyAvg.push(ly ? parseFloat(ly.avg_ticket_value) : null);
      cyTickets.push(cy ? cy.tickets : null);
      lyTickets.push(ly ? ly.tickets : null);
    }

    var commonOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f0ebe5' } } } };

    // 1. Visitors chart
    if (visitorsRef.current) {
      chartsRef.current.visitors = new Chart(visitorsRef.current, {
        type: 'bar',
        data: { labels: labels, datasets: [
          { label: currentYear + ' Bezoekers', data: cyVisitors, backgroundColor: 'rgba(232,78,27,0.25)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, order: 2 },
          { label: (currentYear - 1) + ' Bezoekers', data: lyVisitors, type: 'line', borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, order: 1 },
        ] },
        options: Object.assign({}, commonOpts, { plugins: Object.assign({}, commonOpts.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(c.raw); } } } }), scales: Object.assign({}, commonOpts.scales, { y: { ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } } }) }),
      });
    }

    // 2. Conversion rate chart
    if (conversionRef.current) {
      chartsRef.current.conversion = new Chart(conversionRef.current, {
        type: 'line',
        data: { labels: labels, datasets: [
          { label: currentYear + ' Conversie %', data: cyConv, borderColor: '#E84E1B', backgroundColor: 'rgba(232,78,27,0.08)', pointBackgroundColor: '#E84E1B', pointRadius: 5, tension: 0.3, fill: true, borderWidth: 2.5 },
          { label: (currentYear - 1) + ' Conversie %', data: lyConv, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2 },
        ] },
        options: Object.assign({}, commonOpts, { plugins: Object.assign({}, commonOpts.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmtP(c.raw); } } } }), scales: Object.assign({}, commonOpts.scales, { y: { ticks: { callback: function(v) { return v + '%'; } }, grid: { color: '#f0ebe5' } } }) }),
      });
    }

    // 3. Average ticket value chart
    if (ticketRef.current) {
      chartsRef.current.ticket = new Chart(ticketRef.current, {
        type: 'line',
        data: { labels: labels, datasets: [
          { label: currentYear + ' Gem. Bon', data: cyAvg, borderColor: '#1B3A5C', backgroundColor: 'rgba(27,58,92,0.08)', pointBackgroundColor: '#1B3A5C', pointRadius: 5, tension: 0.3, fill: true, borderWidth: 2.5 },
          { label: (currentYear - 1) + ' Gem. Bon', data: lyAvg, borderColor: '#888', borderDash: [5, 5], pointBackgroundColor: '#888', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2 },
        ] },
        options: Object.assign({}, commonOpts, { plugins: Object.assign({}, commonOpts.plugins, { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': Cg ' + fmt(Math.round(c.raw)); } } } }), scales: Object.assign({}, commonOpts.scales, { y: { ticks: { callback: function(v) { return 'Cg ' + v; } }, grid: { color: '#f0ebe5' } } }) }),
      });
    }

    // 4. Combo chart: tickets + avg ticket
    if (comboRef.current) {
      chartsRef.current.combo = new Chart(comboRef.current, {
        type: 'bar',
        data: { labels: labels, datasets: [
          { label: currentYear + ' Tickets', data: cyTickets, backgroundColor: 'rgba(232,78,27,0.2)', borderColor: '#E84E1B', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 2 },
          { label: (currentYear - 1) + ' Tickets', data: lyTickets, backgroundColor: 'rgba(136,136,136,0.15)', borderColor: '#888', borderWidth: 1, borderRadius: 4, yAxisID: 'y', order: 3 },
          { label: currentYear + ' Gem. Bon', data: cyAvg, type: 'line', borderColor: '#1B3A5C', pointBackgroundColor: '#1B3A5C', pointRadius: 4, tension: 0.3, fill: false, borderWidth: 2.5, yAxisID: 'y1', order: 1 },
        ] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } },
            tooltip: { callbacks: { label: function(c) { return c.dataset.label.includes('Bon') ? c.dataset.label + ': Cg ' + fmt(Math.round(c.raw)) : c.dataset.label + ': ' + fmt(c.raw); } } } },
          scales: { x: { grid: { display: false } }, y: { position: 'left', ticks: { callback: function(v) { return fmtK(v); } }, grid: { color: '#f0ebe5' } }, y1: { position: 'right', ticks: { callback: function(v) { return 'Cg ' + v; } }, grid: { display: false } } }
        },
      });
    }

    return function() { Object.values(chartsRef.current).forEach(function(c) { if (c) c.destroy(); }); };
  }, [storeData, cyData, lyData, currentYear]);

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Bezoekers & conversie laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen traffic data beschikbaar.</p></div>;

  var cyConvYTD = cyYTD.visitors ? (cyYTD.tickets / cyYTD.visitors * 100) : 0;
  var lyConvYTD = lyYTD.visitors ? (lyYTD.tickets / lyYTD.visitors * 100) : 0;
  var cyAvgYTD = cyYTD.tickets ? (cyYTD.sales / cyYTD.tickets) : 0;
  var lyAvgYTD = lyYTD.tickets ? (lyYTD.sales / lyYTD.tickets) : 0;
  var storeName = store === '1' ? 'Curaçao' : 'Bonaire';
  var hasVisitors = cyYTD.visitors > 0;

  return (
    <div className="max-w-[1520px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Bezoekers & Conversie</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot ' + storeName + ' — YTD ' + currentYear + (maxMonth ? ' t/m ' + MN[maxMonth - 1] : '') + ' vs ' + (currentYear - 1)}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeName}</div>
      </div>

      {/* Store filter */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">
            <Pill label="Curaçao" active={store === '1'} onClick={function() { setStore('1'); setYearFilter('all'); }} />
            <Pill label="Bonaire" active={store === 'B'} onClick={function() { setStore('B'); setYearFilter('all'); }} />
          </div>
        </div>
      </div>

      {!hasVisitors && store === 'B' && (
        <div className="bg-amber-50 border border-amber-200 rounded-[14px] p-4 mb-5 text-[13px] text-amber-700">
          Bezoekersaantallen voor Bonaire zijn nog niet beschikbaar. Conversiepercentage kan niet worden berekend. Tickets en omzet worden wel getoond.
        </div>
      )}

      {/* KPI tiles */}
      <div className={'grid grid-cols-2 gap-4 mb-5 ' + (hasVisitors ? 'md:grid-cols-5' : 'md:grid-cols-3')}>
        {hasVisitors && <KPI label="Bezoekers YTD" value={fmtK(cyYTD.visitors)} sub={'LY: ' + fmtK(lyYTD.visitors) + ' (' + (pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.visitors, lyYTD.visitors)) + ')'} subColor={pctChg(cyYTD.visitors, lyYTD.visitors) >= 0 ? '#16a34a' : '#dc2626'} icon="👥" />}
        <KPI label="Tickets YTD" value={fmtK(cyYTD.tickets)} sub={'LY: ' + fmtK(lyYTD.tickets) + ' (' + (pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.tickets, lyYTD.tickets)) + ')'} subColor={pctChg(cyYTD.tickets, lyYTD.tickets) >= 0 ? '#16a34a' : '#dc2626'} icon="🧾" />
        {hasVisitors && <KPI label="Conversie YTD" value={fmtP(cyConvYTD)} sub={'LY: ' + fmtP(lyConvYTD) + ' (' + (cyConvYTD - lyConvYTD >= 0 ? '+' : '') + (cyConvYTD - lyConvYTD).toFixed(1) + 'pp)'} subColor={cyConvYTD >= lyConvYTD ? '#16a34a' : '#dc2626'} icon="🎯" />}
        <KPI label="Gem. Bonbedrag" value={'Cg ' + fmt(Math.round(cyAvgYTD))} sub={'LY: Cg ' + fmt(Math.round(lyAvgYTD)) + ' (' + (pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '+' : '') + fmtP(pctChg(cyAvgYTD, lyAvgYTD)) + ')'} subColor={pctChg(cyAvgYTD, lyAvgYTD) >= 0 ? '#16a34a' : '#dc2626'} icon="💰" />
        <KPI label="Omzet YTD" value={fmtK(cyYTD.sales)} sub={'LY: ' + fmtK(lyYTD.sales) + ' (' + (pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '+' : '') + fmtP(pctChg(cyYTD.sales, lyYTD.sales)) + ')'} subColor={pctChg(cyYTD.sales, lyYTD.sales) >= 0 ? '#16a34a' : '#dc2626'} icon="📊" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Bezoekers per maand</h3>
          <div style={{ height: '280px' }}><canvas ref={visitorsRef}></canvas></div>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Conversie % (tickets / bezoekers)</h3>
          <div style={{ height: '280px' }}><canvas ref={conversionRef}></canvas></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Gemiddeld bonbedrag (Cg)</h3>
          <div style={{ height: '280px' }}><canvas ref={ticketRef}></canvas></div>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Tickets & Gemiddeld Bonbedrag</h3>
          <div style={{ height: '280px' }}><canvas ref={comboRef}></canvas></div>
        </div>
      </div>

      {/* Monthly detail table */}
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
                {['Maand', 'Bezoekers', 'Tickets', 'Conversie', 'Omzet', 'Gem. Bon', 'vs LY Bezoekers', 'vs LY Conversie', 'vs LY Gem. Bon'].map(function(h) {
                  return <th key={h} className="p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] text-right first:text-left">{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(r, i) {
                var ly = data.find(function(d) { return d.year === r.year - 1 && d.month === r.month; });
                var vChg = ly ? pctChg(r.visitors, ly.visitors) : null;
                var cChg = ly ? (parseFloat(r.conversion_rate) - parseFloat(ly.conversion_rate)) : null;
                var aChg = ly ? pctChg(parseFloat(r.avg_ticket_value), parseFloat(ly.avg_ticket_value)) : null;
                return (
                  <tr key={r.year + '-' + r.month} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{MN[r.month - 1] + ' ' + r.year}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(r.visitors)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(r.tickets)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: parseFloat(r.conversion_rate) >= 50 ? '#16a34a' : '#d97706' }}>{fmtP(parseFloat(r.conversion_rate))}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmtK(parseFloat(r.total_sales))}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold">{'Cg ' + fmt(Math.round(parseFloat(r.avg_ticket_value)))}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: vChg !== null ? (vChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{vChg !== null ? ((vChg >= 0 ? '+' : '') + fmtP(vChg)) : '-'}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: cChg !== null ? (cChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{cChg !== null ? ((cChg >= 0 ? '+' : '') + cChg.toFixed(1) + 'pp') : '-'}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{ color: aChg !== null ? (aChg >= 0 ? '#16a34a' : '#dc2626') : '#a08a74' }}>{aChg !== null ? ((aChg >= 0 ? '+' : '') + fmtP(aChg)) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Insight summary */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="text-[10px] text-[#6b5240] space-y-1">
          <p><strong>Conversie</strong> = aantal tickets ÷ aantal bezoekers × 100%. Hoger = meer bezoekers kopen iets.</p>
          <p><strong>Gem. Bonbedrag</strong> = totale omzet ÷ aantal tickets. Hoger = klanten besteden meer per bezoek.</p>
          <p><strong>Omzet</strong> = Bezoekers × Conversie × Gem. Bonbedrag. Groei komt uit meer bezoekers, hogere conversie, of hogere bonbedragen.</p>
        </div>
      </div>
    </div>
  );
}
