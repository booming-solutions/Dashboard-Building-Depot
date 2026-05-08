/* ============================================================
   BESTAND: page_price_changes_v6.js
   KOPIEER NAAR: src/app/dashboard/inventory/price-changes/page.js
   VERSIE: v6.0

   Wijzigingen t.o.v. v5:
   - Minimum drempel 0,5% (was 0%)
     · Wijzigingen <0,5% gelden als afrondings-ruis (paar tienden cent)
     · Slider min = 0,5 (was 0)
     · Initial drempel = 0,5 (was 0)
     · Footer-tekst aangepast
   - Filter "x.pct !== 0" vervangen door "abs(pct) >= 0.5"

   Wijzigingen t.o.v. v4:
   - BUGFIX: items met 0% wijziging werden meegeteld als "gewijzigd"
   - Sortable tabel-kolommen — klik op header om te sorteren

   Wijzigingen t.o.v. v3:
   - Nieuwe KPI tile "% van totaal"
   - Sub-tekst onder "Items met wijziging": "van X totaal"
   - KPI grid van 5 naar 6 kolommen

   Wijzigingen t.o.v. v2:
   - BUGFIX: dropdown toonde maar 1 datum (Supabase 1000-row limit)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtPrice = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var fmtPct = function(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
};
var fmtDate = function(d) {
  if (!d) return '';
  var p = d.split('-');
  return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + ' ' + p[0];
};

function Pill({ label, active, onClick }) {
  return (
    <button
      className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' +
        (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')}
      onClick={onClick}
    >{label}</button>
  );
}

function SortTh({ col, current, dir, onClick, align, children }) {
  var isActive = current === col;
  var arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  var alignClass = align === 'right' ? 'text-right' : (align === 'center' ? 'text-center' : 'text-left');
  return (
    <th
      onClick={function() { onClick(col); }}
      className={alignClass + ' p-2 text-white text-[10px] font-bold uppercase bg-[#1B3A5C] cursor-pointer select-none hover:bg-[#264a72]'}
      style={{ userSelect: 'none' }}
    >
      {children}{arrow}
    </th>
  );
}

export default function PriceChangesDashboard() {
  var supabase = createClient();
  var _s = useState;

  var _l = _s(true), loading = _l[0], setLoading = _l[1];
  var _dates = _s([]), availableDates = _dates[0], setAvailableDates = _dates[1];
  var _df = _s(''), dateFrom = _df[0], setDateFrom = _df[1];
  var _dt = _s(''), dateTo = _dt[0], setDateTo = _dt[1];
  var _regio = _s('CUR'), regio = _regio[0], setRegio = _regio[1];
  var _dept = _s('all'), selDept = _dept[0], setSelDept = _dept[1];
  var _drempel = _s(0.5), drempel = _drempel[0], setDrempel = _drempel[1];
  var _direction = _s('all'), direction = _direction[0], setDirection = _direction[1]; // all, up, down
  var _data = _s({ from: [], to: [] }), data = _data[0], setData = _data[1];
  var _depts = _s([]), depts = _depts[0], setDepts = _depts[1];

  // Sort state — default: grootste absolute wijziging eerst
  var _sc = _s('pct_abs'), sortCol = _sc[0], setSortCol = _sc[1];
  var _sd = _s('desc'), sortDir = _sd[0], setSortDir = _sd[1];

  // Initial load: get available dates
  // BUG FIX v3: Supabase heeft default limit van 1000 rijen. Met 100k+ rijen
  // in price_snapshots kreeg je dus alleen de oudste datum terug.
  // Oplossing: paginatie tot we alle datums hebben gezien.
  useEffect(function() {
    async function load() {
      var allDates = {};
      var from = 0, step = 1000, lastSeenDate = null, sameCount = 0;
      while (true) {
        var r = await supabase
          .from('price_snapshots')
          .select('snapshot_date')
          .order('snapshot_date', { ascending: true })
          .range(from, from + step - 1);
        if (!r.data || !r.data.length) break;
        r.data.forEach(function(x) { allDates[x.snapshot_date] = true; });
        if (r.data.length < step) break;
        // Veiligheidskap: na 200k rows (200 pages) stoppen om hangen te voorkomen
        from += step;
        if (from > 200000) {
          console.warn('Price snapshots: stopped paginating after 200k rows');
          break;
        }
      }
      var sortedDates = Object.keys(allDates).sort();
      console.log('Price snapshots: ' + sortedDates.length + ' unique dates loaded');
      setAvailableDates(sortedDates);
      if (sortedDates.length >= 2) {
        setDateFrom(sortedDates[0]);
        setDateTo(sortedDates[sortedDates.length - 1]);
      } else if (sortedDates.length === 1) {
        setDateFrom(sortedDates[0]);
        setDateTo(sortedDates[0]);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Load snapshots for selected date range + regio
  useEffect(function() {
    if (!dateFrom || !dateTo) return;
    async function load() {
      setLoading(true);
      var fromAll = [], toAll = [];

      // Page through results
      async function loadAll(date) {
        var rows = [], from = 0, step = 1000;
        while (true) {
          var r = await supabase
            .from('price_snapshots')
            .select('item_number, item_description, dept_code, dept_name, nos, qoh, inv_value, unit_price')
            .eq('regio', regio)
            .eq('snapshot_date', date)
            .range(from, from + step - 1);
          if (!r.data || !r.data.length) break;
          rows = rows.concat(r.data);
          if (r.data.length < step) break;
          from += step;
        }
        return rows;
      }

      var fromRows = await loadAll(dateFrom);
      var toRows = await loadAll(dateTo);

      setData({ from: fromRows, to: toRows });

      // Departements ophalen
      var deptMap = {};
      toRows.forEach(function(x) {
        if (x.dept_code) deptMap[x.dept_code] = x.dept_name || '';
      });
      fromRows.forEach(function(x) {
        if (x.dept_code && !deptMap[x.dept_code]) deptMap[x.dept_code] = x.dept_name || '';
      });
      var deptList = Object.keys(deptMap).map(function(k) { return { code: k, name: deptMap[k] }; });
      deptList.sort(function(a, b) { return a.code.localeCompare(b.code); });
      setDepts(deptList);

      setLoading(false);
    }
    load();
  }, [dateFrom, dateTo, regio]);

  // Compute price changes
  var changes = useMemo(function() {
    if (!data.from.length || !data.to.length) return [];

    var fromMap = {};
    data.from.forEach(function(x) { fromMap[x.item_number] = x; });

    var result = [];
    data.to.forEach(function(toItem) {
      var fromItem = fromMap[toItem.item_number];
      if (!fromItem) return; // alleen items die op beide datums voorkomen

      var fromPrice = parseFloat(fromItem.unit_price) || 0;
      var toPrice = parseFloat(toItem.unit_price) || 0;
      if (fromPrice <= 0 || toPrice <= 0) return;

      var diff = toPrice - fromPrice;
      var pct = (diff / fromPrice) * 100;

      result.push({
        item_number: toItem.item_number,
        item_description: toItem.item_description,
        dept_code: toItem.dept_code,
        dept_name: toItem.dept_name,
        nos: toItem.nos,
        qoh: toItem.qoh,
        from_price: fromPrice,
        to_price: toPrice,
        diff: diff,
        pct: pct,
      });
    });

    return result;
  }, [data]);

  var filtered = useMemo(function() {
    var f = changes;
    // Sluit items uit met minder dan 0.5% wijziging (afrondings-ruis)
    f = f.filter(function(x) { return Math.abs(x.pct) >= 0.5; });
    if (selDept !== 'all') f = f.filter(function(x) { return x.dept_code === selDept; });
    if (drempel > 0) f = f.filter(function(x) { return Math.abs(x.pct) >= drempel; });
    if (direction === 'up') f = f.filter(function(x) { return x.pct > 0; });
    if (direction === 'down') f = f.filter(function(x) { return x.pct < 0; });
    return f;
  }, [changes, selDept, drempel, direction]);

  var stats = useMemo(function() {
    var total = filtered.length;
    var up = filtered.filter(function(x) { return x.pct > 0; }).length;
    var down = filtered.filter(function(x) { return x.pct < 0; }).length;
    var avgUp = up > 0 ? filtered.filter(function(x) { return x.pct > 0; }).reduce(function(a, x) { return a + x.pct; }, 0) / up : 0;
    var avgDown = down > 0 ? filtered.filter(function(x) { return x.pct < 0; }).reduce(function(a, x) { return a + x.pct; }, 0) / down : 0;

    // Noemer: items op to-datum met geldige prijs (binnen huidige dept-filter)
    var totalToDate = data.to.filter(function(x) {
      if (selDept !== 'all' && x.dept_code !== selDept) return false;
      var p = parseFloat(x.unit_price) || 0;
      return p > 0;
    }).length;
    var pctOfTotal = totalToDate > 0 ? (total / totalToDate) * 100 : 0;

    return { total: total, up: up, down: down, avgUp: avgUp, avgDown: avgDown, totalToDate: totalToDate, pctOfTotal: pctOfTotal };
  }, [filtered, data, selDept]);

  // Sort op klikbare kolom-headers
  var sortedFiltered = useMemo(function() {
    var arr = filtered.slice();
    var dir = sortDir === 'asc' ? 1 : -1;
    arr.sort(function(a, b) {
      var va, vb;
      switch (sortCol) {
        case 'dept': va = a.dept_code || ''; vb = b.dept_code || ''; break;
        case 'item': va = a.item_number || ''; vb = b.item_number || ''; break;
        case 'desc': va = a.item_description || ''; vb = b.item_description || ''; break;
        case 'nos':  va = a.nos || ''; vb = b.nos || ''; break;
        case 'qoh':  va = parseFloat(a.qoh) || 0; vb = parseFloat(b.qoh) || 0; break;
        case 'from_price': va = a.from_price || 0; vb = b.from_price || 0; break;
        case 'to_price':   va = a.to_price || 0; vb = b.to_price || 0; break;
        case 'diff':       va = a.diff || 0; vb = b.diff || 0; break;
        case 'pct':        va = a.pct || 0; vb = b.pct || 0; break;
        case 'pct_abs':
        default:           va = Math.abs(a.pct || 0); vb = Math.abs(b.pct || 0); break;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortCol(col);
      // Numerieke kolommen default desc, tekst-kolommen default asc
      var numericCols = ['qoh', 'from_price', 'to_price', 'diff', 'pct', 'pct_abs'];
      setSortDir(numericCols.indexOf(col) !== -1 ? 'desc' : 'asc');
    }
  }

  if (loading) return <LoadingLogo text="Prijsdata laden..." />;

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Price Changes</h1>
          <p className="text-[13px] text-[#6b5240]">{'Prijsontwikkeling — ' + (regio === 'CUR' ? 'Curaçao' : 'Bonaire') + (dateFrom && dateTo ? ' — ' + fmtDate(dateFrom) + ' t/m ' + fmtDate(dateTo) : '')}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{regio === 'CUR' ? 'Curaçao · XCG' : 'Bonaire · USD'}</div>
      </div>

      {/* Filter block */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Regio</span>
          <div className="flex gap-1">
            <Pill label="Curaçao" active={regio === 'CUR'} onClick={function() { setRegio('CUR'); }} />
            <Pill label="Bonaire" active={regio === 'BON'} onClick={function() { setRegio('BON'); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Periode</span>
          <select value={dateFrom} onChange={function(e) { setDateFrom(e.target.value); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg">
            {availableDates.map(function(d) { return <option key={d} value={d}>{fmtDate(d)}</option>; })}
          </select>
          <span className="text-[11px] text-[#6b5240]">tot</span>
          <select value={dateTo} onChange={function(e) { setDateTo(e.target.value); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg">
            {availableDates.map(function(d) { return <option key={d} value={d}>{fmtDate(d)}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={selDept} onChange={function(e) { setSelDept(e.target.value); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle afdelingen</option>
            {depts.map(function(d) { return <option key={d.code} value={d.code}>{d.code + ' - ' + d.name}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Richting</span>
          <div className="flex gap-1">
            <Pill label="Alles" active={direction === 'all'} onClick={function() { setDirection('all'); }} />
            <Pill label="Gestegen" active={direction === 'up'} onClick={function() { setDirection('up'); }} />
            <Pill label="Gedaald" active={direction === 'down'} onClick={function() { setDirection('down'); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Drempel</span>
          <input
            type="range" min="0.5" max="50" step="0.5" value={Math.max(drempel, 0.5)}
            onChange={function(e) { setDrempel(parseFloat(e.target.value)); }}
            style={{ width: '200px' }}
          />
          <span className="text-[12px] font-mono text-[#1a0a04] min-w-[60px]">≥ {Math.max(drempel, 0.5).toFixed(1)}%</span>
          <span className="text-[11px] text-[#6b5240]">(verbergt kleinere wijzigingen — minimum 0,5%)</span>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-5">
        {[
          { label: 'Items met wijziging', value: fmt(stats.total), sub: 'van ' + fmt(stats.totalToDate) + ' totaal', color: '#1a0a04' },
          { label: '% van totaal', value: stats.totalToDate > 0 ? stats.pctOfTotal.toFixed(1) + '%' : '-', sub: selDept === 'all' ? 'binnen alle afdelingen' : 'binnen dept ' + selDept, color: '#E84E1B' },
          { label: 'Gestegen', value: fmt(stats.up), color: '#dc2626' },
          { label: 'Gedaald', value: fmt(stats.down), color: '#16a34a' },
          { label: 'Gem. stijging', value: stats.up > 0 ? fmtPct(stats.avgUp) : '-', color: '#dc2626' },
          { label: 'Gem. daling', value: stats.down > 0 ? fmtPct(stats.avgDown) : '-', color: '#16a34a' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
              <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[28px] font-semibold font-mono mt-1" style={{ color: k.color }}>{k.value}</p>
              {k.sub && <p className="text-[10px] text-[#a08a74] mt-0.5">{k.sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Excel export */}
      <div className="flex justify-end mb-3">
        <ExcelExportButton
          filename={(function() { var d = new Date(); var pad = function(n){return n<10?'0'+n:''+n;}; return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_price_changes_' + regio; })()}
          reportTitle={'Price Changes — ' + (regio === 'CUR' ? 'Curaçao' : 'Bonaire') + ' — ' + fmtDate(dateFrom) + ' t/m ' + fmtDate(dateTo)}
          sheets={function() {
            return [{
              name: 'Prijswijzigingen',
              rows: sortedFiltered.map(function(x) {
                var row = {
                  'Dept': x.dept_code,
                  'Departement': x.dept_name,
                  'Item Number': x.item_number,
                  'Omschrijving': x.item_description,
                  'NOS': x.nos || '',
                  'QOH': x.qoh,
                };
                row['Prijs ' + fmtDate(dateFrom)] = Math.round(x.from_price * 100) / 100;
                row['Prijs ' + fmtDate(dateTo)] = Math.round(x.to_price * 100) / 100;
                row['Verschil'] = Math.round(x.diff * 100) / 100;
                row['% Wijziging'] = Math.round(x.pct * 10) / 10;
                return row;
              }),
            }];
          }}
        />
      </div>

      {/* Table met sticky header in eigen scroll-container */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1100px' }}>
            <thead>
              <tr className="bg-[#1B3A5C]" style={{ position: 'sticky', top: 0, zIndex: 20 }}>
                <SortTh col="dept" current={sortCol} dir={sortDir} onClick={handleSort} align="left">Dept</SortTh>
                <SortTh col="item" current={sortCol} dir={sortDir} onClick={handleSort} align="left">Item</SortTh>
                <SortTh col="desc" current={sortCol} dir={sortDir} onClick={handleSort} align="left">Omschrijving</SortTh>
                <SortTh col="nos"  current={sortCol} dir={sortDir} onClick={handleSort} align="center">NOS</SortTh>
                <SortTh col="qoh"  current={sortCol} dir={sortDir} onClick={handleSort} align="right">QOH</SortTh>
                <SortTh col="from_price" current={sortCol} dir={sortDir} onClick={handleSort} align="right">{'Prijs ' + fmtDate(dateFrom)}</SortTh>
                <SortTh col="to_price"   current={sortCol} dir={sortDir} onClick={handleSort} align="right">{'Prijs ' + fmtDate(dateTo)}</SortTh>
                <SortTh col="diff" current={sortCol} dir={sortDir} onClick={handleSort} align="right">Verschil</SortTh>
                <SortTh col="pct"  current={sortCol} dir={sortDir} onClick={handleSort} align="right">% Wijziging</SortTh>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-[#6b5240]">Geen items die aan de filters voldoen.</td></tr>
              )}
              {sortedFiltered.map(function(x, i) {
                var color = x.pct > 0 ? '#dc2626' : x.pct < 0 ? '#16a34a' : '#6b5240';
                return (
                  <tr key={x.item_number + '|' + i} className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0]'}>
                    <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{x.dept_code}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-mono">{x.item_number}</td>
                    <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[260px]" title={x.item_description}>{x.item_description}</td>
                    <td className="p-2 text-center text-[11px] border-b border-[#f0ebe5]">{x.nos || '-'}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(x.qoh)}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmtPrice(x.from_price)}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmtPrice(x.to_price)}</td>
                    <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: color }}>{fmtPrice(x.diff)}</td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b border-[#f0ebe5]" style={{ color: color }}>{fmtPct(x.pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer info */}
      <div className="bg-[#faf7f4] rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm">
        <p className="text-[11px] text-[#6b5240] leading-relaxed">
          <b>Over deze data:</b> Dit rapport toont prijsontwikkeling van artikelen waarvan de laatste verkoopdatum ná 1 januari 2025 ligt.
          De prijs per stuk wordt berekend als <code className="font-mono text-[#1a0a04]">inventory_value ÷ qoh</code>.
          Items zonder voorraad in een bepaalde periode komen niet voor in dat datapunt.
          De vergelijking toont alleen items die in BEIDE gekozen datums een geldige prijs hebben.
          Wijzigingen kleiner dan <b>0,5%</b> worden gezien als afrondings-ruis en niet meegeteld.
        </p>
      </div>
    </div>
  );
}
