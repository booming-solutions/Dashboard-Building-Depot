/* ============================================================
   BESTAND: page_negative_inventory_v10.js
   KOPIEER NAAR: src/app/dashboard/inventory/negative/page.js
   (hernoem naar page.js bij het plaatsen)
   VERSIE: v3.28.14
   
   Wijzigingen t.o.v. v9:
   - Excel-export knop toegevoegd via gedeelde ExcelExportButton component
   - Bevat overzicht per dept én detail (huidige filters worden meegenomen)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';
import { Chart, CategoryScale, LinearScale, LineElement, PointElement, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, LineElement, PointElement, LineController, Tooltip, Legend, Filler);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : (a / 1e3).toFixed(0) + 'K'); };
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

function fmtDate(d) {
  if (!d) return '';
  var p = String(d).split('-');
  if (p.length !== 3) return d;
  return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + " '" + p[0].slice(2);
}
function fmtDateFull(d) {
  if (!d) return '';
  var p = String(d).split('-');
  if (p.length !== 3) return d;
  return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + ' ' + p[0];
}
function fmtDateTime(d) {
  if (!d) return '';
  var dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function daysSince(d) {
  if (!d) return null;
  var ms = new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000);
}
function regionOf(storeNumber) {
  var s = String(storeNumber || '').trim().toUpperCase();
  if (s === 'A' || s === 'B') return 'Bonaire';
  return 'Curacao';
}

function Pill({ label, active, onClick }) {
  return (
    <button
      className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' +
        (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-[#a08a74] text-[11px]">—</span>;
  if (status === 'in_onderzoek') return <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-[10px] font-semibold">In onderzoek</span>;
  if (status === 'opgelost') return <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-[10px] font-semibold">Opgelost</span>;
  return <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-semibold">{status}</span>;
}

export default function NegativeInventoryPage() {
  var _s = useState;
  var _items = _s([]), items = _items[0], setItems = _items[1];
  var _notes = _s([]), notes = _notes[0], setNotes = _notes[1];
  var _snap = _s([]), snapshots = _snap[0], setSnapshots = _snap[1];
  var _fs = _s({}), firstSeen = _fs[0], setFirstSeen = _fs[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _me = _s({ email: '', name: '' }), me = _me[0], setMe = _me[1];

  // Filters
  var _store = _s('Curacao'), store = _store[0], setStore = _store[1];     // default Curacao
  var _bum = _s('all'), selBum = _bum[0], setSelBum = _bum[1];
  var _dept = _s('__total__'), selDept = _dept[0], setSelDept = _dept[1];

  // View
  var _vw = _s('overview'), view = _vw[0], setView = _vw[1];           // 'overview' | 'detail'

  // Overview extras
  var _grp = _s('dept'), groupBy = _grp[0], setGroupBy = _grp[1];       // 'dept' | 'bum'
  var _ovsc = _s('code'), ovSortCol = _ovsc[0], setOvSortCol = _ovsc[1]; // 'code' | 'name' | 'bum' | 'items' | 'value'
  var _ovsd = _s('asc'), ovSortDir = _ovsd[0], setOvSortDir = _ovsd[1];

  // Detail-tab
  var _search = _s(''), search = _search[0], setSearch = _search[1];
  var _hide = _s(false), hideResolved = _hide[0], setHideResolved = _hide[1];
  var _qtyFilter = _s(false), qtyFilter = _qtyFilter[0], setQtyFilter = _qtyFilter[1];   // aantal < -5
  var _valFilter = _s(false), valFilter = _valFilter[0], setValFilter = _valFilter[1];   // waarde < -500
  var _sc = _s('inv_value'), sortCol = _sc[0], setSortCol = _sc[1];
  var _sd = _s('asc'), sortDir = _sd[0], setSortDir = _sd[1];

  // Inline edit
  var _in = _s({}), inlineNote = _in[0], setInlineNote = _in[1];
  var _is = _s({}), inlineStatus = _is[0], setInlineStatus = _is[1];
  var _sv = _s(null), savingRow = _sv[0], setSavingRow = _sv[1];

  // Modal
  var _hist = _s(null), historyItem = _hist[0], setHistoryItem = _hist[1];

  // Chart
  var trendRef = useRef(null);
  var chartRef = useRef(null);

  var supabase = createClient();
  useEffect(function() { loadAll(); }, []);

  async function loadAll() {
    var session = (await supabase.auth.getSession()).data.session;
    if (session) {
      var prof = (await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()).data;
      setMe({ email: session.user.email, name: prof?.full_name || prof?.name || session.user.email });
    }
    await Promise.all([loadItems(), loadNotes(), loadSnapshots(), loadFirstSeen()]);
    setLoading(false);
  }

  async function loadItems() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('negative_inventory').select('*').lt('qty_on_hand', 0).range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setItems(all);
  }

  async function loadNotes() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('negative_inventory_notes').select('*').order('created_at', { ascending: false }).range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setNotes(all);
  }

  async function loadSnapshots() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('negative_inventory_snapshots').select('*').order('snapshot_date', { ascending: true }).range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setSnapshots(all);
  }

  async function loadFirstSeen() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('negative_inventory_first_seen').select('*').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    var map = {};
    all.forEach(function(x) { map[x.item_number] = x; });
    setFirstSeen(map);
  }

  /* ── Notes map ── */
  var notesByKey = useMemo(function() {
    var m = {};
    notes.forEach(function(n) {
      var k = n.store_number + '|' + n.item_number;
      if (!m[k]) m[k] = [];
      m[k].push(n);
    });
    Object.keys(m).forEach(function(k) {
      m[k].sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    });
    return m;
  }, [notes]);

  function latestStatusFor(storeNumber, itemNumber) {
    var a = notesByKey[storeNumber + '|' + itemNumber] || [];
    return a[0]?.status || null;
  }

  /* ── Apply global filters ── */
  function matchFilters(it) {
    if (store === 'Curacao' && regionOf(it.store_number) !== 'Curacao') return false;
    if (store === 'Bonaire' && regionOf(it.store_number) !== 'Bonaire') return false;
    if (selBum !== 'all' && (it.bum || '').toUpperCase() !== selBum.toUpperCase()) return false;
    if (selDept !== '__total__' && it.dept_code !== selDept) return false;
    if (qtyFilter && (it.qty_on_hand || 0) >= -5) return false;
    if (valFilter && (it.inv_value || 0) >= -500) return false;
    return true;
  }
  var filteredItems = useMemo(function() { return items.filter(matchFilters); }, [items, store, selBum, selDept, qtyFilter, valFilter]);

  /* ── Filter options ── */
  var bums = useMemo(function() {
    var s = {};
    items.forEach(function(it) {
      if (store === 'Curacao' && regionOf(it.store_number) !== 'Curacao') return;
      if (store === 'Bonaire' && regionOf(it.store_number) !== 'Bonaire') return;
      if (it.bum) s[it.bum.toUpperCase()] = true;
    });
    var l = Object.keys(s);
    l.sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a), bi = BU_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return l;
  }, [items, store]);

  var departments = useMemo(function() {
    var m = {};
    items.forEach(function(it) {
      if (store === 'Curacao' && regionOf(it.store_number) !== 'Curacao') return;
      if (store === 'Bonaire' && regionOf(it.store_number) !== 'Bonaire') return;
      if (selBum !== 'all' && (it.bum || '').toUpperCase() !== selBum.toUpperCase()) return;
      if (qtyFilter && (it.qty_on_hand || 0) >= -5) return;
      if (valFilter && (it.inv_value || 0) >= -500) return;
      var code = it.dept_code;
      if (!m[code]) m[code] = { deptCode: code, deptName: it.dept_name, items: 0, value: 0, bumSet: {} };
      m[code].items += 1;
      m[code].value += parseFloat(it.inv_value) || 0;
      if (it.bum) m[code].bumSet[it.bum.toUpperCase()] = true;
    });
    var arr = Object.values(m).map(function(d) {
      d.bum = Object.keys(d.bumSet).sort().join(', ');
      delete d.bumSet;
      return d;
    });
    arr.sort(function(a, b) {
      if (a.deptCode === 'OTHER') return 1;
      if (b.deptCode === 'OTHER') return -1;
      return (parseInt(a.deptCode) || 999) - (parseInt(b.deptCode) || 999);
    });
    return arr;
  }, [items, store, selBum, qtyFilter, valFilter]);

  /* ── BUM groups (for "per BUM" view) ── */
  var bumGroups = useMemo(function() {
    var m = {};
    items.forEach(function(it) {
      if (store === 'Curacao' && regionOf(it.store_number) !== 'Curacao') return;
      if (store === 'Bonaire' && regionOf(it.store_number) !== 'Bonaire') return;
      if (selBum !== 'all' && (it.bum || '').toUpperCase() !== selBum.toUpperCase()) return;
      if (qtyFilter && (it.qty_on_hand || 0) >= -5) return;
      if (valFilter && (it.inv_value || 0) >= -500) return;
      var b = (it.bum || '—').toUpperCase();
      if (!m[b]) m[b] = { bum: b, items: 0, value: 0, deptSet: {} };
      m[b].items += 1;
      m[b].value += parseFloat(it.inv_value) || 0;
      if (it.dept_code) m[b].deptSet[it.dept_code] = true;
    });
    var arr = Object.values(m).map(function(g) {
      g.deptCount = Object.keys(g.deptSet).length;
      delete g.deptSet;
      return g;
    });
    arr.sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a.bum), bi = BU_ORDER.indexOf(b.bum);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.bum.localeCompare(b.bum);
    });
    return arr;
  }, [items, store, selBum, qtyFilter, valFilter]);

  /* ── Sorted rows for Overview tab ── */
  var overviewRows = useMemo(function() {
    var base = groupBy === 'bum' ? bumGroups.slice() : departments.slice();
    var dir = ovSortDir === 'asc' ? 1 : -1;
    base.sort(function(a, b) {
      var va, vb;
      if (groupBy === 'bum') {
        switch (ovSortCol) {
          case 'bum': va = a.bum; vb = b.bum; break;
          case 'items': va = a.items; vb = b.items; break;
          case 'value': va = a.value; vb = b.value; break;
          case 'name':
          case 'code':
          default:
            // "code" for BUMs = bum name
            va = a.bum; vb = b.bum; break;
        }
      } else {
        switch (ovSortCol) {
          case 'name': va = a.deptName || ''; vb = b.deptName || ''; break;
          case 'bum': va = a.bum || ''; vb = b.bum || ''; break;
          case 'items': va = a.items; vb = b.items; break;
          case 'value': va = a.value; vb = b.value; break;
          case 'code':
          default: {
            // Numeric sort, OTHER at bottom
            if (a.deptCode === 'OTHER') return 1 * dir;
            if (b.deptCode === 'OTHER') return -1 * dir;
            return ((parseInt(a.deptCode) || 999) - (parseInt(b.deptCode) || 999)) * dir;
          }
        }
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return base;
  }, [departments, bumGroups, groupBy, ovSortCol, ovSortDir]);

  function handleOvSort(col) {
    if (ovSortCol === col) setOvSortDir(ovSortDir === 'asc' ? 'desc' : 'asc');
    else {
      setOvSortCol(col);
      // Value/items usually descending first
      setOvSortDir((col === 'value' || col === 'items') ? 'desc' : 'asc');
    }
  }

  /* ── KPI totals ── */
  var totals = useMemo(function() {
    var src = departments;
    if (selDept !== '__total__') src = departments.filter(function(d) { return d.deptCode === selDept; });
    var t = { items: 0, value: 0, depts: src.length };
    src.forEach(function(d) { t.items += d.items; t.value += d.value; });
    return t;
  }, [departments, selDept]);

  /* ── Trend (snapshots over time) ── */
  var trendData = useMemo(function() {
    var byDate = {};
    snapshots.forEach(function(s) {
      if (store === 'Curacao' && s.region !== 'Curacao') return;
      if (store === 'Bonaire' && s.region !== 'Bonaire') return;
      if (selDept !== '__total__' && s.department_code !== selDept) return;
      var d = s.snapshot_date;
      if (!byDate[d]) byDate[d] = { date: d, items: 0, value: 0 };
      byDate[d].items += s.items_count || 0;
      byDate[d].value += parseFloat(s.total_negative_value) || 0;
    });
    return Object.values(byDate)
      .map(function(d) { return { date: d.date, items: d.items, value: Math.round(d.value) }; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
  }, [snapshots, store, selDept]);

  /* ── Render trend chart ── */
  useEffect(function() {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    if (view !== 'overview' || trendData.length < 2 || !trendRef.current) return;
    var raf = requestAnimationFrame(function() {
      if (!trendRef.current) return;
      chartRef.current = new Chart(trendRef.current, {
        type: 'line',
        data: {
          labels: trendData.map(function(d) { return fmtDate(d.date); }),
          datasets: [
            {
              label: 'Aantal items',
              yAxisID: 'y1',
              data: trendData.map(function(d) { return d.items; }),
              borderColor: '#1B3A5C',
              backgroundColor: 'rgba(27,58,92,0.06)',
              pointBackgroundColor: '#1B3A5C',
              pointRadius: 4,
              tension: 0.25,
              fill: false,
              borderWidth: 2,
            },
            {
              label: 'Waarde (XCG)',
              yAxisID: 'y2',
              data: trendData.map(function(d) { return d.value; }),
              borderColor: '#E84E1B',
              backgroundColor: 'rgba(232,78,27,0.08)',
              pointBackgroundColor: '#E84E1B',
              pointRadius: 4,
              tension: 0.25,
              fill: true,
              borderWidth: 2.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } },
            tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + fmt(Math.round(c.raw)); } } },
          },
          scales: {
            y1: { type: 'linear', position: 'left', ticks: { callback: function(v) { return fmt(v); } }, grid: { color: '#f0ebe5' } },
            y2: { type: 'linear', position: 'right', ticks: { callback: function(v) { return fmtK(v); } }, grid: { display: false } },
            x: { grid: { display: false } },
          },
        },
      });
    });
    return function() { cancelAnimationFrame(raf); };
  }, [trendData, view]);

  /* ── Detail items (sorted + searched) ── */
  var detailItems = useMemo(function() {
    var arr = filteredItems.slice();
    if (hideResolved) {
      arr = arr.filter(function(it) { return latestStatusFor(it.store_number, it.item_number) !== 'opgelost'; });
    }
    if (search.trim()) {
      var q = search.trim().toLowerCase();
      arr = arr.filter(function(it) {
        return (it.item_number || '').toLowerCase().includes(q) ||
               (it.item_description || '').toLowerCase().includes(q) ||
               (it.dept_name || '').toLowerCase().includes(q);
      });
    }
    var dir = sortDir === 'asc' ? 1 : -1;
    arr.sort(function(a, b) {
      var va, vb;
      switch (sortCol) {
        case 'store': va = a.store_number; vb = b.store_number; break;
        case 'dept': va = a.dept_code; vb = b.dept_code; break;
        case 'bum': va = a.bum || ''; vb = b.bum || ''; break;
        case 'item': va = a.item_number; vb = b.item_number; break;
        case 'desc': va = a.item_description || ''; vb = b.item_description || ''; break;
        case 'qty_on_hand': va = a.qty_on_hand || 0; vb = b.qty_on_hand || 0; break;
        case 'inv_value': va = a.inv_value || 0; vb = b.inv_value || 0; break;
        case 'firstSeen': {
          va = firstSeen[a.item_number]?.first_seen_date || '9999-12-31';
          vb = firstSeen[b.item_number]?.first_seen_date || '9999-12-31';
          break;
        }
        case 'status': {
          va = latestStatusFor(a.store_number, a.item_number) || 'zzz';
          vb = latestStatusFor(b.store_number, b.item_number) || 'zzz';
          break;
        }
        default: va = a.inv_value || 0; vb = b.inv_value || 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [filteredItems, search, hideResolved, sortCol, sortDir, notesByKey, firstSeen]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  /* ── Detail totals (reageren op alle filters inclusief search/hideResolved/qtyFilter/valFilter) ── */
  var detailTotals = useMemo(function() {
    var t = { items: 0, value: 0, qty: 0 };
    detailItems.forEach(function(it) {
      t.items += 1;
      t.value += parseFloat(it.inv_value) || 0;
      t.qty += parseFloat(it.qty_on_hand) || 0;
    });
    return t;
  }, [detailItems]);

  async function handleSaveInline(it) {
    var txt = (inlineNote[it.id] || '').trim();
    if (!txt) return;
    var status = inlineStatus[it.id] || 'in_onderzoek';
    setSavingRow(it.id);
    var row = {
      store_number: it.store_number,
      item_number: it.item_number,
      item_description: it.item_description,
      department_code: it.dept_code,
      department_name: it.dept_name,
      note: txt,
      status: status,
      created_by_email: me.email,
      created_by_name: me.name,
    };
    var r = await supabase.from('negative_inventory_notes').insert(row);
    if (r.error) alert('Opslaan mislukt: ' + r.error.message);
    else {
      setInlineNote(Object.assign({}, inlineNote, { [it.id]: '' }));
      await loadNotes();
    }
    setSavingRow(null);
  }

  if (loading) return <LoadingLogo text="Negatieve voorraad laden..." />;

  var latestSnapshotDate = snapshots.length
    ? snapshots.reduce(function(max, s) { return s.snapshot_date > max ? s.snapshot_date : max; }, snapshots[0].snapshot_date)
    : null;

  var storeName = store === 'all' ? 'Totaal' : store === 'Curacao' ? 'Curaçao' : 'Bonaire';
  var dateLabel = latestSnapshotDate ? fmtDateFull(latestSnapshotDate) : '';

  return (
    <div className="max-w-[1600px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Negatieve Voorraad</h1>
          <p className="text-[13px] text-[#6b5240]">{'Building Depot — ' + storeName + (dateLabel ? ' — data t/m ' + dateLabel : '')}</p>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeName + ' · XCG'}</div>
      </div>

      {/* Filter block */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">
            <Pill label="Totaal" active={store === 'all'} onClick={function() { setStore('all'); setSelBum('all'); setSelDept('__total__'); }} />
            <Pill label="Curaçao" active={store === 'Curacao'} onClick={function() { setStore('Curacao'); setSelBum('all'); setSelDept('__total__'); }} />
            <Pill label="Bonaire" active={store === 'Bonaire'} onClick={function() { setStore('Bonaire'); setSelBum('all'); setSelDept('__total__'); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={selBum === 'all'} onClick={function() { setSelBum('all'); setSelDept('__total__'); }} />
            {bums.map(function(b) { return <Pill key={b} label={b} active={selBum === b} onClick={function() { setSelBum(b); setSelDept('__total__'); }} />; })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select
            value={selDept}
            onChange={function(e) { setSelDept(e.target.value); }}
            className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]"
          >
            <option value="__total__">{selBum !== 'all' ? 'Totaal ' + selBum : 'Totaal alle departementen'}</option>
            {departments.map(function(d) { return <option key={d.deptCode} value={d.deptCode}>{d.deptCode + ' - ' + d.deptName}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Drempel</span>
          <div className="flex gap-1">
            <Pill label="Aantal < -5" active={qtyFilter} onClick={function() { setQtyFilter(!qtyFilter); }} />
            <Pill label="Waarde < -500" active={valFilter} onClick={function() { setValFilter(!valFilter); }} />
          </div>
        </div>
      </div>

      {/* View tabs + export */}
      <div className="flex items-center justify-between mb-5 border-b-2 border-[#e5ddd4]">
        <div className="flex gap-1">
          {[['overview', 'Overzicht'], ['detail', 'Detail']].map(function(item) {
            return (
              <button
                key={item[0]}
                onClick={function() { setView(item[0]); }}
                className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' +
                  (view === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}
              >
                {item[1]}
              </button>
            );
          })}
        </div>
        <ExcelExportButton
          filename={(function() { var d = new Date(); var pad = function(n){return n<10?'0'+n:''+n;}; return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_negatieve_voorraad_' + (selBum !== 'all' ? selBum : 'alle') + '_' + store.replace(/[ç]/g,'c'); })()}
          reportTitle={'Negatieve Voorraad — ' + (selBum !== 'all' ? selBum + ' — ' : '') + store}
          sheets={function() {
            return [
              {
                name: 'Per Afdeling',
                rows: departments.map(function(d) {
                  return {
                    'Dept': d.deptCode,
                    'Departement': d.deptName,
                    'BUM': d.bum,
                    'Aantal items': d.items,
                    'Negatieve waarde (XCG)': Math.round(d.value),
                  };
                }),
              },
              {
                name: 'Detail',
                rows: detailItems.map(function(it) {
                  return {
                    'Dept': it.dept_code,
                    'Departement': it.dept_name,
                    'BUM': it.bum || '',
                    'Item': it.item_number,
                    'Omschrijving': it.item_description,
                    'Store': it.store_number,
                    'QOH': it.qty_on_hand,
                    'Waarde (XCG)': Math.round(it.inv_value || 0),
                    'Eerste neg.': it.first_seen_date || '',
                    'Status': it.status || '',
                    'Laatste opmerking': (it.notes && it.notes[0]) ? it.notes[0].note : '',
                    'Door': (it.notes && it.notes[0]) ? (it.notes[0].created_by_name || it.notes[0].created_by_email) : '',
                    'Datum opmerking': (it.notes && it.notes[0]) ? it.notes[0].created_at : '',
                  };
                }),
              },
            ];
          }}
        />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Aantal items', value: fmt(totals.items), tooltip: '' },
          { label: 'Waarde negatief', value: fmtK(totals.value), tooltip: fmt(Math.round(totals.value)), color: '#dc2626' },
          { label: 'Departementen', value: fmt(totals.depts), tooltip: '' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm" title={k.tooltip || ''}>
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"></div>
              <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[28px] font-semibold font-mono mt-1" style={{ color: k.color || '#1a0a04' }}>{k.value}</p>
              {k.tooltip && <p className="text-[11px] text-[#a08a74] font-mono mt-0.5">{k.tooltip}</p>}
            </div>
          );
        })}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {view === 'overview' && (
        <div className="space-y-5 mb-8">
          {/* Trend chart */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[15px] font-bold">Verloop in de tijd</h3>
                <p className="text-[12px] text-[#6b5240]">
                  {selDept !== '__total__' ? 'Departement ' + selDept : (selBum !== 'all' ? 'Manager ' + selBum : storeName)}
                </p>
              </div>
            </div>
            {trendData.length === 0 && <p className="text-[12px] text-[#6b5240] py-8 text-center">Nog geen snapshots beschikbaar.</p>}
            {trendData.length === 1 && (
              <div className="py-6 text-center bg-[#faf7f4] rounded-lg">
                <p className="text-[12px] text-[#6b5240]">Eerste snapshot: {fmtDateFull(trendData[0].date)}</p>
                <p className="text-[13px] mt-1">{fmt(trendData[0].items)} items · <span style={{ color: '#dc2626' }}>{fmt(trendData[0].value)} XCG</span></p>
                <p className="text-[10px] text-[#a08a74] mt-2 italic">Grafiek verschijnt zodra er meer snapshots zijn.</p>
              </div>
            )}
            {trendData.length >= 2 && (
              <div style={{ height: '320px' }}>
                <canvas ref={trendRef}></canvas>
              </div>
            )}
          </div>

          {/* Per department / per BUM table */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5ddd4]">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px]">Groepeer op</span>
                <div className="flex gap-1">
                  <Pill label="Departement" active={groupBy === 'dept'} onClick={function() { setGroupBy('dept'); setOvSortCol('code'); setOvSortDir('asc'); }} />
                  <Pill label="Manager (BUM)" active={groupBy === 'bum'} onClick={function() { setGroupBy('bum'); setOvSortCol('bum'); setOvSortDir('asc'); }} />
                </div>
              </div>
              <span className="text-[11px] text-[#a08a74]">
                {latestSnapshotDate ? 'Data t/m ' + fmtDate(latestSnapshotDate) : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" style={{ minWidth: '700px' }}>
                <thead>
                  <tr className="bg-[#1B3A5C]">
                    {groupBy === 'dept' ? (
                      <th colSpan={5} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">Per departement</th>
                    ) : (
                      <th colSpan={3} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">Per manager</th>
                    )}
                  </tr>
                  <tr className="bg-[#f0ebe5]">
                    {groupBy === 'dept' ? (
                      <>
                        <OvSortableTh col="code" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} w="70px">Dep</OvSortableTh>
                        <OvSortableTh col="name" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort}>Departement</OvSortableTh>
                        <OvSortableTh col="bum" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} w="120px">Manager</OvSortableTh>
                        <OvSortableTh col="items" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} align="right" w="130px">Aantal items</OvSortableTh>
                        <OvSortableTh col="value" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} align="right" w="160px">Waarde (XCG)</OvSortableTh>
                      </>
                    ) : (
                      <>
                        <OvSortableTh col="bum" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} w="180px">Manager</OvSortableTh>
                        <OvSortableTh col="items" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} align="right" w="150px">Aantal items</OvSortableTh>
                        <OvSortableTh col="value" current={ovSortCol} dir={ovSortDir} onClick={handleOvSort} align="right" w="180px">Waarde (XCG)</OvSortableTh>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-[#faf7f4]">
                    {groupBy === 'dept' ? (
                      <>
                        <td colSpan={3} className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3]">TOTAAL</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(totals.items)}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#dc2626' }}>{fmt(Math.round(totals.value))}</td>
                      </>
                    ) : (
                      <>
                        <td className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3]">TOTAAL</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(totals.items)}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#dc2626' }}>{fmt(Math.round(totals.value))}</td>
                      </>
                    )}
                  </tr>
                  {overviewRows.length === 0 && (
                    <tr><td colSpan={groupBy === 'dept' ? 5 : 3} className="p-6 text-center text-[#6b5240]">Geen negatieve voorraad binnen de filters.</td></tr>
                  )}
                  {groupBy === 'dept' && overviewRows.map(function(d, i) {
                    return (
                      <tr
                        key={d.deptCode}
                        className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'}
                        onClick={function() { setSelDept(d.deptCode); setView('detail'); }}
                      >
                        <td className="p-2 text-[12px] text-[#6b5240] border-b border-[#f0ebe5] font-mono">{d.deptCode}</td>
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[280px]" title={d.deptName}>{d.deptName}</td>
                        <td className="p-2 text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{d.bum || '—'}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(d.items)}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: '#dc2626' }}>{fmt(Math.round(d.value))}</td>
                      </tr>
                    );
                  })}
                  {groupBy === 'bum' && overviewRows.map(function(g, i) {
                    return (
                      <tr
                        key={g.bum}
                        className={(i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]') + ' hover:bg-[#faf5f0] cursor-pointer'}
                        onClick={function() { if (g.bum !== '—') setSelBum(g.bum); setView('detail'); }}
                      >
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-semibold">{g.bum}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]">{fmt(g.items)}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: '#dc2626' }}>{fmt(Math.round(g.value))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DETAIL ═══ */}
      {view === 'detail' && (
        <div className="space-y-5 mb-8">
          {/* Detail filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Zoek op itemnummer of omschrijving..."
              value={search}
              onChange={function(e) { setSearch(e.target.value); }}
              className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[280px]"
            />
            <label className="flex items-center gap-2 text-[12px] text-[#6b5240]">
              <input type="checkbox" checked={hideResolved} onChange={function(e) { setHideResolved(e.target.checked); }} />
              Verberg opgeloste items
            </label>
            <div className="ml-auto text-[11px] text-[#a08a74]">
              {fmt(detailItems.length)} van {fmt(filteredItems.length)} items
            </div>
          </div>

          {/* Detail table */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1400px' }}>
                <thead>
                  <tr className="bg-[#1B3A5C]">
                    <th colSpan={11} className="text-center text-white text-[10px] font-bold uppercase tracking-wider py-2">Items met negatieve voorraad</th>
                  </tr>
                  <tr className="bg-[#f0ebe5]">
                    <SortableTh col="store" current={sortCol} dir={sortDir} onClick={handleSort} w="60px">Store</SortableTh>
                    <SortableTh col="dept" current={sortCol} dir={sortDir} onClick={handleSort} w="60px">Dep</SortableTh>
                    <SortableTh col="bum" current={sortCol} dir={sortDir} onClick={handleSort} w="80px">Mgr</SortableTh>
                    <SortableTh col="item" current={sortCol} dir={sortDir} onClick={handleSort} w="120px">Item</SortableTh>
                    <SortableTh col="desc" current={sortCol} dir={sortDir} onClick={handleSort}>Omschrijving</SortableTh>
                    <SortableTh col="qty_on_hand" current={sortCol} dir={sortDir} onClick={handleSort} align="right" w="70px">Aantal</SortableTh>
                    <SortableTh col="inv_value" current={sortCol} dir={sortDir} onClick={handleSort} align="right" w="110px">Waarde</SortableTh>
                    <SortableTh col="firstSeen" current={sortCol} dir={sortDir} onClick={handleSort} w="110px">Eerste neg</SortableTh>
                    <SortableTh col="status" current={sortCol} dir={sortDir} onClick={handleSort} w="110px">Status</SortableTh>
                    <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ width: '280px' }}>Opmerking</th>
                    <th className="text-left p-2 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]" style={{ width: '90px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {detailItems.length === 0 && (
                    <tr><td colSpan={11} className="p-6 text-center text-[#6b5240]">Geen items die aan de filters voldoen.</td></tr>
                  )}
                  {detailItems.map(function(it, i) {
                    var itemNotes = notesByKey[it.store_number + '|' + it.item_number] || [];
                    var status = latestStatusFor(it.store_number, it.item_number);
                    var fs = firstSeen[it.item_number];
                    var days = fs ? daysSince(fs.first_seen_date) : null;
                    var rowBg = i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]';
                    return (
                      <tr key={it.id} className={rowBg + ' align-top'}>
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-mono">{it.store_number}</td>
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-mono text-[#6b5240]">{it.dept_code}</td>
                        <td className="p-2 text-[11px] border-b border-[#f0ebe5] text-[#6b5240]">{it.bum || ''}</td>
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] font-mono">{it.item_number}</td>
                        <td className="p-2 text-[12px] border-b border-[#f0ebe5] truncate max-w-[280px]" title={it.item_description}>{it.item_description}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: '#dc2626' }}>{fmt(it.qty_on_hand)}</td>
                        <td className="p-2 text-right font-mono text-[12px] border-b border-[#f0ebe5]" style={{ color: '#dc2626' }}>{fmt(Math.round(it.inv_value))}</td>
                        <td className="p-2 text-[11px] border-b border-[#f0ebe5]">
                          {fs ? (
                            <>
                              {fmtDate(fs.first_seen_date)}
                              {days !== null && days > 0 && <div className="text-[10px] text-[#a08a74]">{days} dagen</div>}
                            </>
                          ) : '—'}
                        </td>
                        <td className="p-2 border-b border-[#f0ebe5]"><StatusBadge status={status} /></td>
                        <td className="p-2 border-b border-[#f0ebe5]">
                          <div className="flex flex-col gap-1.5">
                            {itemNotes.length > 0 && (
                              <div className="bg-[#faf7f4] border border-[#e5ddd4] rounded px-2 py-1.5">
                                <div className="text-[9px] text-[#6b5240] flex items-center gap-1.5">
                                  <span className="font-semibold text-[#1a0a04]">{itemNotes[0].created_by_name || itemNotes[0].created_by_email}</span>
                                  <span className="text-[#a08a74]">·</span>
                                  <span>{fmtDate(itemNotes[0].created_at)}</span>
                                </div>
                                <div className="text-[11px] text-[#1a0a04] mt-0.5 leading-tight" style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  wordBreak: 'break-word',
                                }} title={itemNotes[0].note}>
                                  {itemNotes[0].note}
                                </div>
                              </div>
                            )}
                            <input
                              type="text"
                              placeholder={itemNotes.length > 0 ? 'Nieuwe opmerking toevoegen...' : 'Nieuwe opmerking...'}
                              value={inlineNote[it.id] || ''}
                              onChange={function(e) { setInlineNote(Object.assign({}, inlineNote, { [it.id]: e.target.value })); }}
                              onKeyDown={function(e) { if (e.key === 'Enter') handleSaveInline(it); }}
                              className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[11px] px-2 py-1 rounded w-full"
                            />
                            <div className="flex gap-1">
                              <select
                                value={inlineStatus[it.id] || 'in_onderzoek'}
                                onChange={function(e) { setInlineStatus(Object.assign({}, inlineStatus, { [it.id]: e.target.value })); }}
                                className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[10px] px-1 py-0.5 rounded"
                              >
                                <option value="in_onderzoek">In onderzoek</option>
                                <option value="opgelost">Opgelost</option>
                              </select>
                              <button
                                onClick={function() { handleSaveInline(it); }}
                                disabled={savingRow === it.id || !(inlineNote[it.id] || '').trim()}
                                className={'px-2 py-0.5 text-[10px] font-semibold rounded ' +
                                  ((savingRow === it.id || !(inlineNote[it.id] || '').trim())
                                    ? 'bg-[#e5ddd4] text-[#a08a74] cursor-not-allowed'
                                    : 'bg-[#E84E1B] text-white hover:bg-[#d63f10]')}
                              >
                                {savingRow === it.id ? '...' : 'Opslaan'}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 border-b border-[#f0ebe5]">
                          <button
                            onClick={function() { setHistoryItem(it); }}
                            className="px-2 py-1 text-[10px] font-semibold rounded border border-[#1B3A5C] text-[#1B3A5C] bg-white hover:bg-[#1B3A5C] hover:text-white"
                          >
                            Historie {itemNotes.length > 0 ? '(' + itemNotes.length + ')' : ''}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyItem && (
        <HistoryModal
          item={historyItem}
          notes={notesByKey[historyItem.store_number + '|' + historyItem.item_number] || []}
          firstSeen={firstSeen[historyItem.item_number]}
          onClose={function() { setHistoryItem(null); }}
        />
      )}
    </div>
  );
}

/* ── Sortable table header (detail) ── */
function SortableTh({ col, current, dir, onClick, children, align, w }) {
  var isActive = current === col;
  var arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={function() { onClick(col); }}
      style={{ width: w || 'auto', textAlign: align || 'left', cursor: 'pointer', userSelect: 'none' }}
      className={'p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4] ' +
        (isActive ? 'text-[#E84E1B]' : 'text-[#6b5240]')}
    >
      {children}{arrow}
    </th>
  );
}

/* ── Sortable table header (overview) ── */
function OvSortableTh({ col, current, dir, onClick, children, align, w }) {
  var isActive = current === col;
  var arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={function() { onClick(col); }}
      style={{ width: w || 'auto', textAlign: align || 'left', cursor: 'pointer', userSelect: 'none' }}
      className={'p-2 text-[10px] font-bold uppercase border-b-2 border-[#e5ddd4] ' +
        (isActive ? 'text-[#E84E1B]' : 'text-[#6b5240]')}
    >
      {children}{arrow}
    </th>
  );
}

/* ── History modal ── */
function HistoryModal({ item, notes, firstSeen, onClose }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-[#1a0a04]/40 flex items-center justify-center z-[100] p-5"
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        className="bg-white rounded-[14px] w-full max-w-[700px] max-h-[85vh] overflow-y-auto shadow-xl"
      >
        <div className="bg-[#1B3A5C] text-white px-5 py-3 flex items-start justify-between rounded-t-[14px]">
          <div>
            <div className="text-[15px] font-bold">{item.item_description || 'Geen omschrijving'}</div>
            <div className="text-[11px] opacity-80">
              Item <span className="font-mono">{item.item_number}</span> · Store {item.store_number} · {item.dept_code} {item.dept_name}
            </div>
          </div>
          <button onClick={onClose} className="text-white text-[22px] leading-none hover:opacity-70">×</button>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap gap-4 text-[12px] mb-4">
            <span>Aantal: <span className="font-bold" style={{ color: '#dc2626' }}>{fmt(item.qty_on_hand)}</span></span>
            <span>Waarde: <span className="font-bold" style={{ color: '#dc2626' }}>XCG {fmt(Math.round(item.inv_value))}</span></span>
            {firstSeen && (
              <span>Eerste keer negatief: <span className="font-bold">{fmtDate(firstSeen.first_seen_date)}</span>
                {' '}({daysSince(firstSeen.first_seen_date)} dagen geleden)
              </span>
            )}
          </div>

          <h3 className="text-[13px] font-bold mb-2">Historie ({notes.length})</h3>
          {notes.length === 0 ? (
            <p className="text-[12px] text-[#6b5240] italic">Nog geen opmerkingen.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map(function(n) {
                return (
                  <div key={n.id} className="bg-[#faf7f4] border border-[#e5ddd4] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] text-[#6b5240]">
                        <span className="font-semibold text-[#1a0a04]">{n.created_by_name || n.created_by_email}</span>
                        <span className="mx-1.5 text-[#a08a74]">·</span>
                        {fmtDateTime(n.created_at)}
                      </div>
                      <StatusBadge status={n.status} />
                    </div>
                    <div className="text-[12px] whitespace-pre-wrap">{n.note}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
