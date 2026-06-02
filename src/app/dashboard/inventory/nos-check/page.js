/* ============================================================
   BESTAND: page_nos_check_v1.js
   KOPIEER NAAR: src/app/dashboard/inventory/nos-check/page.js
   (NIEUWE map maken: nos-check)
   VERSIE: v3.28.24

   NOS Check rapport — controle van NOS-classificatie tegen werkelijke verkoop.

   Twee modi:
   - 'wrong_nos': items met nos=true, qoh > 0 en som sales m01-m06 < 5
     → Onterechte NOS-classificatie (vragen voorraadruimte zonder verkoop)
   - 'missing_nos': items met nos=false en gemiddelde > 10/maand
     (= som 6mnd > 60). → Items die wél NOS zouden moeten zijn.

   Aggregatie: per item totaal (CUR+BON samen). Regio-toggle:
   - Alle: optellen
   - CUR / BON: alleen rijen uit die regio

   Filters: regio toggle, BUM dropdown, dept dropdown, zoekveld
   Klik op rij: detail-popup met meer info
   Excel-export
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';

var XCG_USD = 1.82;

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('nl-NL');
}
function fmtC(n) {
  if (n === null || n === undefined || isNaN(n)) return 'XCG 0';
  return 'XCG ' + Math.round(n).toLocaleString('nl-NL');
}

function Pill({ active, label, onClick, badge }) {
  return (
    <button onClick={onClick}
      className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' +
        (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')}>
      {label}
      {badge != null && (
        <span className={'ml-2 px-1.5 py-0.5 rounded-full text-[10px] ' +
          (active ? 'bg-white/20 text-white' : 'bg-[#faf7f4] text-[#6b5240]')}>
          {badge}
        </span>
      )}
    </button>
  );
}

var MN_SHORT = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

export default function NosCheckPage() {
  var _data = useState([]); var data = _data[0], setData = _data[1];
  var _loading = useState(true); var loading = _loading[0], setLoading = _loading[1];
  var _mode = useState('wrong_nos'); var mode = _mode[0], setMode = _mode[1];
  var _regio = useState('all'); var regio = _regio[0], setRegio = _regio[1];
  var _bum = useState('all'); var bum = _bum[0], setBum = _bum[1];
  var _dept = useState('all'); var dept = _dept[0], setDept = _dept[1];
  var _search = useState(''); var search = _search[0], setSearch = _search[1];
  var _sortCol = useState('value'); var sortCol = _sortCol[0], setSortCol = _sortCol[1];
  var _sortDir = useState('desc'); var sortDir = _sortDir[0], setSortDir = _sortDir[1];
  var _detail = useState(null); var detailItem = _detail[0], setDetailItem = _detail[1];

  var supabase = createClient();

  useEffect(function() { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    var all = [];
    var from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('buying_data').select('*').order('item_number').range(from, from + step - 1);
      if (r.error) { console.error('NOS check load error:', r.error.message); break; }
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all);
    setLoading(false);
  }

  // Aggregeer per item, met regio-split bewaard
  // Regio-toggle bepaalt of we totaal nemen, of alleen CUR of alleen BON
  var aggregatedItems = useMemo(function() {
    var map = {};
    data.forEach(function(r) {
      // Regio-filter
      if (regio === 'CUR' && r.regio !== 'CUR') return;
      if (regio === 'BON' && r.regio !== 'BON') return;
      var key = r.item_number;
      if (!map[key]) {
        map[key] = {
          item: r.item_number, desc: r.item_description,
          dept_code: r.dept_code, dept_name: r.dept_name,
          bum: r.bum || '', vendor: r.vendor_name || '',
          nos: false,
          qoh: 0, qoo: 0, inv_value: 0,
          qoh_cur: 0, qoh_bon: 0, qoo_cur: 0, qoo_bon: 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      // NOS: true als één van de rijen voor dit item nos='N' heeft
      if (String(r.nos || '').trim().toUpperCase() === 'N') m.nos = true;
      var isBon = r.regio === 'BON';
      var cFactor = isBon ? XCG_USD : 1;
      var qoh = parseFloat(r.qoh) || 0;
      var qoo = parseFloat(r.qty_on_order) || 0;
      m.qoh += qoh;
      m.qoo += qoo;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      if (r.regio === 'CUR') { m.qoh_cur += qoh; m.qoo_cur += qoo; }
      else if (r.regio === 'BON') { m.qoh_bon += qoh; m.qoo_bon += qoo; }
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });
    return Object.values(map);
  }, [data, regio]);

  // Bouw items voor beide modi (voor badge counts)
  // 'wrong_nos': nos=true, qoh > 0, som sales m01-m06 < 5
  // 'missing_nos': nos=false, som sales m01-m06 > 60 (= gem > 10/mnd)
  var wrongNosItems = useMemo(function() {
    return aggregatedItems.filter(function(m) {
      var sales6m = m.sales.slice(0, 6).reduce(function(a, b) { return a + b; }, 0);
      return m.nos && m.qoh > 0 && sales6m < 5;
    }).map(function(m) {
      var s6 = m.sales.slice(0, 6).reduce(function(a, b) { return a + b; }, 0);
      return Object.assign({}, m, { sales_6m: s6, avg_monthly: s6 / 6 });
    });
  }, [aggregatedItems]);

  var missingNosItems = useMemo(function() {
    return aggregatedItems.filter(function(m) {
      var sales6m = m.sales.slice(0, 6).reduce(function(a, b) { return a + b; }, 0);
      return !m.nos && sales6m > 60;
    }).map(function(m) {
      var s6 = m.sales.slice(0, 6).reduce(function(a, b) { return a + b; }, 0);
      return Object.assign({}, m, { sales_6m: s6, avg_monthly: s6 / 6 });
    });
  }, [aggregatedItems]);

  var activeItems = mode === 'wrong_nos' ? wrongNosItems : missingNosItems;

  // BUM en dept filter opties — alleen uit de actieve items (zodat de dropdowns relevant zijn)
  var bumOpts = useMemo(function() {
    var s = {};
    activeItems.forEach(function(m) { if (m.bum) s[m.bum] = true; });
    return Object.keys(s).sort();
  }, [activeItems]);

  var deptOpts = useMemo(function() {
    var s = {};
    activeItems.forEach(function(m) { if (m.dept_code) s[m.dept_code] = m.dept_name || m.dept_code; });
    return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0); });
  }, [activeItems]);

  // Pas filters toe
  var filteredItems = useMemo(function() {
    var list = activeItems;
    if (bum !== 'all') list = list.filter(function(m) { return m.bum === bum; });
    if (dept !== 'all') list = list.filter(function(m) { return m.dept_code === dept; });
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      list = list.filter(function(m) {
        return (m.item || '').toLowerCase().includes(q) ||
               (m.desc || '').toLowerCase().includes(q) ||
               (m.dept_name || '').toLowerCase().includes(q) ||
               (m.vendor || '').toLowerCase().includes(q);
      });
    }
    // Sort
    list = list.slice().sort(function(a, b) {
      var av, bv;
      if (sortCol === 'item') { av = a.item; bv = b.item; }
      else if (sortCol === 'desc') { av = a.desc; bv = b.desc; }
      else if (sortCol === 'bum') { av = a.bum; bv = b.bum; }
      else if (sortCol === 'dept') { av = a.dept_code; bv = b.dept_code; }
      else if (sortCol === 'qoh') { av = a.qoh; bv = b.qoh; }
      else if (sortCol === 'qoo') { av = a.qoo; bv = b.qoo; }
      else if (sortCol === 'sales') { av = a.sales_6m; bv = b.sales_6m; }
      else if (sortCol === 'avg') { av = a.avg_monthly; bv = b.avg_monthly; }
      else if (sortCol === 'value') { av = a.inv_value; bv = b.inv_value; }
      else { av = a[sortCol] || 0; bv = b[sortCol] || 0; }
      if (typeof av === 'string') return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [activeItems, bum, dept, search, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; });
    } else {
      setSortCol(col);
      setSortDir(col === 'item' || col === 'desc' || col === 'bum' || col === 'dept' ? 'asc' : 'desc');
    }
  }
  var arrow = function(col) { return sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  // KPIs
  var totalCount = filteredItems.length;
  var totalValue = filteredItems.reduce(function(a, m) { return a + m.inv_value; }, 0);
  var avgSalesPerMonth = filteredItems.length
    ? filteredItems.reduce(function(a, m) { return a + m.avg_monthly; }, 0) / filteredItems.length
    : 0;

  if (loading) return <LoadingLogo text="NOS Check laden..." />;

  return (
    <div className="max-w-[1500px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>
      {/* Header */}
      <div className="mb-5">
        <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900, margin: 0 }}>NOS Check</h1>
        <p className="text-[13px] text-[#6b5240]" style={{ margin: '4px 0 0' }}>Controleer NOS-classificatie tegen werkelijke verkoop (laatste 6 maanden)</p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Pill active={mode === 'wrong_nos'} label="Onterechte NOS" badge={wrongNosItems.length} onClick={function() { setMode('wrong_nos'); }} />
        <Pill active={mode === 'missing_nos'} label="Ontbrekende NOS" badge={missingNosItems.length} onClick={function() { setMode('missing_nos'); }} />
      </div>
      <p className="text-[11px] text-[#6b5240] italic mb-4">
        {mode === 'wrong_nos'
          ? 'NOS-items met voorraad > 0 die minder dan 5x verkochten in 6 maanden — vermoedelijk onterecht als NOS aangemerkt.'
          : 'Niet-NOS items die meer dan 10x per maand verkopen — kandidaten om als NOS aan te merken.'}
      </p>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[10px] text-[#6b5240] uppercase tracking-wide font-bold mr-1">Regio:</span>
        <Pill active={regio === 'all'} label="Alle" onClick={function() { setRegio('all'); }} />
        <Pill active={regio === 'CUR'} label="Curaçao" onClick={function() { setRegio('CUR'); }} />
        <Pill active={regio === 'BON'} label="Bonaire" onClick={function() { setRegio('BON'); }} />

        <select value={bum} onChange={function(e) { setBum(e.target.value); }}
          className="text-[12px] px-3 py-1.5 rounded-full border border-[#e5ddd4] bg-white text-[#1a0a04] cursor-pointer ml-2">
          <option value="all">Alle BUMs</option>
          {bumOpts.map(function(b) { return <option key={b} value={b}>{b}</option>; })}
        </select>

        <select value={dept} onChange={function(e) { setDept(e.target.value); }}
          className="text-[12px] px-3 py-1.5 rounded-full border border-[#e5ddd4] bg-white text-[#1a0a04] cursor-pointer">
          <option value="all">Alle afdelingen</option>
          {deptOpts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[0]} — {d[1]}</option>; })}
        </select>

        <input type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
          placeholder="Zoek item, omschrijving, vendor..."
          className="text-[12px] px-3 py-1.5 rounded-full border border-[#e5ddd4] bg-white text-[#1a0a04] flex-1 min-w-[180px] outline-none focus:border-[#E84E1B]" />

        <ExcelExportButton
          sheets={[{
            name: mode === 'wrong_nos' ? 'Onterechte NOS' : 'Ontbrekende NOS',
            rows: filteredItems.map(function(m) {
              return {
                'Item': m.item,
                'Omschrijving': m.desc,
                'Dept': m.dept_code,
                'Departement': m.dept_name,
                'BUM': m.bum,
                'Vendor': m.vendor,
                'NOS': m.nos ? 'Ja' : 'Nee',
                'QOH totaal': Math.round(m.qoh),
                'QOH CUR': Math.round(m.qoh_cur),
                'QOH BON': Math.round(m.qoh_bon),
                'QOO totaal': Math.round(m.qoo),
                'Verkoop 6 mnd': Math.round(m.sales_6m),
                'Gemiddeld per maand': Math.round(m.avg_monthly * 10) / 10,
                'Voorraadwaarde (XCG)': Math.round(m.inv_value),
              };
            }),
          }]}
          filename={(function() {
            var d = new Date();
            var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
            return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_nos_check_' + mode + '_' + regio;
          })()}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-[#faf7f4] rounded-[10px] px-4 py-3 border border-[#e5ddd4]">
          <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Aantal items</p>
          <p className="text-[24px] font-bold m-0 mt-1" style={{ color: '#1B3A5C' }}>{fmt(totalCount)}</p>
        </div>
        <div className="bg-[#faf7f4] rounded-[10px] px-4 py-3 border border-[#e5ddd4]">
          <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Voorraadwaarde</p>
          <p className="text-[24px] font-bold m-0 mt-1" style={{ color: mode === 'wrong_nos' ? '#dc2626' : '#1B3A5C' }}>{fmtC(totalValue)}</p>
        </div>
        <div className="bg-[#faf7f4] rounded-[10px] px-4 py-3 border border-[#e5ddd4]">
          <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Gem. verkoop / maand</p>
          <p className="text-[24px] font-bold m-0 mt-1" style={{ color: '#1B3A5C' }}>{Math.round(avgSalesPerMonth * 10) / 10}</p>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1200px' }}>
            <thead className="sticky top-0 z-30">
              <tr className="bg-[#1B3A5C]">
                <th colSpan={9} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">
                  {mode === 'wrong_nos' ? 'Onterechte NOS-items (lage verkoop maar wel NOS)' : 'Ontbrekende NOS-items (hoge verkoop maar niet NOS)'}
                </th>
              </tr>
              <tr className="bg-[#f0ebe5]">
                <th onClick={function() { toggleSort('item'); }}
                    className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '120px' }}>Item{arrow('item')}</th>
                <th onClick={function() { toggleSort('desc'); }}
                    className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]">Omschrijving{arrow('desc')}</th>
                <th onClick={function() { toggleSort('bum'); }}
                    className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '90px' }}>BUM{arrow('bum')}</th>
                <th onClick={function() { toggleSort('dept'); }}
                    className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '70px' }}>Dept{arrow('dept')}</th>
                <th onClick={function() { toggleSort('qoh'); }}
                    className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '70px' }}>QOH{arrow('qoh')}</th>
                <th onClick={function() { toggleSort('qoo'); }}
                    className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '70px' }}>QOO{arrow('qoo')}</th>
                <th onClick={function() { toggleSort('sales'); }}
                    className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '100px' }}>6 mnd verkoop{arrow('sales')}</th>
                <th onClick={function() { toggleSort('avg'); }}
                    className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '90px' }}>Gem/mnd{arrow('avg')}</th>
                <th onClick={function() { toggleSort('value'); }}
                    className="text-right p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap cursor-pointer hover:text-[#E84E1B]"
                    style={{ width: '110px' }}>Voorraadwaarde{arrow('value')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-[#6b5240]">
                  {totalCount === 0 && activeItems.length > 0
                    ? 'Geen items met deze filtercombinatie.'
                    : (mode === 'wrong_nos'
                      ? 'Geen onterechte NOS-items gevonden — alle NOS-items hebben voldoende verkoop.'
                      : 'Geen ontbrekende NOS-items gevonden — alle veel-verkopers staan al als NOS.')}
                </td></tr>
              )}
              {filteredItems.map(function(m) {
                var salesColor = m.sales_6m === 0 ? '#dc2626' : (m.sales_6m < 5 ? '#dc2626' : '#1a0a04');
                return (
                  <tr key={m.item} className="hover:bg-[#faf7f4] cursor-pointer border-b border-[#f0ebe5]"
                      onClick={function() { setDetailItem(m); }}>
                    <td className="p-2 font-mono text-[11px] text-[#1B3A5C] font-semibold">{m.item}</td>
                    <td className="p-2">{m.desc}</td>
                    <td className="p-2 text-[11px] text-[#6b5240]">{m.bum}</td>
                    <td className="p-2 font-mono text-[11px] text-[#6b5240]">{m.dept_code}</td>
                    <td className="p-2 text-right font-mono">{fmt(m.qoh)}</td>
                    <td className="p-2 text-right font-mono" style={{ color: m.qoo > 0 ? '#1B3A5C' : '#a08a74' }}>{m.qoo > 0 ? fmt(m.qoo) : '—'}</td>
                    <td className="p-2 text-right font-mono font-semibold" style={{ color: salesColor }}>{fmt(m.sales_6m)}</td>
                    <td className="p-2 text-right font-mono" style={{ color: '#6b5240' }}>{(Math.round(m.avg_monthly * 10) / 10).toLocaleString('nl-NL')}</td>
                    <td className="p-2 text-right font-mono font-semibold" style={{ color: mode === 'wrong_nos' ? '#dc2626' : '#1B3A5C' }}>{fmtC(m.inv_value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail popup */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={function() { setDetailItem(null); }}>
          <div className="bg-white rounded-[14px] shadow-xl max-w-[640px] w-full p-6" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Item</p>
                <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px', fontWeight: 900, margin: 0 }}>{detailItem.item}</h2>
                <p className="text-[13px] text-[#1a0a04] m-0 mt-1">{detailItem.desc}</p>
              </div>
              <button onClick={function() { setDetailItem(null); }}
                className="text-[#6b5240] hover:text-[#1a0a04] text-[20px] leading-none w-[28px] h-[28px] flex items-center justify-center rounded-full hover:bg-[#faf7f4]">×</button>
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-[#faf7f4] rounded-[8px] px-3 py-2 border border-[#e5ddd4]">
                <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">BUM</p>
                <p className="text-[14px] m-0 mt-0.5">{detailItem.bum || '—'}</p>
              </div>
              <div className="bg-[#faf7f4] rounded-[8px] px-3 py-2 border border-[#e5ddd4]">
                <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Afdeling</p>
                <p className="text-[14px] m-0 mt-0.5">{detailItem.dept_code} — {detailItem.dept_name}</p>
              </div>
              <div className="bg-[#faf7f4] rounded-[8px] px-3 py-2 border border-[#e5ddd4]">
                <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">Vendor</p>
                <p className="text-[12px] m-0 mt-0.5">{detailItem.vendor || '—'}</p>
              </div>
              <div className="bg-[#faf7f4] rounded-[8px] px-3 py-2 border border-[#e5ddd4]">
                <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0">NOS-status</p>
                <p className="text-[14px] m-0 mt-0.5">{detailItem.nos ? 'Ja' : 'Nee'}</p>
              </div>
            </div>

            {/* QOH / QOO regio split */}
            <div className="bg-[#faf7f4] rounded-[8px] px-3 py-3 border border-[#e5ddd4] mb-4">
              <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0 mb-2">Voorraad & onderweg</p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#6b5240] uppercase">
                    <th className="text-left font-semibold pb-1"></th>
                    <th className="text-right font-semibold pb-1">CUR</th>
                    <th className="text-right font-semibold pb-1">BON</th>
                    <th className="text-right font-semibold pb-1">Totaal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 text-[#6b5240]">QOH</td>
                    <td className="text-right font-mono py-1">{fmt(detailItem.qoh_cur)}</td>
                    <td className="text-right font-mono py-1">{fmt(detailItem.qoh_bon)}</td>
                    <td className="text-right font-mono font-semibold py-1">{fmt(detailItem.qoh)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-[#6b5240]">QOO</td>
                    <td className="text-right font-mono py-1">{fmt(detailItem.qoo_cur)}</td>
                    <td className="text-right font-mono py-1">{fmt(detailItem.qoo_bon)}</td>
                    <td className="text-right font-mono font-semibold py-1">{fmt(detailItem.qoo)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Maandverkoop bars */}
            <div className="bg-[#faf7f4] rounded-[8px] px-3 py-3 border border-[#e5ddd4] mb-4">
              <p className="text-[10px] uppercase tracking-wide text-[#6b5240] font-bold m-0 mb-2">Verkoop per maand (laatste 12 maanden, recent links)</p>
              {(function() {
                var maxSale = Math.max.apply(null, detailItem.sales.concat([1]));
                var now = new Date();
                return (
                  <div className="flex items-end gap-1" style={{ height: '90px' }}>
                    {detailItem.sales.map(function(v, i) {
                      var monthOffset = i; // 0 = recent
                      var d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
                      var label = MN_SHORT[d.getMonth()];
                      var h = Math.max(2, (v / maxSale) * 80);
                      var color = i < 6 ? '#E84E1B' : '#c5bfb3';
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className="text-[9px] text-[#6b5240] font-mono">{Math.round(v)}</div>
                          <div style={{ height: h + 'px', width: '100%', backgroundColor: color, borderRadius: '2px' }}
                               title={label + ': ' + Math.round(v)}></div>
                          <div className="text-[9px] text-[#a08a74]">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <p className="text-[10px] text-[#a08a74] italic mt-2 m-0">Oranje = laatste 6 maanden (gebruikt voor NOS check)</p>
            </div>

            {/* Samenvatting */}
            <div className="bg-[#faf7f4] rounded-[8px] px-3 py-3 border border-[#e5ddd4]">
              <table className="w-full text-[12px]">
                <tbody>
                  <tr>
                    <td className="py-1 text-[#6b5240]">Verkoop laatste 6 maanden</td>
                    <td className="text-right font-mono font-semibold py-1">{fmt(detailItem.sales_6m)} stuks</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-[#6b5240]">Gemiddeld per maand</td>
                    <td className="text-right font-mono py-1">{(Math.round(detailItem.avg_monthly * 10) / 10).toLocaleString('nl-NL')}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-[#6b5240]">Voorraadwaarde</td>
                    <td className="text-right font-mono font-semibold py-1" style={{ color: mode === 'wrong_nos' ? '#dc2626' : '#1B3A5C' }}>{fmtC(detailItem.inv_value)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
