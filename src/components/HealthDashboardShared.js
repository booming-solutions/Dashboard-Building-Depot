/* ============================================================
   BESTAND: HealthDashboardShared.js
   KOPIEER NAAR: src/components/HealthDashboardShared.js
   (maak de map components aan als die nog niet bestaat)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a)); };
var fmtC = function(n) { return 'Cg ' + fmt(Math.round(n || 0)); };
var fmtMoi = function(n) { return n >= 99 ? '∞' : n.toFixed(1); };
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

/* Mini sparkline */
function Spark({ sales }) {
  var max = Math.max.apply(null, sales.concat([1]));
  return (
    <div className="flex items-end gap-px h-[16px]">
      {sales.map(function(v, i) {
        var h = max > 0 ? Math.max(1, (v / max) * 16) : 1;
        return <div key={i} className="w-[4px] rounded-t-sm" style={{ height: h + 'px', backgroundColor: v > 0 ? '#E84E1B' : '#e5ddd4' }}></div>;
      })}
    </div>
  );
}

/* Health badge */
function HealthBadge({ category }) {
  var colors = {
    healthy: { bg: '#dcfce7', text: '#16a34a', label: 'Gezond' },
    watch: { bg: '#fef9c3', text: '#a16207', label: 'Aandacht' },
    overstock: { bg: '#ffedd5', text: '#c2410c', label: 'Overstock' },
    slow: { bg: '#fce7f3', text: '#be185d', label: 'Slow Mover' },
    dead: { bg: '#fecaca', text: '#dc2626', label: 'Dead Stock' },
  };
  var c = colors[category] || colors.healthy;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>;
}

