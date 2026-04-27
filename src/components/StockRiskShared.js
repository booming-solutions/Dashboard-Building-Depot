/* ============================================================
   BESTAND: StockRiskShared_v2.js
   KOPIEER NAAR: src/components/StockRiskShared.js
   (vervangt de huidige StockRiskShared.js)
   VERSIE: v3.28.07
   
   Wijzigingen t.o.v. v1:
   - Twee nieuwe grafieken tussen KPI-tegels en "Risico per Afdeling":
     * Links: stacked bar van NOS-status per BUM (in stock / wordt aangevuld / niet gedekt)
     * Rechts: trendlijn % NOS in stock per BUM over tijd (incl. TOTAAL lijn)
   - Beide gebruiken nieuwe tabel nos_coverage_snapshots
   - Stacked bar reageert op de Store-filter (Curacao / Bonaire / alle = Total)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtC = function(n) { return 'Cg ' + (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : fmt(a)); };
var XCG_USD = 1.82;
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

// Color palette per BUM (used in trend chart legend)
var BUM_COLORS = {
  PASCAL: '#1B3A5C',
  HENK:   '#0891b2',
  JOHN:   '#16a34a',
  DANIEL: '#a16207',
  GIJS:   '#7c3aed',
  TOTAL:  '#E84E1B',
};

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

function RiskBadge({ level }) {
  if (level === 'critical') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">KRITIEK</span>;
  if (level === 'urgent') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700">URGENT</span>;
  if (level === 'watch') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">AANDACHT</span>;
  return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700">OK</span>;
}

function CoverBar({ months, maxLT }) {
  var maxDisplay = Math.max(maxLT * 2, 6);
  var coverPct = Math.min((months / maxDisplay) * 100, 100);
  var ltPct = Math.min((maxLT / maxDisplay) * 100, 100);
  var barColor = months < 1 ? '#dc2626' : months < maxLT ? '#f97316' : months < maxLT * 1.5 ? '#d97706' : '#16a34a';
  return (
    <div className="relative h-[14px] w-[80px] bg-[#f0ebe5] rounded-sm overflow-hidden">
      <div className="absolute top-0 bottom-0 rounded-sm" style={{ width: coverPct + '%', backgroundColor: barColor, zIndex: 1 }}></div>
      <div className="absolute top-0 bottom-0 w-[2px] bg-[#1B3A5C]/60" style={{ left: ltPct + '%', zIndex: 2 }} title={'Lead time: ' + maxLT + ' mnd'}></div>
    </div>
  );
}

function Spark({ sales }) {
  var MN2 = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  var max = Math.max.apply(null, sales.concat([1]));
  var now = new Date();
  var labels = sales.map(function(v, i) {
    var monthsBack = sales.length - 1 - i;
    var d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return MN2[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  });
  return (
    <div className="flex items-end gap-px h-[18px]">
      {sales.map(function(v, i) {
        var h = max > 0 ? Math.max(1, (v / max) * 18) : 1;
        return <div key={i} className="w-[4px] rounded-t-sm cursor-default" style={{ height: h + 'px', backgroundColor: v > 0 ? '#E84E1B' : '#e5ddd4' }} title={labels[i] + ': ' + fmt(Math.round(v))}></div>;
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   NEW: NOS Stacked Bar (per BUM)
   ════════════════════════════════════════════════════════════ */
