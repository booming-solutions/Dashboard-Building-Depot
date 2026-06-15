/* ============================================================
   BESTAND: page.js (Kortingen Analyse)
   KOPIEER NAAR: src/app/dashboard/sales/discounts/page.js
   VERSIE: v2.0

   Wijzigingen v2.0:
   - Land filter (Curaçao / Bonaire / Multimart, default Curaçao, geen Alle)
   - Territory filter (Store / B2B / Blank, default Alle)
   - Salesperson multi-select filter
   - Volgorde filters: Land → Territory → Klant → Salesperson → Clerk → Periode
   - Default periode: 1-1-2025 t/m laatste data
   - Valuta label rechtsboven (XCG / US$)
   - Sortable tabel-kolommen voor clerks/salesperson/accounts tabs
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';
import Chart from 'chart.js/auto';

const fmt = n => (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtK = n => { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : fmt(a)); };
const fmtP = n => (n || 0).toFixed(2) + '%';

const STORE_LABEL = { '1': 'Curaçao', 'B': 'Bonaire', 'M': 'Multimart', 'R': 'Repair' };
const STORE_CURRENCY = { '1': 'XCG', 'B': 'US$', 'M': 'XCG', 'R': 'XCG' };

// ISO weeknummer (Maandag = start)
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week: weekNum };
}
function weekKey(d) {
  const { year, week } = isoWeek(d);
  return year + '-W' + String(week).padStart(2, '0');
}
function weekStart(yearWeek) {
  const [y, w] = yearWeek.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const result = new Date(week1Mon);
  result.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  return result;
}

function Pill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors whitespace-nowrap ${active ? 'bg-[#E84E1B] text-white' : 'bg-white text-[#6b5240] border border-[#e5ddd4] hover:bg-[#faf5f0]'}`}>
      {label}
    </button>
  );
}

function KPI({ label, value, sub }) {
  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"/>
      <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{label}</p>
      <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{value}</p>
      {sub && <p className="text-[12px] text-[#6b5240] font-mono mt-1">{sub}</p>}
    </div>
  );
}

// Sortable tabel header cell
function ThSort({ label, col, sortCol, sortDir, onSort, align = 'right' }) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} className={`text-${align} p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4] cursor-pointer hover:text-[#E84E1B] whitespace-nowrap select-none`}>
      {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );
}

export default function KortingenPage() {
  const supabase = createClient();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  // Filters
  const [store, setStore] = useState('1');                        // default Curaçao, geen Alle
  const [territory, setTerritory] = useState('all');              // all|STORE|B2B|BLANK|...
  const [customerFilter, setCustomerFilter] = useState('all');    // all|cash|account
  const [selSales, setSelSales] = useState([]);                   // multi-select salesperson
  const [selClerks, setSelClerks] = useState([]);                 // multi-select clerk
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [metricMode, setMetricMode] = useState('pct');            // pct|abs
  const [tab, setTab] = useState('trend');
  // Sort state per tab
  const [clerkSort, setClerkSort] = useState({ col: 'discount', dir: 'desc' });
  const [salesSort, setSalesSort] = useState({ col: 'discount', dir: 'desc' });
  const [accSort, setAccSort] = useState({ col: 'discount', dir: 'desc' });
  const [deptSort, setDeptSort] = useState({ col: 'dept_code', dir: 'asc' });

  const trendRef = useRef(null);
  const clerkRef = useRef(null);
  const salesRef = useRef(null);
  const deptRef = useRef(null);
  const chartsRef = useRef({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('discount_data').select('*').order('sale_date').range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all);
    setLoading(false);
    if (all.length) {
      // Default periode: 1-1-2025 t/m laatste datum
      const dates = all.map(r => r.sale_date).sort();
      setDateFrom('2025-01-01');
      setDateTo(dates[dates.length - 1]);
    }
  }

  // Filter de data
  const filtered = useMemo(() => {
    if (!data.length) return [];
    return data.filter(r => {
      // Outliers eruit: discount% > 100 (data fout bij kleine bedragen)
      if (Math.abs(parseFloat(r.discount_pct) || 0) > 100) return false;
      // Store filter (geen 'all', altijd één specifieke)
      if (r.store_number !== store) return false;
      // Territory
      if (territory !== 'all' && (r.territory || 'BLANK') !== territory) return false;
      // Customer
      if (customerFilter === 'cash' && !r.is_cash) return false;
      if (customerFilter === 'account' && r.is_cash) return false;
      // Salesperson multi-select
      if (selSales.length && !selSales.includes(r.salesperson_name || 'BLANK')) return false;
      // Clerk multi-select
      if (selClerks.length && !selClerks.includes(r.clerk || 'BLANK')) return false;
      // Date range
      if (dateFrom && r.sale_date < dateFrom) return false;
      if (dateTo && r.sale_date > dateTo) return false;
      return true;
    });
  }, [data, store, territory, customerFilter, selSales, selClerks, dateFrom, dateTo]);

  // Aggregeer naar week
  const weekly = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const k = weekKey(new Date(r.sale_date));
      if (!map[k]) map[k] = { week: k, sales: 0, discount: 0, transactions: 0 };
      map[k].sales += parseFloat(r.sales_amount) || 0;
      map[k].discount += parseFloat(r.discount_amount) || 0;
      map[k].transactions += 1;
    });
    const arr = Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
    arr.forEach(w => {
      const gross = w.sales + w.discount;
      w.pct = gross ? w.discount / gross * 100 : 0;
    });
    // Moving avg 6 weken
    arr.forEach((w, i) => {
      const start = Math.max(0, i - 5);
      const slice = arr.slice(start, i + 1);
      const totSales = slice.reduce((s, x) => s + x.sales, 0);
      const totDisc = slice.reduce((s, x) => s + x.discount, 0);
      const gross = totSales + totDisc;
      w.ma6_pct = gross ? totDisc / gross * 100 : 0;
      w.ma6_abs = slice.length ? totDisc / slice.length : 0;
    });
    return arr;
  }, [filtered]);

  const kpis = useMemo(() => {
    if (!filtered.length) return null;
    const totSales = filtered.reduce((s, r) => s + (parseFloat(r.sales_amount) || 0), 0);
    const totDisc = filtered.reduce((s, r) => s + (parseFloat(r.discount_amount) || 0), 0);
    const gross = totSales + totDisc;
    const avgPct = gross ? totDisc / gross * 100 : 0;
    const lastWeek = weekly.length ? weekly[weekly.length - 1] : null;
    const ma6 = lastWeek ? lastWeek.ma6_pct : 0;
    return { totSales, totDisc, avgPct, lastWeek, ma6, weeks: weekly.length, txn: filtered.length };
  }, [filtered, weekly]);

  // Aggregaties + sortering per tab
  function sortBy(arr, col, dir) {
    const m = dir === 'desc' ? -1 : 1;
    return [...arr].sort((a, b) => {
      const av = a[col], bv = b[col];
      // dept_code: numeriek sorteren (1, 2, 11, niet 1, 11, 2)
      if (col === 'dept_code') {
        return m * ((parseInt(av) || 0) - (parseInt(bv) || 0));
      }
      // customer_number ook numeriek waar mogelijk (start met * voor cash, anders nummer)
      if (col === 'customer_number') {
        const an = parseInt(av), bn = parseInt(bv);
        if (!isNaN(an) && !isNaN(bn)) return m * (an - bn);
        return m * String(av).localeCompare(String(bv));
      }
      if (typeof av === 'string') return m * av.localeCompare(bv);
      return m * ((av || 0) - (bv || 0));
    });
  }

  const clerks = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const c = r.clerk || 'BLANK';
      if (!map[c]) map[c] = { name: c, sales: 0, discount: 0, transactions: 0 };
      map[c].sales += parseFloat(r.sales_amount) || 0;
      map[c].discount += parseFloat(r.discount_amount) || 0;
      map[c].transactions += 1;
    });
    const arr = Object.values(map).map(c => {
      const gross = c.sales + c.discount;
      return { ...c, pct: gross ? c.discount / gross * 100 : 0 };
    });
    return sortBy(arr, clerkSort.col, clerkSort.dir);
  }, [filtered, clerkSort]);

  const salesreps = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const c = r.salesperson_name || 'BLANK';
      if (!map[c]) map[c] = { name: c, sales: 0, discount: 0, transactions: 0 };
      map[c].sales += parseFloat(r.sales_amount) || 0;
      map[c].discount += parseFloat(r.discount_amount) || 0;
      map[c].transactions += 1;
    });
    const arr = Object.values(map).map(c => {
      const gross = c.sales + c.discount;
      return { ...c, pct: gross ? c.discount / gross * 100 : 0 };
    });
    return sortBy(arr, salesSort.col, salesSort.dir);
  }, [filtered, salesSort]);

  const departments = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const code = r.dept_code || '??';
      if (!map[code]) map[code] = { dept_code: code, dept_name: r.dept_name || '', sales: 0, discount: 0, transactions: 0 };
      map[code].sales += parseFloat(r.sales_amount) || 0;
      map[code].discount += parseFloat(r.discount_amount) || 0;
      map[code].transactions += 1;
    });
    const arr = Object.values(map).map(d => {
      const gross = d.sales + d.discount;
      return { ...d, pct: gross ? d.discount / gross * 100 : 0 };
    });
    return sortBy(arr, deptSort.col, deptSort.dir);
  }, [filtered, deptSort]);

  const accounts = useMemo(() => {
    const map = {};
    filtered.filter(r => !r.is_cash).forEach(r => {
      const k = r.customer_number;
      if (!map[k]) map[k] = { customer_number: k, customer_name: r.customer_name, sales: 0, discount: 0, transactions: 0 };
      map[k].sales += parseFloat(r.sales_amount) || 0;
      map[k].discount += parseFloat(r.discount_amount) || 0;
      map[k].transactions += 1;
    });
    const arr = Object.values(map).map(a => {
      const gross = a.sales + a.discount;
      return { ...a, pct: gross ? a.discount / gross * 100 : 0 };
    });
    return sortBy(arr, accSort.col, accSort.dir).slice(0, 50);
  }, [filtered, accSort]);

  // Beschikbare territories/salespersons/clerks voor filter (per store)
  const availTerritories = useMemo(() => {
    const s = new Set();
    data.filter(r => r.store_number === store).forEach(r => { s.add(r.territory || 'BLANK'); });
    return [...s].sort();
  }, [data, store]);
  const availSales = useMemo(() => {
    const s = new Set();
    data.filter(r => r.store_number === store).forEach(r => { if (r.salesperson_name) s.add(r.salesperson_name); });
    return [...s].sort();
  }, [data, store]);
  const availClerks = useMemo(() => {
    const s = new Set();
    data.filter(r => r.store_number === store).forEach(r => { if (r.clerk) s.add(r.clerk); });
    return [...s].sort();
  }, [data, store]);

  // Reset multi-selects als store wisselt zodat we geen onbeschikbare waarden vasthouden
  useEffect(() => { setSelSales([]); setSelClerks([]); setTerritory('all'); }, [store]);

  // Charts renderen
  // Trend chart — alleen renderen wanneer 'trend' tab actief is
  useEffect(() => {
    if (loading || tab !== 'trend' || !weekly.length || !trendRef.current) return;
    if (chartsRef.current.trend) { chartsRef.current.trend.destroy(); chartsRef.current.trend = null; }
    const lb = weekly.map(w => w.week);
    const showPct = metricMode === 'pct';
    const curr = STORE_CURRENCY[store];
    chartsRef.current.trend = new Chart(trendRef.current, {
      type: 'bar',
      data: {
        labels: lb,
        datasets: [
          {
            label: showPct ? 'Korting % per week' : `Korting ${curr} per week`,
            data: weekly.map(w => showPct ? w.pct : w.discount),
            backgroundColor: 'rgba(232, 78, 27, 0.25)',
            borderColor: '#E84E1B',
            borderWidth: 1,
            borderRadius: 3,
            order: 2,
          },
          {
            label: '6-weeks gem.',
            data: weekly.map(w => showPct ? w.ma6_pct : w.ma6_abs),
            type: 'line',
            borderColor: '#1B3A5C',
            backgroundColor: '#1B3A5C',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => showPct ? `${c.dataset.label}: ${(c.raw || 0).toFixed(2)}%` : `${c.dataset.label}: ${fmt(Math.round(c.raw || 0))}` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) }, grid: { color: '#f0ebe5' } },
          x: { ticks: { maxRotation: 90, minRotation: 60, font: { size: 9 } }, grid: { display: false } },
        },
      },
    });
    return () => { if (chartsRef.current.trend) { chartsRef.current.trend.destroy(); chartsRef.current.trend = null; } };
  }, [weekly, metricMode, loading, store, tab]);

  // Clerk top-15 chart — alleen renderen wanneer 'clerks' tab actief is
  useEffect(() => {
    if (loading || tab !== 'clerks' || !clerks.length || !clerkRef.current) return;
    if (chartsRef.current.clerk) { chartsRef.current.clerk.destroy(); chartsRef.current.clerk = null; }
    const top = clerks.slice(0, 15);
    const showPct = metricMode === 'pct';
    const curr = STORE_CURRENCY[store];
    chartsRef.current.clerk = new Chart(clerkRef.current, {
      type: 'bar',
      data: {
        labels: top.map(c => c.name.split(' ')[0]),
        datasets: [{
          label: showPct ? 'Korting %' : `Korting ${curr}`,
          data: top.map(c => showPct ? c.pct : c.discount),
          backgroundColor: 'rgba(232, 78, 27, 0.6)',
          borderColor: '#E84E1B',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => showPct ? `${(c.raw || 0).toFixed(2)}%` : fmt(Math.round(c.raw || 0)) } } },
        scales: { x: { beginAtZero: true, ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) }, grid: { color: '#f0ebe5' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } },
      },
    });
    return () => { if (chartsRef.current.clerk) { chartsRef.current.clerk.destroy(); chartsRef.current.clerk = null; } };
  }, [clerks, metricMode, loading, store, tab]);

  // Salesperson top-15 chart — alleen renderen wanneer 'sales' tab actief is
  useEffect(() => {
    if (loading || tab !== 'sales' || !salesreps.length || !salesRef.current) return;
    if (chartsRef.current.sales) { chartsRef.current.sales.destroy(); chartsRef.current.sales = null; }
    const top = salesreps.slice(0, 15);
    const showPct = metricMode === 'pct';
    const curr = STORE_CURRENCY[store];
    chartsRef.current.sales = new Chart(salesRef.current, {
      type: 'bar',
      data: {
        labels: top.map(c => c.name.split(' ')[0]),
        datasets: [{
          label: showPct ? 'Korting %' : `Korting ${curr}`,
          data: top.map(c => showPct ? c.pct : c.discount),
          backgroundColor: 'rgba(232, 78, 27, 0.6)',
          borderColor: '#E84E1B',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => showPct ? `${(c.raw || 0).toFixed(2)}%` : fmt(Math.round(c.raw || 0)) } } },
        scales: { x: { beginAtZero: true, ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) }, grid: { color: '#f0ebe5' } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } },
      },
    });
    return () => { if (chartsRef.current.sales) { chartsRef.current.sales.destroy(); chartsRef.current.sales = null; } };
  }, [salesreps, metricMode, loading, store, tab]);

  // Department chart — alle departments tonen, gesorteerd op code (oplopend)
  useEffect(() => {
    if (loading || tab !== 'departments' || !departments.length || !deptRef.current) return;
    if (chartsRef.current.dept) { chartsRef.current.dept.destroy(); chartsRef.current.dept = null; }
    // Sorteer altijd op dept_code voor chart (consistent overzicht, niet afhankelijk van tabel sort)
    const sortedByCode = [...departments].sort((a, b) => (parseInt(a.dept_code) || 0) - (parseInt(b.dept_code) || 0));
    const showPct = metricMode === 'pct';
    const curr = STORE_CURRENCY[store];
    chartsRef.current.dept = new Chart(deptRef.current, {
      type: 'bar',
      data: {
        labels: sortedByCode.map(d => d.dept_code + ' ' + (d.dept_name || '').replace(/^\d+\s*/, '').slice(0, 25)),
        datasets: [{
          label: showPct ? 'Korting %' : `Korting ${curr}`,
          data: sortedByCode.map(d => showPct ? d.pct : d.discount),
          backgroundColor: 'rgba(232, 78, 27, 0.6)',
          borderColor: '#E84E1B',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => showPct ? `${(c.raw || 0).toFixed(2)}%` : fmt(Math.round(c.raw || 0)) } } },
        scales: { x: { beginAtZero: true, ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) }, grid: { color: '#f0ebe5' } }, y: { grid: { display: false }, ticks: { font: { size: 9 }, autoSkip: false } } },
      },
    });
    return () => { if (chartsRef.current.dept) { chartsRef.current.dept.destroy(); chartsRef.current.dept = null; } };
  }, [departments, metricMode, loading, store, tab]);

  function toggleSort(setSort) {
    return col => setSort(prev => prev.col === col ? { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' });
  }
  function toggleSales(v) { setSelSales(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); }
  function toggleClerk(v) { setSelClerks(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); }

  function buildExportSheets() {
    const cl = STORE_LABEL[store];
    const curr = STORE_CURRENCY[store];
    return [
      { name: `${cl}_Wekelijks`, rows: weekly.map(w => ({ 'Week': w.week, [`Omzet ${curr}`]: Math.round(w.sales), [`Korting ${curr}`]: Math.round(w.discount), 'Korting %': w.pct.toFixed(2), '6w gem %': w.ma6_pct.toFixed(2), 'Transacties': w.transactions })) },
      { name: 'Per Clerk', rows: clerks.map(c => ({ 'Clerk': c.name, [`Omzet ${curr}`]: Math.round(c.sales), [`Korting ${curr}`]: Math.round(c.discount), 'Korting %': c.pct.toFixed(2), 'Transacties': c.transactions })) },
      { name: 'Per Salesperson', rows: salesreps.map(c => ({ 'Salesperson': c.name, [`Omzet ${curr}`]: Math.round(c.sales), [`Korting ${curr}`]: Math.round(c.discount), 'Korting %': c.pct.toFixed(2), 'Transacties': c.transactions })) },
      { name: 'Per Department', rows: departments.map(d => ({ 'Dept Code': d.dept_code, 'Department': d.dept_name, [`Omzet ${curr}`]: Math.round(d.sales), [`Korting ${curr}`]: Math.round(d.discount), 'Korting %': d.pct.toFixed(2), 'Transacties': d.transactions })) },
      { name: 'Top Accounts', rows: accounts.map(a => ({ 'Customer': a.customer_number, 'Naam': a.customer_name, [`Omzet ${curr}`]: Math.round(a.sales), [`Korting ${curr}`]: Math.round(a.discount), 'Korting %': a.pct.toFixed(2), 'Transacties': a.transactions })) },
    ];
  }

  // Bereken laatste upload datum (gebruik max uploaded_at uit alle rijen)
  // BELANGRIJK: useMemo MOET boven conditional returns staan (React hook regel)
  const lastUpload = useMemo(() => {
    if (!data.length) return null;
    let max = '';
    data.forEach(r => { if (r.uploaded_at && r.uploaded_at > max) max = r.uploaded_at; });
    if (!max) return null;
    const d = new Date(max);
    if (isNaN(d.getTime())) return null;
    const MN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${d.getDate()} ${MN[d.getMonth()]} ${d.getFullYear()}`;
  }, [data]);

  if (loading) return <LoadingLogo text="Kortingen laden..." />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen kortingen data beschikbaar.</p></div>;

  const showPct = metricMode === 'pct';
  const storeLabel = STORE_LABEL[store];
  const currency = STORE_CURRENCY[store];

  return (
    <div className="max-w-[1600px] mx-auto py-6 px-5">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Kortingen Analyse</h1>
          <p className="text-[13px] text-[#6b5240]">Wekelijkse trend in kortingen — {storeLabel}{lastUpload ? ` · Update t/m ${lastUpload}` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeLabel} · {currency}</div>
          <ExcelExportButton
            filename={(() => { const d = new Date(); const pad = n => n < 10 ? '0' + n : '' + n; return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_kortingen_' + storeLabel.toLowerCase().replace(/ç/g, 'c'); })()}
            reportTitle={`Kortingen Analyse — ${storeLabel}`}
            sheets={buildExportSheets}
            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold border bg-white text-[#E84E1B] border-[#E84E1B] hover:bg-[#faf5f0] transition-colors"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 shadow-sm space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Land</span>
          <Pill label="Curaçao" active={store === '1'} onClick={() => setStore('1')}/>
          <Pill label="Bonaire" active={store === 'B'} onClick={() => setStore('B')}/>
          <Pill label="Multimart" active={store === 'M'} onClick={() => setStore('M')}/>
          <Pill label="Repair" active={store === 'R'} onClick={() => setStore('R')}/>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Territory</span>
          <Pill label="Alle" active={territory === 'all'} onClick={() => setTerritory('all')}/>
          {availTerritories.map(t => <Pill key={t} label={t} active={territory === t} onClick={() => setTerritory(t)}/>)}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Klant</span>
          <Pill label="Alle" active={customerFilter === 'all'} onClick={() => setCustomerFilter('all')}/>
          <Pill label="Cash" active={customerFilter === 'cash'} onClick={() => setCustomerFilter('cash')}/>
          <Pill label="Account" active={customerFilter === 'account'} onClick={() => setCustomerFilter('account')}/>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24 mt-1">Salesperson</span>
          <div className="flex-1 flex flex-wrap gap-1">
            {selSales.length > 0 && <button onClick={() => setSelSales([])} className="px-2 py-1 rounded text-[11px] bg-[#faf5f0] text-[#6b5240] hover:bg-[#f0e8de]">Wis {selSales.length}</button>}
            <select onChange={e => { if (e.target.value && !selSales.includes(e.target.value)) toggleSales(e.target.value); e.target.value = ''; }} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]">
              <option value="">+ Voeg salesperson toe...</option>
              {availSales.filter(c => !selSales.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {selSales.map(c => <span key={c} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#E84E1B] text-white">{c}<button onClick={() => toggleSales(c)} className="hover:opacity-70">×</button></span>)}
          </div>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24 mt-1">Clerk</span>
          <div className="flex-1 flex flex-wrap gap-1">
            {selClerks.length > 0 && <button onClick={() => setSelClerks([])} className="px-2 py-1 rounded text-[11px] bg-[#faf5f0] text-[#6b5240] hover:bg-[#f0e8de]">Wis {selClerks.length}</button>}
            <select onChange={e => { if (e.target.value && !selClerks.includes(e.target.value)) toggleClerk(e.target.value); e.target.value = ''; }} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]">
              <option value="">+ Voeg clerk toe...</option>
              {availClerks.filter(c => !selClerks.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {selClerks.map(c => <span key={c} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#E84E1B] text-white">{c}<button onClick={() => toggleClerk(c)} className="hover:opacity-70">×</button></span>)}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Periode</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"/>
          <span className="text-[12px] text-[#6b5240]">tot</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"/>
        </div>
        <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-[#f0ebe5]">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Weergave</span>
          <Pill label="Percentage" active={metricMode === 'pct'} onClick={() => setMetricMode('pct')}/>
          <Pill label={`Bedrag (${currency})`} active={metricMode === 'abs'} onClick={() => setMetricMode('abs')}/>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <KPI label={`Totaal Omzet (${currency})`} value={fmtK(kpis.totSales)} sub={`${kpis.txn.toLocaleString('nl-NL')} transacties`}/>
          <KPI label={`Totaal Korting (${currency})`} value={fmtK(kpis.totDisc)} sub={`${fmtP(kpis.avgPct)} gemiddeld`}/>
          <KPI label="Gem. Korting %" value={fmtP(kpis.avgPct)} sub={`Over ${kpis.weeks} weken`}/>
          <KPI label="Laatste 6w gem." value={fmtP(kpis.ma6)} sub={kpis.lastWeek ? `t/m ${kpis.lastWeek.week}` : ''}/>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b-2 border-[#e5ddd4]">
        <button onClick={() => setTab('trend')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'trend' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Wekelijkse Trend</button>
        <button onClick={() => setTab('clerks')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'clerks' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Per Clerk</button>
        <button onClick={() => setTab('sales')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'sales' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Per Salesperson</button>
        <button onClick={() => setTab('departments')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'departments' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Per Department</button>
        <button onClick={() => setTab('accounts')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'accounts' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Top Accounts</button>
      </div>

      {tab === 'trend' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
          <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Wekelijkse Kortingen met 6-weeks Moving Average</h3>
          <div style={{ height: '420px' }}><canvas ref={trendRef}/></div>
        </div>
      )}

      {tab === 'clerks' && (
        <>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Top 15 Clerks ({showPct ? 'op korting %' : `op korting ${currency}`})</h3>
            <div style={{ height: '500px' }}><canvas ref={clerkRef}/></div>
          </div>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Alle Clerks ({clerks.length})</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#faf7f4]">
                  <ThSort label="Clerk" col="name" sortCol={clerkSort.col} sortDir={clerkSort.dir} onSort={toggleSort(setClerkSort)} align="left"/>
                  <ThSort label={`Omzet ${currency}`} col="sales" sortCol={clerkSort.col} sortDir={clerkSort.dir} onSort={toggleSort(setClerkSort)}/>
                  <ThSort label={`Korting ${currency}`} col="discount" sortCol={clerkSort.col} sortDir={clerkSort.dir} onSort={toggleSort(setClerkSort)}/>
                  <ThSort label="%" col="pct" sortCol={clerkSort.col} sortDir={clerkSort.dir} onSort={toggleSort(setClerkSort)}/>
                  <ThSort label="Transacties" col="transactions" sortCol={clerkSort.col} sortDir={clerkSort.dir} onSort={toggleSort(setClerkSort)}/>
                </tr>
              </thead>
              <tbody>
                {clerks.map(c => (
                  <tr key={c.name} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4]">{c.name}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(c.sales))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(c.discount))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: c.pct >= 15 ? '#dc2626' : c.pct >= 11 ? '#d97706' : '#16a34a' }}>{fmtP(c.pct)}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(c.transactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'sales' && (
        <>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Top 15 Salespersons ({showPct ? 'op korting %' : `op korting ${currency}`})</h3>
            {salesreps.length ? <div style={{ height: '500px' }}><canvas ref={salesRef}/></div> : <p className="text-center py-12 text-[#6b5240]">Geen data.</p>}
          </div>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Alle Salespersons ({salesreps.length})</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#faf7f4]">
                  <ThSort label="Salesperson" col="name" sortCol={salesSort.col} sortDir={salesSort.dir} onSort={toggleSort(setSalesSort)} align="left"/>
                  <ThSort label={`Omzet ${currency}`} col="sales" sortCol={salesSort.col} sortDir={salesSort.dir} onSort={toggleSort(setSalesSort)}/>
                  <ThSort label={`Korting ${currency}`} col="discount" sortCol={salesSort.col} sortDir={salesSort.dir} onSort={toggleSort(setSalesSort)}/>
                  <ThSort label="%" col="pct" sortCol={salesSort.col} sortDir={salesSort.dir} onSort={toggleSort(setSalesSort)}/>
                  <ThSort label="Transacties" col="transactions" sortCol={salesSort.col} sortDir={salesSort.dir} onSort={toggleSort(setSalesSort)}/>
                </tr>
              </thead>
              <tbody>
                {salesreps.map(c => (
                  <tr key={c.name} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4]">{c.name}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(c.sales))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(c.discount))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: c.pct >= 15 ? '#dc2626' : c.pct >= 11 ? '#d97706' : '#16a34a' }}>{fmtP(c.pct)}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(c.transactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'departments' && (
        <>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Departments ({showPct ? 'op korting %' : `op korting ${currency}`}) — gesorteerd op code</h3>
            {departments.length ? <div style={{ height: Math.max(400, departments.length * 18) + 'px' }}><canvas ref={deptRef}/></div> : <p className="text-center py-12 text-[#6b5240]">Geen data.</p>}
          </div>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Alle Departments ({departments.length})</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#faf7f4]">
                  <ThSort label="Code" col="dept_code" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)} align="left"/>
                  <ThSort label="Department" col="dept_name" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)} align="left"/>
                  <ThSort label={`Omzet ${currency}`} col="sales" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)}/>
                  <ThSort label={`Korting ${currency}`} col="discount" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)}/>
                  <ThSort label="%" col="pct" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)}/>
                  <ThSort label="Transacties" col="transactions" sortCol={deptSort.col} sortDir={deptSort.dir} onSort={toggleSort(setDeptSort)}/>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.dept_code} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] font-mono">{d.dept_code}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4]">{(d.dept_name || '').replace(/^\d+\s*/, '')}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(d.sales))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(d.discount))}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: d.pct >= 15 ? '#dc2626' : d.pct >= 11 ? '#d97706' : '#16a34a' }}>{fmtP(d.pct)}</td>
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.transactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
          <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
            <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Top 50 Accounts</p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf7f4]">
                <ThSort label="Customer #" col="customer_number" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)} align="left"/>
                <ThSort label="Naam" col="customer_name" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)} align="left"/>
                <ThSort label={`Omzet ${currency}`} col="sales" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)}/>
                <ThSort label={`Korting ${currency}`} col="discount" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)}/>
                <ThSort label="%" col="pct" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)}/>
                <ThSort label="Transacties" col="transactions" sortCol={accSort.col} sortDir={accSort.dir} onSort={toggleSort(setAccSort)}/>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.customer_number} className="hover:bg-[#faf5f0]">
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] font-mono">{a.customer_number}</td>
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4]">{a.customer_name || '—'}</td>
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(a.sales))}</td>
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(a.discount))}</td>
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{ color: a.pct >= 15 ? '#dc2626' : a.pct >= 11 ? '#d97706' : '#16a34a' }}>{fmtP(a.pct)}</td>
                  <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(a.transactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-[#a08a74] mt-4">Outliers met &gt;100% korting zijn uitgesloten van de berekeningen. Korting % = korting / (omzet + korting) × 100. Klik kolom-headers in de tabellen om te sorteren.</p>
    </div>
  );
}