// bumFilter: null = all BUMs (totaal), "PASCAL" = only PASCAL, etc.
export default function HealthDashboardShared({ bumFilter }) {
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _upd = useState(null), lastUpdate = _upd[0], setLastUpdate = _upd[1];
  var _store = useState('1'), store = _store[0], setStore = _store[1];
  var _bum = useState('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _dept = useState('all'), selDept = _dept[0], setSelDept = _dept[1];
  var _view = useState('overview'), view = _view[0], setView = _view[1];
  var _detailDept = useState(null), detailDept = _detailDept[0], setDetailDept = _detailDept[1];
  var _filter = useState('all'), catFilter = _filter[0], setCatFilter = _filter[1];
  var _sort = useState('inv_value'), sortCol = _sort[0], setSortCol = _sort[1];
  var _sortDir = useState('desc'), sortDir = _sortDir[0], setSortDir = _sortDir[1];
  var _search = useState(''), search = _search[0], setSearch = _search[1];
  var _rows = useState(50), tableRows = _rows[0], setTableRows = _rows[1];

  var supabase = createClient();
  useEffect(function() { loadData(); }, [bumFilter]);

  async function loadData() {
    setLoading(true);
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('buying_data').select('*').range(from, from + step - 1);
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

  /* Aggregate items across stores within region */
  var items = useMemo(function() {
    var cFactor = store === 'B' ? 1.82 : 1;
    var filtered = data.filter(function(r) {
      var sn = String(r.store_number);
      if (store === '1') return /^\d+$/.test(sn);
      if (store === 'B') return !/^\d+$/.test(sn);
      return true;
    });

    var map = {};
    filtered.forEach(function(r) {
      var key = r.item_number;
      if (!map[key]) {
        map[key] = {
          item: r.item_number, desc: r.item_description,
          dept_code: r.dept_code, dept_name: r.dept_name,
          class_code: r.class_code, class_name: r.class_name,
          bum: r.bum || '', vendor: r.vendor_name || '',
          cost: (parseFloat(r.replacement_cost) || 0) * cFactor,
          qoh: 0, inv_value: 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      m.qoh += parseFloat(r.qoh) || 0;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });

    var list = Object.values(map);

    list.forEach(function(m) {
      // Chronological sales (oldest first)
      m.salesChrono = m.sales.slice().reverse();

      // Active months (months with sales > 0)
      m.active_months = m.sales.filter(function(s) { return s > 0; }).length;

      // Total units sold in 12 months
      m.total_sold = m.sales.reduce(function(a, b) { return a + b; }, 0);

      // Avg monthly sales (units, excl zero months)
      var nonZero = m.sales.filter(function(s) { return s > 0; });
      m.avg_monthly = nonZero.length ? nonZero.reduce(function(a, b) { return a + b; }, 0) / nonZero.length : 0;

      // Avg monthly cost of goods sold
      m.avg_monthly_cost = m.avg_monthly * (m.cost || 0);

      // MOI (months of inventory)
      m.moi = m.avg_monthly_cost > 0 ? m.inv_value / m.avg_monthly_cost : (m.inv_value > 0 ? 99 : 0);

      // Last sale: how many months ago was the last sale?
      // m.sales[0] = most recent month, m.sales[11] = oldest
      m.months_since_last_sale = 12;
      for (var i = 0; i < 12; i++) {
        if (m.sales[i] > 0) { m.months_since_last_sale = i; break; }
      }

      // Recent trend: last 3 months vs prior 3 months
      var recent3 = m.sales[0] + m.sales[1] + m.sales[2];
      var prior3 = m.sales[3] + m.sales[4] + m.sales[5];
      m.trend = prior3 > 0 ? ((recent3 - prior3) / prior3) * 100 : (recent3 > 0 ? 100 : 0);

      // Classify item health
      if (m.qoh <= 0 || m.inv_value <= 0) {
        m.category = 'healthy'; // no stock = not a problem
      } else if (m.active_months === 0) {
        m.category = 'dead'; // has stock, never sold in 12 months
      } else if (m.months_since_last_sale >= 6) {
        m.category = 'dead'; // hasn't sold in 6+ months
      } else if (m.months_since_last_sale >= 3 || (m.active_months <= 3 && m.moi > 6)) {
        m.category = 'slow'; // slow mover
      } else if (m.moi > 9) {
        m.category = 'overstock'; // too much stock relative to sales
      } else if (m.moi > 5) {
        m.category = 'watch'; // worth watching
      } else {
        m.category = 'healthy'; // good balance
      }
    });

    // Only items with positive stock
    return list.filter(function(m) { return m.qoh > 0 && m.inv_value > 0; });
  }, [data, store]);

  /* Filter by BUM and dept */
  var filteredItems = useMemo(function() {
    return items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      if (selDept !== 'all' && m.dept_code !== selDept) return false;
      if (detailDept && m.dept_code !== detailDept) return false;
      if (catFilter !== 'all' && m.category !== catFilter) return false;
      if (search) {
        var s = search.toLowerCase();
        if (!(m.item || '').toLowerCase().includes(s) &&
            !(m.desc || '').toLowerCase().includes(s) &&
            !(m.vendor || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, selBum, selDept, detailDept, catFilter, search]);

  /* Department summary */
  var deptHealth = useMemo(function() {
    var map = {};
    var src = items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      return true;
    });
    src.forEach(function(m) {
      var dc = m.dept_code;
      if (!map[dc]) map[dc] = { code: dc, name: m.dept_name, bum: m.bum, items: 0, inv_value: 0, healthy: 0, watch: 0, overstock: 0, slow: 0, dead: 0, healthy_value: 0, watch_value: 0, overstock_value: 0, slow_value: 0, dead_value: 0, total_sold: 0, avg_moi: 0, moi_sum: 0, moi_count: 0 };
      var d = map[dc];
      d.items++;
      d.inv_value += m.inv_value;
      d[m.category]++;
      d[m.category + '_value'] += m.inv_value;
      d.total_sold += m.total_sold;
      if (m.moi < 99) { d.moi_sum += m.moi; d.moi_count++; }
    });
    Object.values(map).forEach(function(d) {
      d.avg_moi = d.moi_count ? d.moi_sum / d.moi_count : 0;
      d.healthy_pct = d.items ? (d.healthy / d.items) * 100 : 0;
      d.problem_pct = d.items ? ((d.slow + d.dead) / d.items) * 100 : 0;
      d.problem_value = d.slow_value + d.dead_value;
    });
    return Object.values(map).sort(function(a, b) { return b.problem_value - a.problem_value; });
  }, [items, selBum]);

  /* Totals */
  var totals = useMemo(function() {
    var t = { items: 0, inv_value: 0, healthy: 0, watch: 0, overstock: 0, slow: 0, dead: 0, healthy_value: 0, watch_value: 0, overstock_value: 0, slow_value: 0, dead_value: 0 };
    var src = items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      if (selDept !== 'all' && m.dept_code !== selDept) return false;
      return true;
    });
    src.forEach(function(m) {
      t.items++;
      t.inv_value += m.inv_value;
      t[m.category]++;
      t[m.category + '_value'] += m.inv_value;
    });
    t.healthy_pct = t.items ? (t.healthy / t.items * 100) : 0;
    t.watch_pct = t.items ? (t.watch / t.items * 100) : 0;
    t.overstock_pct = t.items ? (t.overstock / t.items * 100) : 0;
    t.slow_pct = t.items ? (t.slow / t.items * 100) : 0;
    t.dead_pct = t.items ? (t.dead / t.items * 100) : 0;
    t.problem_value = t.slow_value + t.dead_value;
    return t;
  }, [items, selBum, selDept]);

  /* BUM list */
  var bums = useMemo(function() {
    var s = {};
    items.forEach(function(m) { if (m.bum && m.bum !== 'OTHER') s[m.bum] = true; });
    var l = Object.keys(s);
    l.sort(function(a, b) { var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); });
    return l;
  }, [items]);

  /* Dept list */
  var depts = useMemo(function() {
    var s = {};
    items.forEach(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return;
      s[m.dept_code] = m.dept_name;
    });
    return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 999) - (parseInt(b[0]) || 999); });
  }, [items, selBum]);

  /* Sort detail items */
  var sortedItems = useMemo(function() {
    var list = filteredItems.slice();
    list.sort(function(a, b) {
      var va, vb;
      if (sortCol === 'inv_value') { va = a.inv_value; vb = b.inv_value; }
      else if (sortCol === 'moi') { va = a.moi; vb = b.moi; }
      else if (sortCol === 'qoh') { va = a.qoh; vb = b.qoh; }
      else if (sortCol === 'avg_monthly') { va = a.avg_monthly; vb = b.avg_monthly; }
      else if (sortCol === 'total_sold') { va = a.total_sold; vb = b.total_sold; }
      else if (sortCol === 'months_since') { va = a.months_since_last_sale; vb = b.months_since_last_sale; }
      else if (sortCol === 'item') { va = a.item; vb = b.item; return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); }
      else { va = a.inv_value; vb = b.inv_value; }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return list;
  }, [filteredItems, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; });
    else { setSortCol(col); setSortDir('desc'); }
  }

  if (loading) return <LoadingLogo text={'Gezondheid laden' + (bumFilter ? ' (' + bumFilter + ')' : '') + '...'} />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">{"Geen data beschikbaar" + (bumFilter ? " voor " + bumFilter : "") + "."}</p></div>;

  var storeName = store === '1' ? 'Curaçao' : 'Bonaire';

  var updateLabel = lastUpdate ? 'Data t/m ' + (function() { var p = lastUpdate.split('-'); var MN2 = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']; return parseInt(p[2]) + ' ' + MN2[parseInt(p[1])-1] + ' ' + p[0]; })() : '';

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>{bumFilter ? 'Gezondheid — ' + bumFilter : 'Gezondheid Voorraden — Totaaloverzicht'}</h1>
          <p className="text-[13px] text-[#6b5240]">{bumFilter ? 'Voorraad gezondheid voor ' + bumFilter + ' — ' + storeName : 'Alle BUMs — ' + storeName + ' — dit overzicht kan langer laden'}{updateLabel ? ' — ' + updateLabel : ''}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{bumFilter ? bumFilter + ' · ' + storeName : storeName}</div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">
            <Pill label="Curaçao" active={store === '1'} onClick={function() { setStore('1'); setSelBum('all'); setSelDept('all'); setDetailDept(null); }} />
            <Pill label="Bonaire" active={store === 'B'} onClick={function() { setStore('B'); setSelBum('all'); setSelDept('all'); setDetailDept(null); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); setSelDept('all'); setDetailDept(null); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); setSelDept('all'); setDetailDept(null); }} />; })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={selDept} onChange={function(e) { setSelDept(e.target.value); setDetailDept(null); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle Departementen</option>
            {depts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[1]}</option>; })}
          </select>
        </div>
      </div>

      {/* Health distribution bar */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold">Verdeling Voorraadgezondheid</h3>
          <div className="text-[13px] font-mono text-[#6b5240]">{fmt(totals.items) + ' items · ' + fmtC(totals.inv_value)}</div>
        </div>

        {/* Stacked bar */}
        <div className="flex h-[32px] rounded-lg overflow-hidden mb-3">
          {totals.healthy > 0 && <div style={{ width: totals.healthy_pct + '%', backgroundColor: '#16a34a' }} className="transition-all" title={'Gezond: ' + fmt(totals.healthy) + ' items (' + totals.healthy_pct.toFixed(0) + '%)'}></div>}
          {totals.watch > 0 && <div style={{ width: totals.watch_pct + '%', backgroundColor: '#eab308' }} className="transition-all" title={'Aandacht: ' + fmt(totals.watch) + ' items (' + totals.watch_pct.toFixed(0) + '%)'}></div>}
          {totals.overstock > 0 && <div style={{ width: totals.overstock_pct + '%', backgroundColor: '#f97316' }} className="transition-all" title={'Overstock: ' + fmt(totals.overstock) + ' items (' + totals.overstock_pct.toFixed(0) + '%)'}></div>}
          {totals.slow > 0 && <div style={{ width: totals.slow_pct + '%', backgroundColor: '#ec4899' }} className="transition-all" title={'Slow Mover: ' + fmt(totals.slow) + ' items (' + totals.slow_pct.toFixed(0) + '%)'}></div>}
          {totals.dead > 0 && <div style={{ width: totals.dead_pct + '%', backgroundColor: '#dc2626' }} className="transition-all" title={'Dead Stock: ' + fmt(totals.dead) + ' items (' + totals.dead_pct.toFixed(0) + '%)'}></div>}
        </div>

        {/* Legend with values */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Gezond', key: 'healthy', color: '#16a34a', desc: 'MOI ≤ 5, actief verkopend' },
            { label: 'Aandacht', key: 'watch', color: '#eab308', desc: 'MOI 5-9 maanden' },
            { label: 'Overstock', key: 'overstock', color: '#f97316', desc: 'MOI > 9 maanden' },
            { label: 'Slow Mover', key: 'slow', color: '#ec4899', desc: '3+ mnd geen verkoop' },
            { label: 'Dead Stock', key: 'dead', color: '#dc2626', desc: '6+ mnd geen verkoop' },
          ].map(function(cat) {
            var count = totals[cat.key];
            var value = totals[cat.key + '_value'];
            var pct = totals[cat.key + '_pct'] || 0;
            var isActive = catFilter === cat.key;
            return (
              <div key={cat.key} className={'rounded-xl p-3 cursor-pointer transition-all border-2 ' + (isActive ? 'border-[#1B3A5C] shadow-md' : 'border-transparent hover:border-[#e5ddd4]')}
                style={{ backgroundColor: cat.color + '10' }}
                onClick={function() { setCatFilter(isActive ? 'all' : cat.key); setView('detail'); }}>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }}></div>
                  <span className="text-[11px] font-bold uppercase" style={{ color: cat.color }}>{cat.label}</span>
                </div>
                <p className="text-[18px] font-bold font-mono">{fmt(count)}<span className="text-[11px] text-[#6b5240] font-normal ml-1">({pct.toFixed(0)}%)</span></p>
                <p className="text-[11px] font-mono text-[#6b5240]">{fmtC(value)}</p>
                <p className="text-[9px] text-[#a08a74] mt-0.5">{cat.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* KPI alert tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#dc2626]"></div>
          <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Probleem Voorraad</p>
          <p className="text-[28px] font-semibold font-mono text-[#dc2626]">{fmtC(totals.problem_value)}</p>
          <p className="text-[11px] text-[#a08a74]">slow movers + dead stock waarde</p>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#dc2626]"></div>
          <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">% Probleem van Totaal</p>
          <p className="text-[28px] font-semibold font-mono" style={{ color: totals.inv_value ? ((totals.problem_value / totals.inv_value * 100) > 20 ? '#dc2626' : (totals.problem_value / totals.inv_value * 100) > 10 ? '#d97706' : '#16a34a') : '#1a0a04' }}>
            {totals.inv_value ? ((totals.problem_value / totals.inv_value) * 100).toFixed(1) + '%' : '0%'}
          </p>
          <p className="text-[11px] text-[#a08a74]">van totale voorraadwaarde</p>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
          <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">Gezonde Voorraad</p>
          <p className="text-[28px] font-semibold font-mono text-[#16a34a]">{totals.healthy_pct.toFixed(0)}%</p>
          <p className="text-[11px] text-[#a08a74]">{fmt(totals.healthy)} van {fmt(totals.items)} items</p>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['overview', 'Per Afdeling'], ['detail', 'Per Item (' + fmt(filteredItems.length) + ')']].map(function(item) {
          return <button key={item[0]} onClick={function() { setView(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* ═══ DEPARTMENT OVERVIEW ═══ */}
      {view === 'overview' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="bg-[#1B3A5C]">
                  <th colSpan={3} className="p-0 border-r border-[#2a4f75]"></th>
                  <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">Voorraad</th>
                  <th colSpan={1} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">MOI</th>
                  <th colSpan={5} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">Verdeling Items</th>
                  <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5">Probleem</th>
                </tr>
                <tr className="bg-[#f0ebe5]">
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Dep</th>
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] min-w-[140px]">Afdeling</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">Items</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Waarde</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">Verkocht</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]" title="Gemiddelde Months of Inventory">Gem.</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#16a34a' }}>Gezond</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#eab308' }}>Aandacht</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#f97316' }}>Over</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#ec4899' }}>Slow</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]" style={{ color: '#dc2626' }}>Dead</th>
                  <th className="text-right p-2 text-[10px] text-[#dc2626] font-bold uppercase border-b-2 border-[#e5ddd4]">Waarde</th>
                  <th className="text-right p-2 text-[10px] text-[#dc2626] font-bold uppercase border-b-2 border-[#e5ddd4]">%</th>
                </tr>
              </thead>
              <tbody>
                {deptHealth.map(function(d, i) {
                  var probPct = d.inv_value ? (d.problem_value / d.inv_value * 100) : 0;
                  var probColor = probPct > 30 ? '#dc2626' : probPct > 15 ? '#d97706' : '#16a34a';
                  return (
                    <tr key={d.code} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'} onClick={function() { setDetailDept(d.code); setView('detail'); setCatFilter('all'); }}>
                      <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.code}</td>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[160px]" title={d.name}>{(d.name || '').replace(/^\d+\s*/, '')}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]">{fmt(d.items)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmtK(d.inv_value)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] text-[#6b5240]">{fmt(d.total_sold)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: d.avg_moi > 9 ? '#dc2626' : d.avg_moi > 5 ? '#d97706' : '#16a34a' }}>{fmtMoi(d.avg_moi)}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#16a34a' }}>{d.healthy || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#eab308' }}>{d.watch || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#f97316' }}>{d.overstock || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#ec4899' }}>{d.slow || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: '#dc2626' }}>{d.dead || '-'}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] font-semibold" style={{ color: '#dc2626' }}>{d.problem_value > 0 ? fmtK(d.problem_value) : '-'}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] font-semibold" style={{ color: probColor }}>{probPct > 0 ? probPct.toFixed(0) + '%' : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ ITEM DETAIL VIEW ═══ */}
      {view === 'detail' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
          <div className="flex items-center justify-between p-4 border-b border-[#e5ddd4]">
            <div className="flex items-center gap-3">
              <h3 className="text-[15px] font-bold">
                {detailDept ? ('Dept ' + detailDept + ' — Items') : 'Alle Items'}
              </h3>
              {detailDept && <button onClick={function() { setDetailDept(null); }} className="text-[11px] text-[#E84E1B] hover:underline">× Wis dept filter</button>}
            </div>
            <div className="flex items-center gap-3">
              <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Zoek item..." className="px-3 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px] w-[180px]" />
              <select value={tableRows} onChange={function(e) { setTableRows(parseInt(e.target.value)); }} className="px-2 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px]">
                {[50, 100, 250, 500].map(function(n) { return <option key={n} value={n}>{n} rijen</option>; })}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1100px' }}>
              <thead>
                <tr className="bg-[#f0ebe5]">
                  {[
                    ['Dept', 'dept', 'text-left'], ['Item', 'item', 'text-left'], ['Omschrijving', '', 'text-left min-w-[180px]'],
                    ['Status', '', 'text-center'], ['QOH', 'qoh', 'text-right'], ['Waarde', 'inv_value', 'text-right'],
                    ['MOI', 'moi', 'text-right'], ['Gem/mnd', 'avg_monthly', 'text-right'], ['Verkocht', 'total_sold', 'text-right'],
                    ['Laatste', 'months_since', 'text-right'], ['Trend', '', 'text-center'], ['Vendor', '', 'text-left'],
                  ].map(function(h) {
                    var clickable = h[1] ? ' cursor-pointer hover:text-[#E84E1B]' : '';
                    return <th key={h[0]} onClick={h[1] ? function() { toggleSort(h[1]); } : undefined}
                      className={'p-2 text-[9px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap ' + h[2] + clickable}>
                      {h[0]}{h[1] && sortCol === h[1] ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedItems.slice(0, tableRows).map(function(m, i) {
                  var moiColor = m.moi >= 99 ? '#dc2626' : m.moi > 9 ? '#dc2626' : m.moi > 5 ? '#d97706' : '#16a34a';
                  return (
                    <tr key={m.item + i} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                      <td className="p-1.5 text-[11px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{m.dept_code}</td>
                      <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] font-mono text-[#1B3A5C]">{m.item}</td>
                      <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] truncate max-w-[200px]" title={m.desc}>{m.desc}</td>
                      <td className="p-1.5 border-b border-[#f0ebe5] text-center"><HealthBadge category={m.category} /></td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.qoh))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold">{fmt(Math.round(m.inv_value))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold" style={{ color: moiColor }}>{fmtMoi(m.moi)}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.avg_monthly))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{fmt(m.total_sold)}</td>
                      <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5]" style={{ color: m.months_since_last_sale >= 6 ? '#dc2626' : m.months_since_last_sale >= 3 ? '#d97706' : '#6b5240' }}>
                        {m.months_since_last_sale === 0 ? 'deze mnd' : m.months_since_last_sale + ' mnd'}
                      </td>
                      <td className="p-1.5 border-b border-[#f0ebe5]"><Spark sales={m.salesChrono} /></td>
                      <td className="p-1.5 text-[10px] border-b border-[#f0ebe5] text-[#6b5240] truncate max-w-[120px]" title={m.vendor}>{m.vendor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sortedItems.length > tableRows && (
            <div className="p-3 text-center text-[12px] text-[#6b5240] border-t border-[#e5ddd4]">
              {'Toont ' + Math.min(tableRows, sortedItems.length) + ' van ' + sortedItems.length + ' items'}
            </div>
          )}
        </div>
      )}

      {/* Export */}
      <div className="flex justify-end mb-5">
        <button onClick={function() {
          var csvRows = ['Dept,Afdeling,Item,Omschrijving,Status,QOH,Waarde,MOI,Gem/mnd,Verkocht 12m,Laatste verkoop,Vendor'];
          sortedItems.forEach(function(m) {
            csvRows.push([m.dept_code, '"' + (m.dept_name || '') + '"', m.item, '"' + (m.desc || '').replace(/"/g, '""') + '"', m.category, Math.round(m.qoh), Math.round(m.inv_value), m.moi.toFixed(1), Math.round(m.avg_monthly), m.total_sold, m.months_since_last_sale, '"' + (m.vendor || '') + '"'].join(','));
          });
          var blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'voorraad_gezondheid.csv';
          a.click();
        }} className="px-5 py-2.5 rounded-lg bg-white text-[#E84E1B] text-[13px] font-semibold border border-[#E84E1B] hover:bg-[#faf5f0]">
          Exporteer CSV
        </button>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="text-[10px] text-[#6b5240] space-y-1">
          <p><strong>MOI (Months of Inventory)</strong> = voorraadwaarde ÷ gemiddelde maandelijkse kostprijs verkopen. Lager = gezonder.</p>
          <p><strong>Classificatie:</strong> Gezond (MOI ≤5, actief) · Aandacht (MOI 5-9) · Overstock (MOI &gt;9) · Slow Mover (3-6 mnd geen verkoop) · Dead Stock (6+ mnd geen verkoop)</p>
          <p>Klik op een afdeling om in te zoomen naar individuele items. Klik op een categorie in de verdeling om te filteren.</p>
        </div>
      </div>
    </div>
  );
}
