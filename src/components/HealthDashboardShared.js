/* ============================================================
   BESTAND: HealthDashboardShared_v3.js
   KOPIEER NAAR: src/components/HealthDashboardShared.js
   (vervangt huidige HealthDashboardShared.js)
   VERSIE: v3.28.14

   Wijzigingen t.o.v. v2:
   - Excel-export overgeschakeld op gedeelde ExcelExportButton component
     (zelfde opmaak als alle andere pagina's: blauwe header, frozen pane,
      footer met datum + boomingsolutions.ai link)
   - Eigen XLSX/SheetJS import verwijderd
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a)); };
var fmtC = function(n) { return 'Cg ' + fmt(Math.round(n || 0)); };
var fmtMoi = function(n) { return n >= 99 ? '∞' : n.toFixed(1); };
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

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

/* Twee soorten badges: voorraad-niveau en rotatie */
function StockBadge({ category }) {
  var colors = {
    understock: { bg: '#fee2e2', text: '#dc2626', label: 'Understock' },
    healthy:    { bg: '#dcfce7', text: '#16a34a', label: 'Gezond' },
    overstock:  { bg: '#ffedd5', text: '#c2410c', label: 'Overstock' },
  };
  var c = colors[category] || colors.healthy;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>;
}
function RotationBadge({ category }) {
  var colors = {
    healthy: { bg: '#dcfce7', text: '#16a34a', label: 'Gezond' },
    slow:    { bg: '#fce7f3', text: '#be185d', label: 'Slow Mover' },
    dead:    { bg: '#fecaca', text: '#dc2626', label: 'Dead Stock' },
  };
  var c = colors[category] || colors.healthy;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>;
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
  // Filter op stock-niveau (understock/healthy/overstock) of rotatie (healthy/slow/dead)
  var _stockFilter = useState('all'), stockFilter = _stockFilter[0], setStockFilter = _stockFilter[1];
  var _rotFilter = useState('all'), rotFilter = _rotFilter[0], setRotFilter = _rotFilter[1];
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
          max_lt: parseFloat(r.max_lead_time) || 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      // Lead time: nemen we het maximum (worst case) over stores binnen regio
      var rlt = parseFloat(r.max_lead_time) || 0;
      if (rlt > m.max_lt) m.max_lt = rlt;
      m.qoh += parseFloat(r.qoh) || 0;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });

    var list = Object.values(map);

    list.forEach(function(m) {
      // Lead time fallback: 3 maanden (consistent met Stock Risk)
      m.lead_time = m.max_lt > 0 ? m.max_lt : 3;

      // Chronological sales (oldest first → newest last)
      m.salesChrono = m.sales.slice().reverse();

      // Active months
      m.active_months = m.sales.filter(function(s) { return s > 0; }).length;

      // Total sold 12m
      m.total_sold = m.sales.reduce(function(a, b) { return a + b; }, 0);

      // Avg monthly (excl zero months) — voor MOI berekening
      var nonZero = m.sales.filter(function(s) { return s > 0; });
      m.avg_monthly = nonZero.length ? nonZero.reduce(function(a, b) { return a + b; }, 0) / nonZero.length : 0;

      // Avg monthly cost of goods sold (voor MOI)
      m.avg_monthly_cost = m.avg_monthly * (m.cost || 0);

      // MOI (months of inventory) — informatief, niet meer voor classificatie
      m.moi = m.avg_monthly_cost > 0 ? m.inv_value / m.avg_monthly_cost : (m.inv_value > 0 ? 99 : 0);

      // Voorraad in maanden (units)
      m.stock_months = m.avg_monthly > 0 ? (m.qoh / m.avg_monthly) : (m.qoh > 0 ? 99 : 0);

      // Last sale: aantal maanden geleden
      // m.sales[0] = meest recente maand (m-1), m.sales[11] = oudste (m-12)
      m.months_since_last_sale = 12;
      for (var i = 0; i < 12; i++) {
        if (m.sales[i] > 0) { m.months_since_last_sale = i; break; }
      }

      // Trend laatste 3 mnd vs prior 3 mnd
      var recent3 = m.sales[0] + m.sales[1] + m.sales[2];
      var prior3 = m.sales[3] + m.sales[4] + m.sales[5];
      m.trend = prior3 > 0 ? ((recent3 - prior3) / prior3) * 100 : (recent3 > 0 ? 100 : 0);

      // ── Bar 1: Voorraad-niveau (Understock / Healthy / Overstock)
      // Drempel = max lead time
      // Understock: stock_months < lead_time (te weinig voorraad voor levertijd)
      // Healthy:    lead_time ≤ stock_months < lead_time + 3
      // Overstock:  stock_months ≥ lead_time + 3
      // Items zonder verkoop in 12 mnd → automatisch in 'overstock' (oneindige MOI)
      if (m.qoh <= 0 || m.inv_value <= 0) {
        m.stock_cat = 'understock'; // geen voorraad = understock
      } else if (m.avg_monthly === 0) {
        m.stock_cat = 'overstock'; // voorraad zonder verkoop → overstock
      } else if (m.stock_months < m.lead_time) {
        m.stock_cat = 'understock';
      } else if (m.stock_months < m.lead_time + 3) {
        m.stock_cat = 'healthy';
      } else {
        m.stock_cat = 'overstock';
      }

      // ── Bar 2: Rotatie (Healthy / Slow Mover / Dead Stock)
      // Healthy:    laatste verkoop in afgelopen 6 mnd
      // Slow:       laatste verkoop 6 t/m 11 mnd geleden
      // Dead:       geen verkoop in 12 mnd
      if (m.active_months === 0) {
        m.rot_cat = 'dead';
      } else if (m.months_since_last_sale >= 12) {
        m.rot_cat = 'dead';
      } else if (m.months_since_last_sale >= 6) {
        m.rot_cat = 'slow';
      } else {
        m.rot_cat = 'healthy';
      }
    });

    // Alleen items met positieve voorraad voor rapportage
    return list.filter(function(m) { return m.qoh > 0 && m.inv_value > 0; });
  }, [data, store]);

  /* Filter by BUM and dept (voor stacked bars en detail) */
  var filteredItems = useMemo(function() {
    return items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      if (selDept !== 'all' && m.dept_code !== selDept) return false;
      if (detailDept && m.dept_code !== detailDept) return false;
      if (stockFilter !== 'all' && m.stock_cat !== stockFilter) return false;
      if (rotFilter !== 'all' && m.rot_cat !== rotFilter) return false;
      if (search) {
        var s = search.toLowerCase();
        if (!(m.item || '').toLowerCase().includes(s) &&
            !(m.desc || '').toLowerCase().includes(s) &&
            !(m.vendor || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, selBum, selDept, detailDept, stockFilter, rotFilter, search]);

  /* Stacked bars: tellingen op basis van filters EXCL. categorie-filters */
  var barItems = useMemo(function() {
    return items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      if (selDept !== 'all' && m.dept_code !== selDept) return false;
      if (detailDept && m.dept_code !== detailDept) return false;
      return true;
    });
  }, [items, selBum, selDept, detailDept]);

  /* Department summary */
  var deptHealth = useMemo(function() {
    var map = {};
    var src = items.filter(function(m) {
      if (selBum !== 'all' && m.bum !== selBum) return false;
      return true;
    });
    src.forEach(function(m) {
      var dc = m.dept_code;
      if (!map[dc]) map[dc] = {
        code: dc, name: m.dept_name, bum: m.bum,
        items: 0, inv_value: 0,
        understock: 0, healthy_stock: 0, overstock: 0,
        understock_value: 0, healthy_stock_value: 0, overstock_value: 0,
        healthy_rot: 0, slow: 0, dead: 0,
        healthy_rot_value: 0, slow_value: 0, dead_value: 0,
        total_sold: 0, moi_sum: 0, moi_count: 0,
      };
      var d = map[dc];
      d.items++;
      d.inv_value += m.inv_value;
      // Stock-niveau
      var sk = m.stock_cat === 'healthy' ? 'healthy_stock' : m.stock_cat;
      d[sk]++;
      d[sk + '_value'] += m.inv_value;
      // Rotatie
      var rk = m.rot_cat === 'healthy' ? 'healthy_rot' : m.rot_cat;
      d[rk]++;
      d[rk + '_value'] += m.inv_value;
      d.total_sold += m.total_sold;
      if (m.moi < 99) { d.moi_sum += m.moi; d.moi_count++; }
    });
    Object.values(map).forEach(function(d) {
      d.avg_moi = d.moi_count ? d.moi_sum / d.moi_count : 0;
      d.problem_value = d.slow_value + d.dead_value + d.understock_value + d.overstock_value;
    });
    return Object.values(map).sort(function(a, b) { return b.problem_value - a.problem_value; });
  }, [items, selBum]);

  /* Totals (per categorie) — gebruikt door bars én KPI tegels */
  var totals = useMemo(function() {
    var t = {
      items: 0, inv_value: 0,
      understock: 0, healthy_stock: 0, overstock: 0,
      understock_value: 0, healthy_stock_value: 0, overstock_value: 0,
      healthy_rot: 0, slow: 0, dead: 0,
      healthy_rot_value: 0, slow_value: 0, dead_value: 0,
    };
    barItems.forEach(function(m) {
      t.items++;
      t.inv_value += m.inv_value;
      var sk = m.stock_cat === 'healthy' ? 'healthy_stock' : m.stock_cat;
      t[sk]++;
      t[sk + '_value'] += m.inv_value;
      var rk = m.rot_cat === 'healthy' ? 'healthy_rot' : m.rot_cat;
      t[rk]++;
      t[rk + '_value'] += m.inv_value;
    });
    // Percentages
    ['understock', 'healthy_stock', 'overstock', 'healthy_rot', 'slow', 'dead'].forEach(function(k) {
      t[k + '_pct'] = t.items ? (t[k] / t.items * 100) : 0;
    });
    t.problem_value = t.slow_value + t.dead_value;
    return t;
  }, [barItems]);

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
      else if (sortCol === 'stock_months') { va = a.stock_months; vb = b.stock_months; }
      else if (sortCol === 'lead_time') { va = a.lead_time; vb = b.lead_time; }
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

  /* ─────────── Excel export sheets builder ─────────── */
  function buildExportSheets() {
    return [
      {
        name: 'Per Afdeling',
        rows: deptHealth.map(function(d) {
          return {
            'Dept': d.code,
            'Afdeling': (d.name || '').replace(/^\d+\s*/, ''),
            'Items': d.items,
            'Voorraadwaarde (XCG)': Math.round(d.inv_value),
            'Verkocht 12m': d.total_sold,
            'Gem. MOI': Math.round(d.avg_moi * 10) / 10,
            'Understock items': d.understock,
            'Gezond items (voorraad)': d.healthy_stock,
            'Overstock items': d.overstock,
            'Gezond items (rotatie)': d.healthy_rot,
            'Slow Mover items': d.slow,
            'Dead Stock items': d.dead,
            'Probleem waarde (XCG)': Math.round(d.problem_value),
          };
        }),
      },
      {
        name: 'Per Item',
        rows: sortedItems.map(function(m) {
          return {
            'Dept': m.dept_code,
            'Afdeling': m.dept_name,
            'Item': m.item,
            'Omschrijving': m.desc,
            'Vendor': m.vendor,
            'BUM': m.bum,
            'QOH': Math.round(m.qoh),
            'Voorraadwaarde (XCG)': Math.round(m.inv_value),
            'Voorraad-niveau': m.stock_cat === 'understock' ? 'Understock' : m.stock_cat === 'overstock' ? 'Overstock' : 'Gezond',
            'Rotatie': m.rot_cat === 'dead' ? 'Dead Stock' : m.rot_cat === 'slow' ? 'Slow Mover' : 'Gezond',
            'Voorraad in maanden': Math.round(m.stock_months * 10) / 10,
            'Lead time (mnd)': m.lead_time,
            'MOI': Math.round(m.moi * 10) / 10,
            'Gem/mnd verkoop': Math.round(m.avg_monthly),
            'Verkocht 12m': m.total_sold,
            'Laatste verkoop (mnd geleden)': m.months_since_last_sale,
          };
        }),
      },
    ];
  }


  if (loading) return <LoadingLogo text={'Gezondheid laden' + (bumFilter ? ' (' + bumFilter + ')' : '') + '...'} />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">{"Geen data beschikbaar" + (bumFilter ? " voor " + bumFilter : "") + "."}</p></div>;

  var storeName = store === '1' ? 'Curaçao' : 'Bonaire';
  var updateLabel = lastUpdate ? 'Data t/m ' + (function() { var p = lastUpdate.split('-'); var MN2 = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']; return parseInt(p[2]) + ' ' + MN2[parseInt(p[1])-1] + ' ' + p[0]; })() : '';

  // Stacked bar render helper
  function renderStackedBar(segments) {
    return (
      <div className="flex h-[28px] rounded-lg overflow-hidden">
        {segments.map(function(s, i) {
          if (!s.pct || s.pct <= 0) return null;
          return <div key={i} style={{ width: s.pct + '%', backgroundColor: s.color }}
            className="transition-all flex items-center justify-center"
            title={s.label + ': ' + fmt(s.count) + ' items (' + s.pct.toFixed(0) + '%) — ' + fmtC(s.value)}>
            {s.pct >= 8 && <span className="text-[10px] text-white font-bold">{s.pct.toFixed(0) + '%'}</span>}
          </div>;
        })}
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>{bumFilter ? 'Gezondheid — ' + bumFilter : 'Gezondheid Voorraden — Totaaloverzicht'}</h1>
          <p className="text-[13px] text-[#6b5240]">{bumFilter ? 'Voorraad gezondheid voor ' + bumFilter + ' — ' + storeName : 'Alle BUMs — ' + storeName}{updateLabel ? ' — ' + updateLabel : ''}</p>
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

      {/* Twee stacked bars */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[15px] font-bold">Verdeling Voorraadgezondheid</h3>
            <p className="text-[11px] text-[#6b5240]">Twee onafhankelijke dimensies: voorraad-niveau (vs lead time) én rotatie (laatste verkoop)</p>
          </div>
          <div className="text-[13px] font-mono text-[#6b5240]">{fmt(totals.items) + ' items · ' + fmtC(totals.inv_value)}</div>
        </div>

        {/* Bar 1: Voorraad-niveau */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-[#1a0a04]">1. Voorraad-niveau (vs maximale levertijd)</span>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span>Understock</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span>Gezond</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#f97316' }}></span>Overstock</span>
            </div>
          </div>
          {renderStackedBar([
            { label: 'Understock', count: totals.understock, value: totals.understock_value, pct: totals.understock_pct, color: '#dc2626' },
            { label: 'Gezond',     count: totals.healthy_stock, value: totals.healthy_stock_value, pct: totals.healthy_stock_pct, color: '#16a34a' },
            { label: 'Overstock',  count: totals.overstock, value: totals.overstock_value, pct: totals.overstock_pct, color: '#f97316' },
          ])}
          <div className="grid grid-cols-3 gap-3 mt-3">
            {[
              { label: 'Understock', key: 'understock', color: '#dc2626', desc: 'voorraad < lead time' },
              { label: 'Gezond',     key: 'healthy_stock', color: '#16a34a', desc: 'lead time t/m lead+3' },
              { label: 'Overstock',  key: 'overstock', color: '#f97316', desc: 'voorraad ≥ lead+3 mnd' },
            ].map(function(cat) {
              var k = cat.key === 'healthy_stock' ? 'healthy' : cat.key;
              var isActive = stockFilter === k;
              return (
                <div key={cat.key} className={'rounded-xl p-3 cursor-pointer transition-all border-2 ' + (isActive ? 'border-[#1B3A5C] shadow-md' : 'border-transparent hover:border-[#e5ddd4]')}
                  style={{ backgroundColor: cat.color + '10' }}
                  onClick={function() { setStockFilter(isActive ? 'all' : k); setView('detail'); }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }}></div>
                    <span className="text-[11px] font-bold uppercase" style={{ color: cat.color }}>{cat.label}</span>
                  </div>
                  <p className="text-[18px] font-bold font-mono">{fmt(totals[cat.key])}<span className="text-[11px] text-[#6b5240] font-normal ml-1">({(totals[cat.key + '_pct'] || 0).toFixed(0)}%)</span></p>
                  <p className="text-[11px] font-mono text-[#6b5240]">{fmtC(totals[cat.key + '_value'])}</p>
                  <p className="text-[9px] text-[#a08a74] mt-0.5">{cat.desc}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bar 2: Rotatie */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-[#1a0a04]">2. Rotatie (laatste verkoop)</span>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span>Gezond</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ec4899' }}></span>Slow Mover</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span>Dead Stock</span>
            </div>
          </div>
          {renderStackedBar([
            { label: 'Gezond',     count: totals.healthy_rot, value: totals.healthy_rot_value, pct: totals.healthy_rot_pct, color: '#16a34a' },
            { label: 'Slow Mover', count: totals.slow, value: totals.slow_value, pct: totals.slow_pct, color: '#ec4899' },
            { label: 'Dead Stock', count: totals.dead, value: totals.dead_value, pct: totals.dead_pct, color: '#dc2626' },
          ])}
          <div className="grid grid-cols-3 gap-3 mt-3">
            {[
              { label: 'Gezond',     key: 'healthy_rot', color: '#16a34a', desc: 'verkoop in afgelopen 6 mnd' },
              { label: 'Slow Mover', key: 'slow', color: '#ec4899', desc: '6 t/m 11 mnd geen verkoop' },
              { label: 'Dead Stock', key: 'dead', color: '#dc2626', desc: '12+ mnd geen verkoop' },
            ].map(function(cat) {
              var k = cat.key === 'healthy_rot' ? 'healthy' : cat.key;
              var isActive = rotFilter === k;
              return (
                <div key={cat.key} className={'rounded-xl p-3 cursor-pointer transition-all border-2 ' + (isActive ? 'border-[#1B3A5C] shadow-md' : 'border-transparent hover:border-[#e5ddd4]')}
                  style={{ backgroundColor: cat.color + '10' }}
                  onClick={function() { setRotFilter(isActive ? 'all' : k); setView('detail'); }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }}></div>
                    <span className="text-[11px] font-bold uppercase" style={{ color: cat.color }}>{cat.label}</span>
                  </div>
                  <p className="text-[18px] font-bold font-mono">{fmt(totals[cat.key])}<span className="text-[11px] text-[#6b5240] font-normal ml-1">({(totals[cat.key + '_pct'] || 0).toFixed(0)}%)</span></p>
                  <p className="text-[11px] font-mono text-[#6b5240]">{fmtC(totals[cat.key + '_value'])}</p>
                  <p className="text-[9px] text-[#a08a74] mt-0.5">{cat.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toolbar: tabs + zoek + export */}
      <div className="flex items-center justify-between mb-5 border-b-2 border-[#e5ddd4]">
        <div className="flex gap-1">
          {[['overview', 'Per Afdeling'], ['detail', 'Per Item (' + fmt(filteredItems.length) + ')']].map(function(item) {
            return <button key={item[0]} onClick={function() { setView(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
          })}
        </div>
        <ExcelExportButton
          filename={(function() { var d = new Date(); var pad = function(n){return n<10?'0'+n:''+n;}; return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_voorraadgezondheid_' + (bumFilter || (selBum !== 'all' ? selBum : 'alle')) + '_' + (store === '1' ? 'Curacao' : 'Bonaire'); })()}
          reportTitle={'Gezondheid Voorraden — ' + (bumFilter ? bumFilter + ' — ' : '') + (store === '1' ? 'Curaçao' : 'Bonaire')}
          sheets={buildExportSheets}
          className="px-4 py-1.5 mb-1 rounded-lg text-[12px] font-semibold border bg-white text-[#E84E1B] border-[#E84E1B] hover:bg-[#faf5f0] transition-colors"
        />
      </div>

      {/* ═══ DEPARTMENT OVERVIEW ═══ */}
      {view === 'overview' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
              <thead>
                <tr className="bg-[#1B3A5C]">
                  <th colSpan={3} className="p-0 border-r border-[#2a4f75]"></th>
                  <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">Voorraad</th>
                  <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">Voorraad-niveau</th>
                  <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5 border-r border-[#2a4f75]">Rotatie</th>
                  <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase tracking-wider py-1.5">Probleem</th>
                </tr>
                <tr className="bg-[#f0ebe5]">
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Dep</th>
                  <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] min-w-[140px]">Afdeling</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">Items</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Waarde</th>
                  <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]">Verkocht</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#dc2626' }}>Under</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#16a34a' }}>Gezond</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]" style={{ color: '#f97316' }}>Over</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ color: '#ec4899' }}>Slow</th>
                  <th className="text-center p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4] border-r border-[#e5ddd4]" style={{ color: '#dc2626' }}>Dead</th>
                  <th className="text-right p-2 text-[10px] text-[#dc2626] font-bold uppercase border-b-2 border-[#e5ddd4]">Slow+Dead</th>
                  <th className="text-right p-2 text-[10px] text-[#dc2626] font-bold uppercase border-b-2 border-[#e5ddd4]">%</th>
                </tr>
              </thead>
              <tbody>
                {deptHealth.map(function(d, i) {
                  var problemValue = d.slow_value + d.dead_value;
                  var probPct = d.inv_value ? (problemValue / d.inv_value * 100) : 0;
                  var probColor = probPct > 30 ? '#dc2626' : probPct > 15 ? '#d97706' : '#16a34a';
                  return (
                    <tr key={d.code} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'} onClick={function() { setDetailDept(d.code); setView('detail'); setStockFilter('all'); setRotFilter('all'); }}>
                      <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.code}</td>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[160px]" title={d.name}>{(d.name || '').replace(/^\d+\s*/, '')}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]">{fmt(d.items)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmtK(d.inv_value)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] text-[#6b5240]">{fmt(d.total_sold)}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#dc2626' }}>{d.understock || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#16a34a' }}>{d.healthy_stock || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: '#f97316' }}>{d.overstock || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#ec4899' }}>{d.slow || '-'}</td>
                      <td className="p-2 text-center font-mono text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: '#dc2626' }}>{d.dead || '-'}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] font-semibold" style={{ color: '#dc2626' }}>{problemValue > 0 ? fmtK(problemValue) : '-'}</td>
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
          <div className="flex items-center justify-between p-4 border-b border-[#e5ddd4] flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-[15px] font-bold">
                {detailDept ? ('Dept ' + detailDept + ' — Items') : 'Alle Items'}
              </h3>
              {detailDept && <button onClick={function() { setDetailDept(null); }} className="text-[11px] text-[#E84E1B] hover:underline">× Wis dept filter</button>}
              {stockFilter !== 'all' && <button onClick={function() { setStockFilter('all'); }} className="text-[11px] text-[#E84E1B] hover:underline">× Wis voorraad-filter</button>}
              {rotFilter !== 'all' && <button onClick={function() { setRotFilter('all'); }} className="text-[11px] text-[#E84E1B] hover:underline">× Wis rotatie-filter</button>}
            </div>
            <div className="flex items-center gap-3">
              <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Zoek item..." className="px-3 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px] w-[180px]" />
              <select value={tableRows} onChange={function(e) { setTableRows(parseInt(e.target.value)); }} className="px-2 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px]">
                {[50, 100, 250, 500].map(function(n) { return <option key={n} value={n}>{n} rijen</option>; })}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1300px' }}>
              <thead>
                <tr className="bg-[#f0ebe5]">
                  {[
                    ['Dept', 'dept', 'text-left'], ['Item', 'item', 'text-left'], ['Omschrijving', '', 'text-left min-w-[180px]'],
                    ['Voorraad-niveau', '', 'text-center'], ['Rotatie', '', 'text-center'],
                    ['QOH', 'qoh', 'text-right'], ['Waarde', 'inv_value', 'text-right'],
                    ['Vrd. mnd', 'stock_months', 'text-right'], ['LT', 'lead_time', 'text-right'],
                    ['Gem/mnd', 'avg_monthly', 'text-right'], ['Verkocht', 'total_sold', 'text-right'],
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
                  return (
                    <tr key={m.item + i} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                      <td className="p-1.5 text-[11px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{m.dept_code}</td>
                      <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] font-mono text-[#1B3A5C]">{m.item}</td>
                      <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] truncate max-w-[200px]" title={m.desc}>{m.desc}</td>
                      <td className="p-1.5 border-b border-[#f0ebe5] text-center"><StockBadge category={m.stock_cat} /></td>
                      <td className="p-1.5 border-b border-[#f0ebe5] text-center"><RotationBadge category={m.rot_cat} /></td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.qoh))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold">{fmt(Math.round(m.inv_value))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmtMoi(m.stock_months)}</td>
                      <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#6b5240]">{m.lead_time + 'm'}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.avg_monthly))}</td>
                      <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{fmt(m.total_sold)}</td>
                      <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5]" style={{ color: m.months_since_last_sale >= 12 ? '#dc2626' : m.months_since_last_sale >= 6 ? '#d97706' : '#6b5240' }}>
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

      {/* Legenda */}
      <div className="bg-[#faf7f4] rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="text-[10px] text-[#6b5240] space-y-2">
          <div>
            <p className="font-bold text-[11px] text-[#1a0a04] mb-1">Voorraad-niveau (vs maximale levertijd)</p>
            <p>
              <strong>Voorraad in maanden</strong> = QOH ÷ gem. maandverkoop. <strong>Lead time</strong> = maximale levertijd leverancier (default 3 mnd).
            </p>
            <p className="mt-1">
              <span style={{ color: '#dc2626' }}>Understock</span> = voorraad &lt; lead time (kunnen we niet aanvullen voor leeg) ·
              <span style={{ color: '#16a34a' }}> Gezond</span> = lead time t/m lead+3 maanden ·
              <span style={{ color: '#f97316' }}> Overstock</span> = ≥ lead+3 maanden voorraad
            </p>
          </div>
          <div>
            <p className="font-bold text-[11px] text-[#1a0a04] mb-1">Rotatie (laatste verkoop)</p>
            <p>
              <span style={{ color: '#16a34a' }}>Gezond</span> = verkoop in afgelopen 6 maanden ·
              <span style={{ color: '#ec4899' }}> Slow Mover</span> = 6 t/m 11 maanden geen verkoop ·
              <span style={{ color: '#dc2626' }}> Dead Stock</span> = 12+ maanden geen verkoop
            </p>
          </div>
          <p className="pt-1 italic">Klik op een afdeling of categorie-tegel om in te zoomen. Klik nogmaals om filter te wissen.</p>
        </div>
      </div>
    </div>
  );
}
