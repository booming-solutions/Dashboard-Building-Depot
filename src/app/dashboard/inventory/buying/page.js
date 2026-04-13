/* ============================================================
   BESTAND: page_buying.js
   KOPIEER NAAR: src/app/dashboard/inventory/buying/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : fmt(a)); };
var fmtC = function(n) { return 'Cg ' + (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var XCG_USD = 1.82; // Bonaire data is in USD, multiply by this to get XCG

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

/* Urgency badge */
function UrgBadge({ level }) {
  if (level === 'critical') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">KRITIEK</span>;
  if (level === 'order') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700">BESTELLEN</span>;
  if (level === 'watch') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">BEWAKEN</span>;
  return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700">OK</span>;
}

/* Mini sparkline bar chart for 12 months with labels */
function Spark({ sales, labels }) {
  var max = Math.max.apply(null, sales.concat([1]));
  return (
    <div className="flex items-end gap-px h-[20px]">
      {sales.map(function(v, i) {
        var h = max > 0 ? Math.max(1, (v / max) * 20) : 1;
        var lbl = labels && labels[i] ? labels[i] : '';
        return <div key={i} className="w-[5px] rounded-t-sm" style={{ height: h + 'px', backgroundColor: v > 0 ? '#E84E1B' : '#e5ddd4' }} title={lbl + ': ' + fmt(v)}></div>;
      })}
    </div>
  );
}

