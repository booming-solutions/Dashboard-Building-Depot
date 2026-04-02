/* ============================================================
   BESTAND: page_negative_inventory.js
   KOPIEER NAAR: src/app/dashboard/inventory/negative/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a)); };
var fmtC = function(n) { return 'Cg ' + fmt(Math.round(n || 0)); };

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

export default function NegativeInventoryDashboard() {
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _store = useState('all'), store = _store[0], setStore = _store[1];
  var _dept = useState('all'), dept = _dept[0], setDept = _dept[1];
  var _bum = useState('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _storeView = useState('all'), storeView = _storeView[0], setStoreView = _storeView[1];
  var _sort = useState('value'), sortCol = _sort[0], setSortCol = _sort[1];
  var _sortDir = useState('asc'), sortDir = _sortDir[0], setSortDir = _sortDir[1];
  var _search = useState(''), search = _search[0], setSearch = _search[1];
  var _rows = useState(25), tableRows = _rows[0], setTableRows = _rows[1];

  var supabase = createClient();

  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('negative_inventory').select('*').order('dept_code').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all);
    setLoading(false);
  }

  // Classify stores: 1-9 + R = Curaçao, A/B = Bonaire
  var classified = useMemo(function() {
    return data.map(function(r) {
      var sn = String(r.store_number);
      var region = (sn === 'A' || sn === 'B') ? 'Bonaire' : 'Curaçao';
      return Object.assign({}, r, { region: region });
    });
  }, [data]);

  // Filter
  var filtered = useMemo(function() {
    return classified.filter(function(r) {
      if (store !== 'all' && r.region !== store) return false;
      if (storeView !== 'all' && String(r.store_number) !== storeView) return false;
      if (selBum !== 'all' && r.bum !== selBum) return false;
      if (dept !== 'all' && r.dept_code !== dept) return false;
      if (search) {
        var s = search.toLowerCase();
        if (!(r.item_number || '').toLowerCase().includes(s) &&
            !(r.item_description || '').toLowerCase().includes(s) &&
            !(r.dept_name || '').toLowerCase().includes(s) &&
            !(r.class_name || '').toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [classified, store, storeView, selBum, dept, search]);

  // Aggregate per item across stores (within region)
  var aggregated = useMemo(function() {
    var map = {};
    filtered.forEach(function(r) {
      var key = r.item_number + '|' + r.region;
      if (!map[key]) {
        map[key] = {
          item_number: r.item_number,
          item_description: r.item_description,
          dept_code: r.dept_code,
          dept_name: r.dept_name,
          class_code: r.class_code,
          class_name: r.class_name,
          region: r.region,
          qty: 0,
          value: 0,
          avg_cost: parseFloat(r.avg_cost_per_unit) || 0,
          stores: [],
        };
      }
      map[key].qty += parseFloat(r.qty_on_hand) || 0;
      map[key].value += parseFloat(r.inv_value) || 0;
      var sn = String(r.store_number);
      if (map[key].stores.indexOf(sn) === -1) map[key].stores.push(sn);
    });
    return Object.values(map);
  }, [filtered]);

  // Sort
  var sorted = useMemo(function() {
    var list = aggregated.slice();
    list.sort(function(a, b) {
      var va, vb;
      if (sortCol === 'value') { va = a.value; vb = b.value; }
      else if (sortCol === 'qty') { va = a.qty; vb = b.qty; }
      else if (sortCol === 'dept') { va = parseInt(a.dept_code) || 999; vb = parseInt(b.dept_code) || 999; }
      else if (sortCol === 'item') { va = a.item_number; vb = b.item_number; }
      else if (sortCol === 'desc') { va = a.item_description; vb = b.item_description; }
      else { va = a.value; vb = b.value; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return list;
  }, [aggregated, sortCol, sortDir]);

  // Department summary
  var deptSummary = useMemo(function() {
    var map = {};
    filtered.forEach(function(r) {
      var dc = r.dept_code;
      if (!map[dc]) map[dc] = { code: dc, name: r.dept_name, items: 0, qty: 0, value: 0, uniqueItems: {} };
      map[dc].qty += parseFloat(r.qty_on_hand) || 0;
      map[dc].value += parseFloat(r.inv_value) || 0;
      map[dc].uniqueItems[r.item_number] = true;
    });
    Object.values(map).forEach(function(d) { d.items = Object.keys(d.uniqueItems).length; });
    return Object.values(map).sort(function(a, b) { return a.value - b.value; });
  }, [filtered]);

  // Totals
  var totals = useMemo(function() {
    var items = 0, qty = 0, value = 0, uniqueItems = {};
    filtered.forEach(function(r) {
      qty += parseFloat(r.qty_on_hand) || 0;
      value += parseFloat(r.inv_value) || 0;
      uniqueItems[r.item_number] = true;
    });
    items = Object.keys(uniqueItems).length;
    return { items: items, qty: qty, value: value };
  }, [filtered]);

  // Unique BUMs
  var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];
  var bums = useMemo(function() {
    var s = {};
    classified.forEach(function(r) {
      if (store !== 'all' && r.region !== store) return;
      if (r.bum && r.bum !== 'OTHER') s[r.bum] = true;
    });
    var l = Object.keys(s);
    l.sort(function(a, b) { var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b); if (ai !== -1 && bi !== -1) return ai - bi; if (ai !== -1) return -1; if (bi !== -1) return 1; return a.localeCompare(b); });
    return l;
  }, [classified, store]);

  // Unique depts for filter
  var depts = useMemo(function() {
    var s = {};
    classified.forEach(function(r) {
      if (store !== 'all' && r.region !== store) return;
      if (selBum !== 'all' && r.bum !== selBum) return;
      s[r.dept_code] = r.dept_name;
    });
    return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 999) - (parseInt(b[0]) || 999); });
  }, [classified, store, selBum]);

  // Unique stores for sub-filter
  var storeList = useMemo(function() {
    var s = {};
    classified.forEach(function(r) {
      if (store !== 'all' && r.region !== store) return;
      s[r.store_number] = r.store_short_name || r.store_number;
    });
    return Object.entries(s).sort(function(a, b) { return a[0].localeCompare(b[0]); });
  }, [classified, store]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(function(d) { return d === 'asc' ? 'desc' : 'asc'; });
    else { setSortCol(col); setSortDir('asc'); }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Negatieve voorraad laden...</p></div>;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen negatieve voorraad data beschikbaar.</p></div>;

  var latestDate = data[0] && data[0].report_date ? data[0].report_date : '';
  var dateParts = latestDate ? latestDate.split('-') : [];
  var dateLabel = dateParts.length === 3 ? (parseInt(dateParts[2]) + ' ' + MN[parseInt(dateParts[1]) - 1] + ' ' + dateParts[0]) : '';

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Negatieve Voorraad</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot' + (dateLabel ? ' — data t/m ' + dateLabel : '') + ' — items met negatieve voorraad die aandacht vereisen'}</p>
        </div>
        <div className="border-2 border-[#dc2626] text-[#dc2626] px-4 py-1.5 rounded-full text-[13px] font-bold">
          {fmt(totals.items) + ' items · ' + fmtC(Math.abs(totals.value))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Regio</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={store === 'all'} onClick={function() { setStore('all'); setStoreView('all'); setDept('all'); }} />
            <Pill label="Curaçao" active={store === 'Curaçao'} onClick={function() { setStore('Curaçao'); setStoreView('all'); setDept('all'); }} />
            <Pill label="Bonaire" active={store === 'Bonaire'} onClick={function() { setStore('Bonaire'); setStoreView('all'); setDept('all'); }} />
          </div>
        </div>
        {store !== 'all' && storeList.length > 1 && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Winkel</span>
            <div className="flex gap-1">
              <Pill label="Alle" active={storeView === 'all'} onClick={function() { setStoreView('all'); }} />
              {storeList.map(function(s) { return <Pill key={s[0]} label={s[0] + ' ' + s[1]} active={storeView === s[0]} onClick={function() { setStoreView(s[0]); }} />; })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); setDept('all'); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); setDept('all'); }} />; })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={dept} onChange={function(e) { setDept(e.target.value); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle Departementen</option>
            {depts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[1]}</option>; })}
          </select>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Unieke Items', value: fmt(totals.items), sub: 'met negatieve voorraad' },
          { label: 'Totaal Stuks', value: fmt(Math.abs(totals.qty)), sub: 'negatief in voorraad', color: '#dc2626' },
          { label: 'Voorraadwaarde', value: fmtC(Math.abs(totals.value)), sub: 'te controleren', color: '#dc2626' },
          { label: 'Departementen', value: fmt(deptSummary.length), sub: 'met negatieve items' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: k.color || '#E84E1B' }}></div>
              <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[28px] font-semibold font-mono mt-1" style={{ color: k.color || '#1a0a04' }}>{k.value}</p>
              <p className="text-[11px] text-[#a08a74] mt-0.5">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Department breakdown bar chart */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <h3 className="text-[15px] font-bold mb-1">Negatieve waarde per afdeling</h3>
        <p className="text-[12px] text-[#6b5240] mb-3">Gesorteerd op hoogste negatieve waarde</p>
        <div className="space-y-1.5">
          {deptSummary.slice(0, 20).map(function(d) {
            var maxVal = deptSummary.length ? Math.abs(deptSummary[0].value) : 1;
            var barW = maxVal ? (Math.abs(d.value) / maxVal) * 100 : 0;
            return (
              <div key={d.code} className="flex items-center gap-2 py-[2px] cursor-pointer hover:bg-[#faf5f0] px-1 rounded" onClick={function() { setDept(d.code); }}>
                <div className="w-[160px] text-right text-[10px] text-[#1a0a04] truncate flex-shrink-0">
                  <span className="font-mono text-[#6b5240] mr-1">{d.code}</span>{(d.name || '').replace(/^\d+\s*/, '')}
                </div>
                <div className="flex-1 h-[18px] bg-[#f0ebe5] rounded-sm overflow-hidden">
                  <div className="h-full rounded-sm" style={{ width: barW + '%', backgroundColor: '#dc2626', opacity: 0.7 }}></div>
                </div>
                <div className="w-[80px] text-[10px] font-mono text-[#dc2626] text-right flex-shrink-0">{fmtC(Math.abs(d.value))}</div>
                <div className="w-[50px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">{fmt(d.items)} items</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="flex items-center justify-between p-4 border-b border-[#e5ddd4]">
          <h3 className="text-[15px] font-bold">Detail — Items met negatieve voorraad</h3>
          <div className="flex items-center gap-3">
            <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Zoek item of omschrijving..." className="px-3 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px] w-[220px]" />
            <select value={tableRows} onChange={function(e) { setTableRows(parseInt(e.target.value)); }} className="px-2 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px]">
              {[25, 50, 100, 250].map(function(n) { return <option key={n} value={n}>{n} rijen</option>; })}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="bg-[#f0ebe5]">
                {[
                  ['Dept', 'dept'], ['Afdeling', 'desc'], ['Item', 'item'], ['Omschrijving', 'desc'],
                  ['Aantal', 'qty'], ['Waarde', 'value'], ['Stuksprijs', 'cost'], ['Winkels', 'stores']
                ].map(function(h) {
                  return <th key={h[0]} onClick={function() { toggleSort(h[1]); }}
                    className={'p-2.5 text-[10px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] cursor-pointer hover:text-[#E84E1B] whitespace-nowrap ' + (h[0] === 'Aantal' || h[0] === 'Waarde' || h[0] === 'Stuksprijs' ? 'text-right' : 'text-left')}>
                    {h[0]}{sortCol === h[1] ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>;
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, tableRows).map(function(r, i) {
                return (
                  <tr key={r.item_number + r.region + i} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                    <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{r.dept_code}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[140px]" title={r.dept_name}>{(r.dept_name || '').replace(/^\d+\s*/, '')}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-mono text-[#1B3A5C]">{r.item_number}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[250px]" title={r.item_description}>{r.item_description}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] text-[#dc2626] font-semibold">{fmt(Math.round(r.qty))}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5] text-[#dc2626] font-semibold">{fmt(Math.round(Math.abs(r.value)))}</td>
                    <td className="p-2 text-right font-mono text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{r.avg_cost ? r.avg_cost.toFixed(2) : '-'}</td>
                    <td className="p-2 text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{r.stores.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length > tableRows && (
          <div className="p-3 text-center text-[12px] text-[#6b5240] border-t border-[#e5ddd4]">
            {'Toont ' + Math.min(tableRows, sorted.length) + ' van ' + sorted.length + ' items'}
          </div>
        )}
      </div>

      {/* Export button */}
      <div className="flex justify-end mb-5">
        <button onClick={function() {
          var csvRows = ['Dept,Afdeling,Item,Omschrijving,Aantal,Waarde,Stuksprijs,Winkels'];
          sorted.forEach(function(r) {
            csvRows.push([r.dept_code, '"' + (r.dept_name || '') + '"', r.item_number, '"' + (r.item_description || '').replace(/"/g, '""') + '"', Math.round(r.qty), Math.round(r.value), (r.avg_cost || 0).toFixed(2), '"' + r.stores.join(', ') + '"'].join(','));
          });
          var blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'negatieve_voorraad.csv';
          a.click();
        }} className="px-5 py-2.5 rounded-lg bg-white text-[#E84E1B] text-[13px] font-semibold border border-[#E84E1B] hover:bg-[#faf5f0]">
          Exporteer CSV
        </button>
      </div>
    </div>
  );
}