function NosStackedBar({ snapshotsToday, store }) {
  // store: 'all' (=> Total), '1' (=> Curacao), 'B' (=> Bonaire)
  var region = store === '1' ? 'Curacao' : store === 'B' ? 'Bonaire' : 'Total';

  // Filter today's snapshots for this region, exclude TOTAL bum
  var rows = snapshotsToday.filter(function(s) {
    return s.region === region && s.bum !== 'TOTAL';
  });

  // Sort by BU_ORDER
  rows.sort(function(a, b) {
    var ai = BU_ORDER.indexOf(a.bum); var bi = BU_ORDER.indexOf(b.bum);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return a.bum.localeCompare(b.bum);
  });

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
        <h3 className="text-[15px] font-bold mb-1">NOS Voorraad-status per BUM</h3>
        <p className="text-[12px] text-[#6b5240] mb-3">Nog geen snapshot beschikbaar.</p>
      </div>
    );
  }

  var regionLabel = region === 'Total' ? 'Curaçao + Bonaire' : region;

  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
      <h3 className="text-[15px] font-bold mb-1">NOS Voorraad-status per BUM</h3>
      <p className="text-[12px] text-[#6b5240] mb-3">{regionLabel} — % van NOS-items per categorie</p>
      <div className="flex items-center gap-4 text-[10px] mb-4">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> Op voorraad (QOH &gt; 0)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> Wordt aangevuld (QOO compenseert)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Niet gedekt</span>
      </div>
      <div className="space-y-2">
        {rows.map(function(r) {
          var total = r.total_nos_items || 1;
          var pIn = (r.in_stock / total) * 100;
          var pRef = (r.refilling / total) * 100;
          var pUnc = (r.uncovered / total) * 100;
          return (
            <div key={r.bum} className="flex items-center gap-2">
              <div className="w-[80px] text-right text-[11px] font-semibold text-[#1a0a04] flex-shrink-0">
                {r.bum}
              </div>
              <div className="flex-1 flex h-[20px] rounded-sm overflow-hidden bg-[#f0ebe5] relative">
                {pIn > 0 && (
                  <div
                    style={{ width: pIn + '%', backgroundColor: '#16a34a' }}
                    title={'Op voorraad: ' + r.in_stock + ' items (' + pIn.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pIn > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pIn) + '%'}</span>}
                  </div>
                )}
                {pRef > 0 && (
                  <div
                    style={{ width: pRef + '%', backgroundColor: '#d97706' }}
                    title={'Wordt aangevuld: ' + r.refilling + ' items (' + pRef.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pRef > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pRef) + '%'}</span>}
                  </div>
                )}
                {pUnc > 0 && (
                  <div
                    style={{ width: pUnc + '%', backgroundColor: '#dc2626' }}
                    title={'Niet gedekt: ' + r.uncovered + ' items (' + pUnc.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pUnc > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pUnc) + '%'}</span>}
                  </div>
                )}
              </div>
              <div className="w-[60px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">
                {fmt(total)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   NEW: NOS Trend Chart (% in stock over time per BUM)
   ════════════════════════════════════════════════════════════ */
function NosTrendChart({ allSnapshots, store }) {
  var canvasId = 'nos-trend-chart-' + (store || 'all');
  var region = store === '1' ? 'Curacao' : store === 'B' ? 'Bonaire' : 'Total';

  // Filter for this region
  var rows = allSnapshots.filter(function(s) { return s.region === region; });

  // Group by date -> { bum: pct }
  var byDate = {};
  rows.forEach(function(r) {
    if (!byDate[r.snapshot_date]) byDate[r.snapshot_date] = {};
    var pct = r.total_nos_items > 0 ? (r.in_stock / r.total_nos_items * 100) : 0;
    byDate[r.snapshot_date][r.bum] = pct;
  });
  var dates = Object.keys(byDate).sort();

  // Compute TOTAL line per date as average across BUMs (weighted by total_nos_items)
  var totalsByDate = {};
  dates.forEach(function(d) {
    var sumIn = 0, sumTot = 0;
    rows.filter(function(r) { return r.snapshot_date === d; }).forEach(function(r) {
      sumIn += r.in_stock; sumTot += r.total_nos_items;
    });
    totalsByDate[d] = sumTot > 0 ? (sumIn / sumTot * 100) : 0;
  });

  // BUMs present in data
  var bums = {};
  rows.forEach(function(r) { bums[r.bum] = true; });
  var bumList = Object.keys(bums).sort(function(a, b) {
    var ai = BU_ORDER.indexOf(a); var bi = BU_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  useEffect(function() {
    var existing = window['_nosChart_' + canvasId];
    if (existing) { existing.destroy(); }
    if (dates.length === 0) return;
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var datasets = bumList.map(function(b) {
      return {
        label: b,
        data: dates.map(function(d) { return byDate[d][b] != null ? Math.round(byDate[d][b] * 10) / 10 : null; }),
        borderColor: BUM_COLORS[b] || '#888',
        backgroundColor: 'transparent',
        pointRadius: 3,
        tension: 0.25,
        borderWidth: 2,
        spanGaps: true,
      };
    });

    // TOTAAL line
    datasets.push({
      label: 'TOTAAL',
      data: dates.map(function(d) { return Math.round(totalsByDate[d] * 10) / 10; }),
      borderColor: BUM_COLORS.TOTAL,
      backgroundColor: 'transparent',
      borderDash: [6, 3],
      pointRadius: 4,
      tension: 0.25,
      borderWidth: 3,
    });

    var labels = dates.map(function(d) {
      var p = d.split('-');
      return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1];
    });

    window['_nosChart_' + canvasId] = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + (c.raw != null ? c.raw + '%' : '—'); } } },
        },
        scales: {
          y: {
            min: 0, max: 100,
            ticks: { callback: function(v) { return v + '%'; } },
            grid: { color: '#f0ebe5' },
          },
          x: { grid: { display: false } },
        },
      },
    });

    return function() {
      var c = window['_nosChart_' + canvasId];
      if (c) { c.destroy(); window['_nosChart_' + canvasId] = null; }
    };
  }, [allSnapshots, store]);

  var regionLabel = region === 'Total' ? 'Curaçao + Bonaire' : region;

  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
      <h3 className="text-[15px] font-bold mb-1">% NOS op voorraad — verloop in tijd</h3>
      <p className="text-[12px] text-[#6b5240] mb-3">{regionLabel} — per BUM, plus TOTAAL (gestreept)</p>
      {dates.length === 0 ? (
        <div className="py-8 text-center bg-[#faf7f4] rounded-lg">
          <p className="text-[12px] text-[#6b5240]">Nog geen snapshots beschikbaar.</p>
          <p className="text-[10px] text-[#a08a74] mt-1 italic">Lijn verschijnt zodra er meer dan één snapshot is.</p>
        </div>
      ) : dates.length === 1 ? (
        <div className="py-6 text-center bg-[#faf7f4] rounded-lg">
          <p className="text-[12px] text-[#6b5240]">Eerste snapshot: {(function() { var p = dates[0].split('-'); return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + ' ' + p[0]; })()}</p>
          <p className="text-[10px] text-[#a08a74] mt-1 italic">Trendlijn verschijnt zodra er meer snapshots zijn.</p>
        </div>
      ) : (
        <div style={{ height: '300px' }}>
          <canvas id={canvasId}></canvas>
        </div>
      )}
    </div>
  );
}