export default function BuyingDashboard() {
  var _s = useState;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _store = _s('all'), store = _store[0], setStore = _store[1];
  var _bum = _s('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _dept = _s('all'), dept = _dept[0], setDept = _dept[1];
  var _vendor = _s('all'), vendor = _vendor[0], setVendor = _vendor[1];
  var _filter = _s('needs_order'), filter = _filter[0], setFilter = _filter[1];
  var _sort = _s('order_value'), sortCol = _sort[0], setSortCol = _sort[1];
  var _dir = _s('desc'), sortDir = _dir[0], setSortDir = _dir[1];
  var _safety = _s(0.5), safetyPct = _safety[0], setSafetyPct = _safety[1];

  var supabase = createClient();
  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('buying_data').select('*').order('item_number').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all); setLoading(false);
  }

  /* Aggregate and compute proposals */
  var proposals = useMemo(function() {
    if (!data.length) return [];

    // Filter by store: 'all' = everything, '1' = Curacao only (digits), 'B' = Bonaire only
    var filtered = data;
    if (store === '1') filtered = data.filter(function(r) { return /^\d+$/.test(r.store_number); });
    else if (store === 'B') filtered = data.filter(function(r) { return !(/^\d+$/.test(r.store_number)); });

    // Aggregate per item
    var map = {};
    filtered.forEach(function(r) {
      var key = r.item_number;
      var isBon = !(/^\d+$/.test(r.store_number)); // Bonaire = non-digit store numbers
      var cFactor = isBon ? XCG_USD : 1; // Convert Bonaire USD to XCG
      if (!map[key]) {
        map[key] = {
          item: r.item_number, desc: r.item_description,
          dept_code: r.dept_code, dept_name: r.dept_name,
          class_code: r.class_code, class_name: r.class_name,
          nos: r.nos === 'N', vendor: r.vendor_name || 'ONBEKEND',
          vendor_code: r.vendor_code, bum: r.bum || '',
          min_lt: parseFloat(r.min_lead_time) || 0,
          max_lt: parseFloat(r.max_lead_time) || 3,
          cost: (parseFloat(r.replacement_cost) || 0) * cFactor,
          qoh: 0, qc: 0, qa: 0, qoo: 0, inv_value: 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      m.qoh += parseFloat(r.qoh) || 0;
      m.qc += parseFloat(r.qty_committed) || 0;
      m.qa += parseFloat(r.qty_available) || 0;
      m.qoo += parseFloat(r.qty_on_order) || 0;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });

    var list = Object.values(map);

    // Compute proposal per item
    list.forEach(function(m) {
      // Reverse sales to chronological order (m01=newest → m12=oldest becomes [oldest..newest])
      var salesChrono = m.sales.slice().reverse();
      m.salesChrono = salesChrono;

      // Generate labels: m01=MAR 26(newest)...m12=APR 25(oldest), reversed to chronological
      // The month columns in the data are: m01=most recent, m12=oldest
      // After reverse: index 0=oldest(m12=APR 25), index 11=newest(m01=MAR 26)
      // Build labels based on current date minus N months
      var salesLabels = [];
      for (var li = 11; li >= 0; li--) {
        // li=11 is m01 (most recent), li=0 is m12 (oldest)
        // m01=Mar 26, m02=Feb 26, ... m12=Apr 25
        var monthsBack = li; // 11=newest(0 back), 0=oldest(11 back)
        // Use Mar 2026 as reference (m01)
        var refMonth = 2; // March = index 2 (0-based)
        var refYear = 2026;
        var calcMonth = refMonth - monthsBack;
        var calcYear = refYear;
        while (calcMonth < 0) { calcMonth += 12; calcYear--; }
        salesLabels.push(MN[calcMonth] + ' ' + String(calcYear).slice(2));
      }
      m.salesLabels = salesLabels;

      // Avg monthly (excl 0 months)
      var nonZero = m.sales.filter(function(s) { return s > 0; });
      m.avg_monthly = nonZero.length ? Math.round(nonZero.reduce(function(a, b) { return a + b; }, 0) / nonZero.length) : 0;
      m.active_months = nonZero.length;

      // Reorder point
      var safety = m.nos ? m.avg_monthly * safetyPct : 0;
      m.safety_stock = Math.round(safety);
      m.reorder_point = Math.round(m.avg_monthly * m.max_lt + safety);

      // Order needed
      m.order_qty = Math.round(Math.max(0, m.reorder_point - m.qa - m.qoo));
      m.order_value = m.order_qty * m.cost;

      // Coverage: how many months of stock do we have?
      m.months_cover = m.avg_monthly > 0 ? (m.qa + m.qoo) / m.avg_monthly : 999;

      // Urgency
      if (m.qa < 0 && m.qoo <= 0) m.urgency = 'critical';
      else if (m.order_qty > 0 && m.months_cover < 1) m.urgency = 'critical';
      else if (m.order_qty > 0) m.urgency = 'order';
      else if (m.months_cover < m.max_lt * 1.2) m.urgency = 'watch';
      else m.urgency = 'ok';
    });

    // Filter by dept
    if (dept !== 'all') list = list.filter(function(m) { return m.dept_code === dept; });
    // Filter by BUM
    if (selBum !== 'all') list = list.filter(function(m) { return m.bum === selBum; });
    // Filter by vendor
    if (vendor !== 'all') list = list.filter(function(m) { return m.vendor === vendor; });

    return list;
  }, [data, store, dept, selBum, vendor, safetyPct]);

  /* Filter and sort */
  var displayed = useMemo(function() {
    var list = proposals;
    if (filter === 'needs_order') list = list.filter(function(m) { return m.order_qty > 0; });
    else if (filter === 'critical') list = list.filter(function(m) { return m.urgency === 'critical'; });
    else if (filter === 'nos') list = list.filter(function(m) { return m.nos; });

    list = list.slice().sort(function(a, b) {
      var av = a[sortCol] || 0, bv = b[sortCol] || 0;
      if (typeof av === 'string') return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return list;
  }, [proposals, filter, sortCol, sortDir]);

  var depts = useMemo(function() { var s = {}; data.forEach(function(r) { if (selBum !== 'all' && r.bum !== selBum) return; s[r.dept_code] = r.dept_name; }); return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0); }); }, [data, selBum]);
  var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];
  var bums = useMemo(function() { var s = {}; data.forEach(function(r) { if (r.bum) s[r.bum] = true; }); var l = Object.keys(s); l.sort(function(a, b) { var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); }); return l; }, [data]);
  var vendors = useMemo(function() { var s = {}; proposals.forEach(function(p) { if (p.vendor) s[p.vendor] = true; }); return Object.keys(s).sort(); }, [proposals]);

  /* Totals */
  var totals = useMemo(function() {
    var needsOrder = proposals.filter(function(p) { return p.order_qty > 0; });
    var critical = proposals.filter(function(p) { return p.urgency === 'critical'; });
    return {
      total_items: proposals.length,
      needs_order: needsOrder.length,
      critical: critical.length,
      total_value: needsOrder.reduce(function(s, p) { return s + p.order_value; }, 0),
      total_inv: proposals.reduce(function(s, p) { return s + p.inv_value; }, 0),
    };
  }, [proposals]);

  function toggleSort(col) { if (sortCol === col) setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; }); else { setSortCol(col); setSortDir('desc'); } }
  var arrow = function(col) { return sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Inkoopvoorstel laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen buying data beschikbaar.</p></div>;

  return (
    <div className="max-w-[1700px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Inkoopvoorstel</h1>
          <p className="text-[13px] text-[#6b5240]">AI-gedreven buying proposal op basis van verkoophistorie, voorraad en lead times</p>
        </div>
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
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); setDept('all'); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); setDept('all'); }} />; })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={dept} onChange={function(e) { setDept(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle Afdelingen</option>
            {depts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[0] + ' — ' + d[1].replace(/^\d+\s*/, '')}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Vendor</span>
          <select value={vendor} onChange={function(e) { setVendor(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle vendors</option>
            {vendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}
          </select>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-4">Veiligheid</span>
          <div className="flex gap-1">
            {[['25%', 0.25], ['50%', 0.5], ['75%', 0.75], ['100%', 1.0]].map(function(o) {
              return <Pill key={o[0]} label={o[0]} active={safetyPct === o[1]} onClick={function() { setSafetyPct(o[1]); }} />;
            })}
          </div>
          <span className="text-[10px] text-[#a08a74]">Veiligheidsvoorraad voor NOS items</span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        {[
          { label: 'Totaal Items', value: fmt(totals.total_items), color: '#1a0a04' },
          { label: 'Te Bestellen', value: fmt(totals.needs_order), color: '#d97706' },
          { label: 'Kritiek', value: fmt(totals.critical), color: totals.critical > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Inkoopwaarde', value: fmtC(totals.total_value), color: '#1B3A5C' },
          { label: 'Voorraadwaarde', value: fmtC(totals.total_inv), color: '#6b5240' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
              <p className="text-[10px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[22px] font-semibold font-mono mt-1" style={{ color: k.color }}>{k.value}</p>
            </div>
          );
        })}
      </div>

      {/* Department SKU Status Overview */}
      {(function() {
        var deptMap = {};
        proposals.forEach(function(p) {
          var dc = p.dept_code;
          if (!deptMap[dc]) deptMap[dc] = { code: dc, name: p.class_name ? p.dept_name : dc, ok: 0, order: 0, critical: 0, total: 0 };
          deptMap[dc].total++;
          if (p.urgency === 'critical') deptMap[dc].critical++;
          else if (p.order_qty > 0) deptMap[dc].order++;
          else deptMap[dc].ok++;
        });
        var deptList = Object.values(deptMap).filter(function(d) { return d.total > 0; });
        deptList.sort(function(a, b) { return (b.critical / b.total) - (a.critical / a.total); });
        if (!deptList.length) return null;
        return (
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
            <h3 className="text-[15px] font-bold mb-1">SKU Status per Afdeling</h3>
            <p className="text-[12px] text-[#6b5240] mb-3">Gesorteerd op % kritieke items</p>
            <div className="flex items-center gap-4 text-[10px] mb-3">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> OK</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> Bestellen</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Kritiek</span>
            </div>
            <div className="space-y-2">
              {deptList.map(function(d) {
                var pOk = d.total ? (d.ok / d.total * 100) : 0;
                var pOrd = d.total ? (d.order / d.total * 100) : 0;
                var pCrit = d.total ? (d.critical / d.total * 100) : 0;
                return (
                  <div key={d.code} className="flex items-center gap-2 cursor-pointer hover:bg-[#faf5f0] py-1 px-1 rounded" onClick={function() { setDept(d.code); setFilter('all'); }}>
                    <div className="w-[140px] text-right text-[10px] text-[#1a0a04] truncate flex-shrink-0">
                      <span className="font-mono text-[#6b5240] mr-1">{d.code}</span>{d.name ? d.name.replace(/^\d+\s*/, '') : ''}
                    </div>
                    <div className="flex-1 flex h-[18px] rounded-sm overflow-hidden bg-[#f0ebe5]">
                      {pOk > 0 && <div style={{ width: pOk + '%', backgroundColor: '#16a34a' }} title={'OK: ' + d.ok}></div>}
                      {pOrd > 0 && <div style={{ width: pOrd + '%', backgroundColor: '#d97706' }} title={'Bestellen: ' + d.order}></div>}
                      {pCrit > 0 && <div style={{ width: pCrit + '%', backgroundColor: '#dc2626' }} title={'Kritiek: ' + d.critical}></div>}
                    </div>
                    <div className="w-[70px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">{d.ok + '/' + d.order + '/' + d.critical}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['needs_order', 'Te bestellen (' + totals.needs_order + ')'], ['critical', 'Kritiek (' + totals.critical + ')'], ['nos', 'Never Out of Stock'], ['all', 'Alle items (' + totals.total_items + ')']].map(function(item) {
          return <button key={item[0]} onClick={function() { setFilter(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (filter === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* Main table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1400px' }}>
            <thead>
              <tr className="bg-[#1B3A5C]">
                <th colSpan={3} className="text-left text-white text-[9px] font-bold uppercase py-2 px-2 border-r border-[#2a4f75]">Item</th>
                <th colSpan={4} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Voorraad</th>
                <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Verkoop</th>
                <th colSpan={2} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Vendor</th>
                <th colSpan={4} className="text-center text-white text-[9px] font-bold uppercase py-2">Voorstel</th>
              </tr>
              <tr className="bg-[#f0ebe5]">
                {[
                  ['', 'item', 'text-left min-w-[80px]'],
                  ['Omschrijving', 'desc', 'text-left min-w-[180px] border-r border-[#e5ddd4]'],
                  ['Status', 'urgency', 'text-center'],
                  ['QOH', 'qoh', 'text-right'],
                  ['Beschikb.', 'qa', 'text-right'],
                  ['Onderweg', 'qoo', 'text-right border-r border-[#e5ddd4]'],
                  ['Gem/mnd', 'avg_monthly', 'text-right'],
                  ['Actief', 'active_months', 'text-right'],
                  ['Trend', '', 'text-center border-r border-[#e5ddd4]'],
                  ['Vendor', 'vendor', 'text-left'],
                  ['LT', 'max_lt', 'text-right border-r border-[#e5ddd4]'],
                  ['Reorder Pt', 'reorder_point', 'text-right'],
                  ['Bestel qty', 'order_qty', 'text-right'],
                  ['Stukprijs', 'cost', 'text-right'],
                  ['Waarde', 'order_value', 'text-right'],
                ].map(function(h) {
                  var clickable = h[1] ? ' cursor-pointer hover:text-[#E84E1B]' : '';
                  return <th key={h[0] + h[1]} className={'p-1.5 text-[9px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap ' + h[2] + clickable} onClick={h[1] ? function() { toggleSort(h[1]); } : undefined}>{(h[0] || 'Item') + arrow(h[1])}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={15} className="p-8 text-center text-[#6b5240]">Geen items gevonden voor dit filter</td></tr>
              )}
              {displayed.map(function(p, i) {
                var bg = i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]';
                var qColor = p.qa < 0 ? '#dc2626' : '#1a0a04';
                return (
                  <tr key={p.item} className={bg + ' hover:bg-[#faf5f0]'}>
                    <td className="p-1.5 text-[11px] font-mono text-[#6b5240] border-b border-[#f0ebe5]">{p.item}</td>
                    <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4] truncate max-w-[200px]" title={p.desc}>
                      {p.desc}
                      {p.nos && <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">NOS</span>}
                    </td>
                    <td className="p-1.5 border-b border-[#f0ebe5] text-center"><UrgBadge level={p.urgency} /></td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(p.qoh))}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: qColor }}>{fmt(Math.round(p.qa))}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]" style={{ color: p.qoo > 0 ? '#1B3A5C' : '#a08a74' }}>{p.qoo > 0 ? fmt(Math.round(p.qoo)) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold">{fmt(p.avg_monthly)}</td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#6b5240]">{p.active_months + '/12'}</td>
                    <td className="p-1.5 border-b border-[#f0ebe5] border-r border-[#e5ddd4]"><Spark sales={p.salesChrono} labels={p.salesLabels} /></td>
                    <td className="p-1.5 text-[10px] border-b border-[#f0ebe5] truncate max-w-[140px]" title={p.vendor}>{p.vendor}</td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] border-r border-[#e5ddd4]">{p.max_lt > 0 ? (p.min_lt + '-' + p.max_lt + 'm') : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{fmt(p.reorder_point)}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: p.order_qty > 0 ? '#E84E1B' : '#16a34a' }}>{p.order_qty > 0 ? fmt(p.order_qty) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#6b5240]">{p.cost > 0 ? fmtC(p.cost) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: p.order_value > 0 ? '#E84E1B' : '#1a0a04' }}>{p.order_value > 0 ? fmtC(p.order_value) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vendor summary */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-8">
        <h3 className="text-[15px] font-bold mb-4">Samenvatting per Vendor</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f0ebe5]">
                <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Vendor</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Lead Time</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Items</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Te Bestellen</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Totaal Stuks</th>
                <th className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">Inkoopwaarde</th>
              </tr>
            </thead>
            <tbody>
              {(function() {
                var vMap = {};
                proposals.forEach(function(p) {
                  if (!vMap[p.vendor]) vMap[p.vendor] = { vendor: p.vendor, lt: p.min_lt + '-' + p.max_lt, items: 0, needs: 0, qty: 0, value: 0 };
                  vMap[p.vendor].items++;
                  if (p.order_qty > 0) { vMap[p.vendor].needs++; vMap[p.vendor].qty += p.order_qty; vMap[p.vendor].value += p.order_value; }
                });
                return Object.values(vMap).sort(function(a, b) { return b.value - a.value; }).map(function(v, i) {
                  return (
                    <tr key={v.vendor} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'} onClick={function() { setVendor(v.vendor); setFilter('needs_order'); }}>
                      <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-semibold">{v.vendor}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] text-[#6b5240]">{v.lt + ' mnd'}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{v.items}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: v.needs > 0 ? '#E84E1B' : '#16a34a' }}>{v.needs}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(v.qty)}</td>
                      <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] font-bold" style={{ color: v.value > 0 ? '#E84E1B' : '#1a0a04' }}>{fmtC(v.value)}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span><b>Reorder Point</b> = Gem. verkoop × Max LT + Veiligheidsvoorraad (NOS)</span>
          <span><b>Bestel qty</b> = Reorder Point - Beschikbaar - Onderweg</span>
          <span><UrgBadge level="critical" /> Negatieve voorraad of &lt;1 mnd dekking</span>
          <span><UrgBadge level="order" /> Moet besteld worden</span>
          <span><UrgBadge level="watch" /> Bijna op reorder point</span>
          <span><UrgBadge level="ok" /> Voldoende voorraad</span>
        </div>
      </div>
    </div>
  );
}