// bumFilter: null = all BUMs (totaal), 'PASCAL' = only PASCAL, etc.
export default function StockRiskShared({ bumFilter }) {
  var _s = useState;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _upd = _s(null), lastUpdate = _upd[0], setLastUpdate = _upd[1];
  var _store = _s('all'), store = _store[0], setStore = _store[1];
  var _dept = _s('all'), dept = _dept[0], setDept = _dept[1];
  var _vendor = _s('all'), vendor = _vendor[0], setVendor = _vendor[1];
  var _filter = _s('urgent'), filter = _filter[0], setFilter = _filter[1];
  var _nos = _s('all'), nosFilter = _nos[0], setNosFilter = _nos[1];
  var _qoh = _s('all'), qohFilter = _qoh[0], setQohFilter = _qoh[1];
  var _sort = _s('months_cover'), sortCol = _sort[0], setSortCol = _sort[1];
  var _dir = _s('asc'), sortDir = _dir[0], setSortDir = _dir[1];
  var _rows = _s(100), tableRows = _rows[0], setTableRows = _rows[1];
  var _search = _s(''), search = _search[0], setSearch = _search[1];

  // NEW: NOS coverage snapshots
  var _nosSnap = _s([]), nosSnapshots = _nosSnap[0], setNosSnapshots = _nosSnap[1];

  var supabase = createClient();
  useEffect(function() { loadData(); loadNosSnapshots(); }, [bumFilter]);

  async function loadData() {
    setLoading(true);
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('buying_data').select('*').order('item_number').range(from, from + step - 1);
      if (bumFilter) q = q.eq('bum', bumFilter);
      var r = await q;
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    if (all.length && all[0].upload_date) {
      var dates = all.map(function(r) { return r.upload_date; }).filter(Boolean);
      dates.sort();
      setLastUpdate(dates[dates.length - 1]);
    }
    setData(all); setLoading(false);
  }

  async function loadNosSnapshots() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('nos_coverage_snapshots').select('*').order('snapshot_date', { ascending: true }).range(from, from + step - 1);
      if (bumFilter) q = q.eq('bum', bumFilter);
      var r = await q;
      if (r.error) { console.error('NOS snapshots load error:', r.error.message); break; }
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setNosSnapshots(all);
  }

  // Latest snapshot date
  var latestNosDate = useMemo(function() {
    if (!nosSnapshots.length) return null;
    return nosSnapshots.reduce(function(max, s) { return s.snapshot_date > max ? s.snapshot_date : max; }, nosSnapshots[0].snapshot_date);
  }, [nosSnapshots]);
  var todaysNosSnapshots = useMemo(function() {
    return nosSnapshots.filter(function(s) { return s.snapshot_date === latestNosDate; });
  }, [nosSnapshots, latestNosDate]);

  /* Compute risk per item */
  var items = useMemo(function() {
    if (!data.length) return [];

    var filtered = data;
    if (store === '1') filtered = data.filter(function(r) { return /^\d+$/.test(r.store_number); });
    else if (store === 'B') filtered = data.filter(function(r) { return !(/^\d+$/.test(r.store_number)); });

    var map = {};
    filtered.forEach(function(r) {
      var key = r.item_number;
      var isBon = !(/^\d+$/.test(r.store_number));
      var cFactor = isBon ? XCG_USD : 1;
      if (!map[key]) {
        map[key] = {
          item: r.item_number, desc: r.item_description,
          dept_code: r.dept_code, dept_name: r.dept_name,
          bum: r.bum || '', vendor: r.vendor_name || 'ONBEKEND',
          nos: r.nos === 'N',
          min_lt: parseFloat(r.min_lead_time) || 0,
          max_lt: parseFloat(r.max_lead_time) || 3,
          qoh: 0, qa: 0, qoo: 0, inv_value: 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      m.qoh += parseFloat(r.qoh) || 0;
      m.qa += parseFloat(r.qty_available) || 0;
      m.qoo += parseFloat(r.qty_on_order) || 0;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });

    var list = Object.values(map);

    list.forEach(function(m) {
      m.cost = m.qoh > 0 ? m.inv_value / m.qoh : 0;
      m.salesChrono = m.sales.slice().reverse();

      var nonZero = m.sales.filter(function(s) { return s > 0; });
      m.avg_monthly = nonZero.length ? nonZero.reduce(function(a, b) { return a + b; }, 0) / nonZero.length : 0;
      m.active_months = nonZero.length;

      m.available = m.qoh + m.qoo;
      m.months_cover = m.avg_monthly > 0 ? m.available / m.avg_monthly : (m.available > 0 ? 99 : 0);

      if (m.avg_monthly <= 0) {
        m.risk = 'ok';
      } else if (m.months_cover < 1) {
        m.risk = 'critical';
      } else if (m.months_cover < m.max_lt) {
        m.risk = 'urgent';
      } else if (m.months_cover < m.max_lt * 1.5) {
        m.risk = 'watch';
      } else {
        m.risk = 'ok';
      }

      m.stockout_months = m.avg_monthly > 0 ? m.qoh / m.avg_monthly : 99;
      m.value_at_risk = (m.risk === 'critical' || m.risk === 'urgent') ? m.inv_value : 0;

      if (m.risk === 'critical' || m.risk === 'urgent') {
        var target = m.avg_monthly * (m.max_lt + 1);
        m.suggested_qty = Math.max(0, Math.round(target - m.available));
        m.suggested_value = m.suggested_qty * m.cost;
      } else {
        m.suggested_qty = 0;
        m.suggested_value = 0;
      }
    });

    list = list.filter(function(m) { return m.avg_monthly > 0; });

    return list;
  }, [data, store]);

  var depts = useMemo(function() { var s = {}; items.forEach(function(m) { s[m.dept_code] = m.dept_name; }); return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0); }); }, [items]);
  var vendors = useMemo(function() { var s = {}; items.forEach(function(m) { if (m.vendor) s[m.vendor] = true; }); return Object.keys(s).sort(); }, [items]);

  var filteredBase = useMemo(function() {
    var src = items;
    if (nosFilter === 'yes') src = src.filter(function(m) { return m.nos; });
    else if (nosFilter === 'no') src = src.filter(function(m) { return !m.nos; });
    if (qohFilter === 'positive') src = src.filter(function(m) { return m.qoh > 0; });
    if (dept !== 'all') src = src.filter(function(m) { return m.dept_code === dept; });
    if (vendor !== 'all') src = src.filter(function(m) { return m.vendor === vendor; });
    return src;
  }, [items, nosFilter, qohFilter, dept, vendor]);

  var displayed = useMemo(function() {
    var list = filteredBase || [];

    if (filter === 'critical') list = list.filter(function(m) { return m.risk === 'critical'; });
    else if (filter === 'urgent') list = list.filter(function(m) { return m.risk === 'critical' || m.risk === 'urgent'; });
    else if (filter === 'watch') list = list.filter(function(m) { return m.risk !== 'ok'; });

    if (search) {
      var s = search.toLowerCase();
      list = list.filter(function(m) {
        return (m.item || '').toLowerCase().includes(s) ||
               (m.desc || '').toLowerCase().includes(s) ||
               (m.vendor || '').toLowerCase().includes(s);
      });
    }

    list = list.slice().sort(function(a, b) {
      var av = a[sortCol] || 0, bv = b[sortCol] || 0;
      if (typeof av === 'string') return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [filteredBase, filter, search, sortCol, sortDir]);

  var totals = useMemo(function() {
    var src = filteredBase || [];
    var critical = src.filter(function(m) { return m.risk === 'critical'; });
    var urgent = src.filter(function(m) { return m.risk === 'urgent'; });
    var watch = src.filter(function(m) { return m.risk === 'watch'; });
    var nosCritical = src.filter(function(m) { return m.nos && (m.risk === 'critical' || m.risk === 'urgent'); });
    var valueAtRisk = critical.concat(urgent).reduce(function(s, m) { return s + m.inv_value; }, 0);
    var suggestedValue = critical.concat(urgent).reduce(function(s, m) { return s + m.suggested_value; }, 0);
    return {
      total_items: src.length,
      critical: critical.length,
      urgent: urgent.length,
      watch: watch.length,
      total_risk: critical.length + urgent.length,
      nos_at_risk: nosCritical.length,
      value_at_risk: valueAtRisk,
      suggested_value: suggestedValue,
    };
  }, [filteredBase]);

  var deptRisk = useMemo(function() {
    var map = {};
    (filteredBase || []).forEach(function(m) {
      var dc = m.dept_code;
      if (!map[dc]) map[dc] = { code: dc, name: m.dept_name, bum: m.bum, total: 0, critical: 0, urgent: 0, watch: 0, ok: 0, nos_risk: 0, value_at_risk: 0 };
      map[dc].total++;
      map[dc][m.risk]++;
      if (m.nos && (m.risk === 'critical' || m.risk === 'urgent')) map[dc].nos_risk++;
      if (m.risk === 'critical' || m.risk === 'urgent') map[dc].value_at_risk += m.inv_value;
    });
    return Object.values(map).sort(function(a, b) { return (b.critical + b.urgent) - (a.critical + a.urgent); });
  }, [filteredBase]);

  function toggleSort(col) { if (sortCol === col) setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; }); else { setSortCol(col); setSortDir(col === 'months_cover' || col === 'stockout_months' ? 'asc' : 'desc'); } }
  var arrow = function(col) { return sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  var title = bumFilter ? 'Stock Risk Alert — ' + bumFilter : 'Stock Risk Alert — Totaaloverzicht';
  var subtitle = bumFilter
    ? 'Items at risk voor ' + bumFilter + ' — welke producten gaan op raken vóór nieuwe levering?'
    : 'Alle BUMs — welke producten gaan op raken vóór nieuwe levering?';
  var updateLabel = lastUpdate ? (function() { var p = lastUpdate.split('-'); var MN2 = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']; return 'Data t/m ' + parseInt(p[2]) + ' ' + MN2[parseInt(p[1])-1] + ' ' + p[0]; })() : '';

  if (loading) return <LoadingLogo text={'Stock Risk laden' + (bumFilter ? ' (' + bumFilter + ')' : '') + '...'} />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  return (
    <div className="max-w-[1700px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>{title}</h1>
          <p className="text-[13px] text-[#6b5240]">{subtitle}{updateLabel ? ' — ' + updateLabel : ''}</p>
        </div>
        {bumFilter && <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{bumFilter}</div>}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={store === 'all'} onClick={function() { setStore('all'); }} />
            <Pill label="Curaçao" active={store === '1'} onClick={function() { setStore('1'); }} />
            <Pill label="Bonaire" active={store === 'B'} onClick={function() { setStore('B'); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={dept} onChange={function(e) { setDept(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle Afdelingen</option>
            {depts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[0] + ' — ' + d[1]}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Vendor</span>
          <select value={vendor} onChange={function(e) { setVendor(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle vendors</option>
            {vendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}
          </select>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-4">NOS</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={nosFilter === 'all'} onClick={function() { setNosFilter('all'); }} />
            <Pill label="Ja" active={nosFilter === 'yes'} onClick={function() { setNosFilter('yes'); }} />
            <Pill label="Nee" active={nosFilter === 'no'} onClick={function() { setNosFilter('no'); }} />
          </div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-4">QOH</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={qohFilter === 'all'} onClick={function() { setQohFilter('all'); }} />
            <Pill label="> 0" active={qohFilter === 'positive'} onClick={function() { setQohFilter('positive'); }} />
          </div>
          <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Zoek item..." className="px-3 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px] w-[180px] ml-auto" />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        {[
          { label: 'Kritiek', value: fmt(totals.critical), sub: '< 1 maand dekking', color: totals.critical > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Urgent', value: fmt(totals.urgent), sub: '< max lead time dekking', color: totals.urgent > 0 ? '#f97316' : '#16a34a' },
          { label: 'Aandacht', value: fmt(totals.watch), sub: '< 1.5× max lead time', color: totals.watch > 0 ? '#d97706' : '#16a34a' },
          { label: 'NOS at Risk', value: fmt(totals.nos_at_risk), sub: 'kritiek + urgent', color: totals.nos_at_risk > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Inkoopwaarde Nodig', value: fmtC(totals.suggested_value), sub: 'geschatte bestelling', color: '#1B3A5C' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: k.color }}></div>
              <p className="text-[10px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[22px] font-semibold font-mono mt-1" style={{ color: k.color }}>{k.value}</p>
              <p className="text-[10px] text-[#a08a74] mt-0.5">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* ═══ NEW: NOS overview charts ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <NosStackedBar snapshotsToday={todaysNosSnapshots} store={store} />
        <NosTrendChart allSnapshots={nosSnapshots} store={store} />
      </div>

      {/* Department risk overview */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <h3 className="text-[15px] font-bold mb-1">Risico per Afdeling</h3>
        <p className="text-[12px] text-[#6b5240] mb-3">Gesorteerd op aantal kritieke + urgente items</p>
        <div className="flex items-center gap-4 text-[10px] mb-3">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> OK</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> Aandacht</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#f97316' }}></span> Urgent</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Kritiek</span>
        </div>
        <div className="space-y-2">
          {deptRisk.filter(function(d) { return d.critical + d.urgent > 0; }).map(function(d) {
            var pOk = d.total ? ((d.ok + d.watch) / d.total * 100) : 0;
            var pWatch = d.total ? (d.watch / d.total * 100) : 0;
            var pUrg = d.total ? (d.urgent / d.total * 100) : 0;
            var pCrit = d.total ? (d.critical / d.total * 100) : 0;
            return (
              <div key={d.code} className="flex items-center gap-2 cursor-pointer hover:bg-[#faf5f0] py-1 px-1 rounded" onClick={function() { setDept(d.code); setFilter('urgent'); }}>
                <div className="w-[140px] text-right text-[10px] text-[#1a0a04] truncate flex-shrink-0">
                  <span className="font-mono text-[#6b5240] mr-1">{d.code}</span>{d.name ? d.name.replace(/^\d+\s*/, '') : ''}
                </div>
                <div className="flex-1 flex h-[18px] rounded-sm overflow-hidden bg-[#f0ebe5]">
                  {pOk > 0 && <div style={{ width: (pOk - pWatch) + '%', backgroundColor: '#16a34a' }}></div>}
                  {pWatch > 0 && <div style={{ width: pWatch + '%', backgroundColor: '#d97706' }}></div>}
                  {pUrg > 0 && <div style={{ width: pUrg + '%', backgroundColor: '#f97316' }}></div>}
                  {pCrit > 0 && <div style={{ width: pCrit + '%', backgroundColor: '#dc2626' }}></div>}
                </div>
                <div className="w-[90px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">
                  {d.critical > 0 && <span style={{ color: '#dc2626' }}>{d.critical + 'K '}</span>}
                  {d.urgent > 0 && <span style={{ color: '#f97316' }}>{d.urgent + 'U '}</span>}
                  {d.nos_risk > 0 && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">{d.nos_risk + ' NOS'}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[
          ['critical', 'Kritiek (' + totals.critical + ')'],
          ['urgent', 'Kritiek + Urgent (' + (totals.critical + totals.urgent) + ')'],
          ['watch', 'Alle risico (' + (totals.critical + totals.urgent + totals.watch) + ')'],
          ['all', 'Alle items (' + totals.total_items + ')'],
        ].map(function(item) {
          return <button key={item[0]} onClick={function() { setFilter(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (filter === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* Results count + rows selector */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-[#6b5240]">{'Toont ' + Math.min(tableRows, displayed.length) + ' van ' + displayed.length + ' items'}</p>
        <select value={tableRows} onChange={function(e) { setTableRows(parseInt(e.target.value)); }} className="px-2 py-1 border border-[#e5ddd4] rounded-lg text-[12px]">
          {[50, 100, 250, 500].map(function(n) { return <option key={n} value={n}>{n} rijen</option>; })}
        </select>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1400px' }}>
            <thead>
              <tr className="bg-[#1B3A5C]">
                <th colSpan={4} className="text-left text-white text-[9px] font-bold uppercase py-2 px-2 border-r border-[#2a4f75]">Item</th>
                <th colSpan={4} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Voorraad & Dekking</th>
                <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Verkoop</th>
                <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase py-2">Actie</th>
              </tr>
              <tr className="bg-[#f0ebe5]">
                {[
                  ['Dept', 'dept_code', 'text-left min-w-[50px]'],
                  ['', 'item', 'text-left min-w-[80px]'],
                  ['Omschrijving', 'desc', 'text-left min-w-[180px]'],
                  ['Status', 'risk', 'text-center border-r border-[#e5ddd4]'],
                  ['QOH', 'qoh', 'text-right'],
                  ['QOO', 'qoo', 'text-right'],
                  ['Dekking', 'months_cover', 'text-right'],
                  ['vs LT', '', 'text-center border-r border-[#e5ddd4]'],
                  ['Gem/mnd', 'avg_monthly', 'text-right'],
                  ['Actief', 'active_months', 'text-right'],
                  ['Trend', '', 'text-center border-r border-[#e5ddd4]'],
                  ['Max Lead Time', 'max_lt', 'text-right'],
                  ['Bestel qty', 'suggested_qty', 'text-right'],
                  ['Waarde', 'suggested_value', 'text-right'],
                ].map(function(h) {
                  var clickable = h[1] ? ' cursor-pointer hover:text-[#E84E1B]' : '';
                  return <th key={h[0] + h[1]} className={'p-1.5 text-[9px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap ' + h[2] + clickable} onClick={h[1] ? function() { toggleSort(h[1]); } : undefined}>{(h[0] || 'Item') + arrow(h[1])}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {(function() {
                var tQoh = 0, tQoo = 0, tQty = 0, tVal = 0;
                displayed.forEach(function(m) { tQoh += m.qoh; tQoo += m.qoo; tQty += m.suggested_qty; tVal += m.suggested_value; });
                return (
                  <tr className="bg-[#faf7f4] sticky top-0 z-10">
                    <td colSpan={4} className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">{'TOTAAL (' + displayed.length + ' items)'}</td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQoh))}</td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQoo))}</td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#E84E1B' }}>{fmt(Math.round(tQty))}</td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#E84E1B' }}>{fmtC(tVal)}</td>
                  </tr>
                );
              })()}
              {displayed.length === 0 && (
                <tr><td colSpan={14} className="p-8 text-center text-[#6b5240]">Geen items gevonden voor dit filter</td></tr>
              )}
              {displayed.slice(0, tableRows).map(function(m, i) {
                var bg = i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]';
                var coverColor = m.months_cover < 1 ? '#dc2626' : m.months_cover < m.max_lt ? '#f97316' : m.months_cover < m.max_lt * 1.5 ? '#d97706' : '#16a34a';
                return (
                  <tr key={m.item} className={bg + ' hover:bg-[#faf5f0]'}>
                    <td className="p-1.5 text-[10px] font-mono text-[#6b5240] border-b border-[#f0ebe5]">{m.dept_code}</td>
                    <td className="p-1.5 text-[11px] font-mono text-[#6b5240] border-b border-[#f0ebe5]">{m.item}</td>
                    <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] truncate max-w-[200px]" title={m.desc}>
                      {m.desc}
                      {m.nos && <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">NOS</span>}
                    </td>
                    <td className="p-1.5 border-b border-[#f0ebe5] text-center border-r border-[#e5ddd4]"><RiskBadge level={m.risk} /></td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.qoh))}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoo > 0 ? '#1B3A5C' : '#a08a74' }}>{m.qoo > 0 ? fmt(Math.round(m.qoo)) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold" style={{ color: coverColor }}>{m.months_cover >= 99 ? '∞' : m.months_cover.toFixed(1) + 'm'}</td>
                    <td className="p-1.5 border-b border-[#f0ebe5] border-r border-[#e5ddd4]"><CoverBar months={m.months_cover} maxLT={m.max_lt} /></td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold">{fmt(Math.round(m.avg_monthly))}</td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#6b5240]">{m.active_months + '/12'}</td>
                    <td className="p-1.5 border-b border-[#f0ebe5] border-r border-[#e5ddd4]"><Spark sales={m.salesChrono} /></td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5]">{m.max_lt > 0 ? m.max_lt + 'm' : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: m.suggested_qty > 0 ? '#E84E1B' : '#16a34a' }}>{m.suggested_qty > 0 ? fmt(m.suggested_qty) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: m.suggested_value > 0 ? '#E84E1B' : '#1a0a04' }}>{m.suggested_value > 0 ? fmtC(m.suggested_value) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span><b>Dekking</b> = (QOH + QOO) ÷ gem. maandverkoop</span>
          <span><b>Max Lead Time</b> = maximale levertijd leverancier</span>
          <span><b>Verticale lijn</b> in dekkingsbalk = max lead time drempel</span>
          <span><RiskBadge level="critical" /> &lt;1 mnd dekking</span>
          <span><RiskBadge level="urgent" /> dekking &lt; max lead time</span>
          <span><RiskBadge level="watch" /> dekking &lt; 1.5× max lead time</span>
          <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">NOS</span> <span>Never Out of Stock items</span>
        </div>
      </div>
    </div>
  );
}
