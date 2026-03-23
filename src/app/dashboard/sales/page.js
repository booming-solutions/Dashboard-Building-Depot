'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';

function formatCurrency(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function formatPct(n) { return (n || 0).toFixed(1) + '%'; }

function KPI({ label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${color || 'bg-blue'}`} />
      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-2xl font-bold text-navy mt-1 font-mono tracking-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function SalesDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState('all');
  const [bum, setBum] = useState('all');
  const monthlyRef = useRef(null);
  const gmRef = useRef(null);
  const bumRef = useRef(null);
  const deptRef = useRef(null);
  const chartsRef = useRef({});
  const supabase = createClient();

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (data.length) renderCharts(); }, [data, store, bum]);

  async function loadData() {
    const { data: rows, error } = await supabase.from('sales_data').select('*').order('sale_date');
    if (!error && rows) setData(rows);
    setLoading(false);
  }

  function filtered() {
    return data.filter(r =>
      (store === 'all' || r.store_number === store) &&
      (bum === 'all' || r.bum === bum)
    );
  }

  function getMonthlyData(rows) {
    const monthly = {};
    rows.forEach(r => {
      const m = r.sale_date.substring(0, 7);
      if (!monthly[m]) monthly[m] = { sales: 0, gm: 0 };
      monthly[m].sales += parseFloat(r.net_sales);
      monthly[m].gm += parseFloat(r.gross_margin);
    });
    const months = Object.keys(monthly).sort();
    return { months, sales: months.map(m => monthly[m].sales), gm: months.map(m => monthly[m].gm), gmPct: months.map(m => monthly[m].gm / monthly[m].sales * 100) };
  }

  function getBumData(rows) {
    const bums = {};
    rows.forEach(r => {
      if (!bums[r.bum]) bums[r.bum] = { sales: 0, gm: 0 };
      bums[r.bum].sales += parseFloat(r.net_sales);
      bums[r.bum].gm += parseFloat(r.gross_margin);
    });
    const sorted = Object.entries(bums).sort((a, b) => b[1].sales - a[1].sales);
    return { names: sorted.map(s => s[0]), sales: sorted.map(s => s[1].sales), gm: sorted.map(s => s[1].gm) };
  }

  function getDeptData(rows) {
    const depts = {};
    rows.forEach(r => {
      if (!depts[r.dept_name]) depts[r.dept_name] = { sales: 0, gm: 0 };
      depts[r.dept_name].sales += parseFloat(r.net_sales);
      depts[r.dept_name].gm += parseFloat(r.gross_margin);
    });
    const sorted = Object.entries(depts).sort((a, b) => b[1].sales - a[1].sales).slice(0, 10);
    return { names: sorted.map(s => s[0].replace(/^\d+\s/, '')), sales: sorted.map(s => s[1].sales), gm: sorted.map(s => s[1].gm) };
  }

  async function renderCharts() {
    if (typeof window === 'undefined') return;
    const Chart = (await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm')).Chart;
    const { CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend } = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm');
    Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend);

    const rows = filtered();
    const monthly = getMonthlyData(rows);
    const bumData = getBumData(rows);
    const deptData = getDeptData(rows);

    Object.values(chartsRef.current).forEach(c => c?.destroy());

    if (monthlyRef.current) {
      chartsRef.current.monthly = new Chart(monthlyRef.current, {
        type: 'bar', data: {
          labels: monthly.months.map(m => { const [y, mo] = m.split('-'); return ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'][parseInt(mo)-1] + ' ' + y.slice(2); }),
          datasets: [{ label: 'Net Sales', data: monthly.sales, backgroundColor: '#2E8BC0', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatCurrency(c.raw) } } }, scales: { y: { ticks: { callback: v => '$' + (v/1e6).toFixed(1) + 'M' } } } }
      });
    }

    if (gmRef.current) {
      chartsRef.current.gm = new Chart(gmRef.current, {
        type: 'line', data: {
          labels: monthly.months.map(m => { const [y, mo] = m.split('-'); return ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'][parseInt(mo)-1] + ' ' + y.slice(2); }),
          datasets: [{ label: 'GM%', data: monthly.gmPct, borderColor: '#F0B429', backgroundColor: 'rgba(240,180,41,0.1)', fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#F0B429' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatPct(c.raw) } } }, scales: { y: { min: 25, max: 45, ticks: { callback: v => v + '%' } } } }
      });
    }

    if (bumRef.current) {
      chartsRef.current.bum = new Chart(bumRef.current, {
        type: 'bar', data: {
          labels: bumData.names,
          datasets: [{ label: 'Net Sales', data: bumData.sales, backgroundColor: ['#1B3A5C', '#2E8BC0', '#4BA3D4', '#F0B429', '#D49E1F'], borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatCurrency(c.raw) } } }, scales: { x: { ticks: { callback: v => '$' + (v/1e6).toFixed(1) + 'M' } } } }
      });
    }

    if (deptRef.current) {
      chartsRef.current.dept = new Chart(deptRef.current, {
        type: 'bar', data: {
          labels: deptData.names,
          datasets: [{ label: 'Net Sales', data: deptData.sales, backgroundColor: '#2E8BC0', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatCurrency(c.raw) } } }, scales: { x: { ticks: { callback: v => '$' + (v/1e6).toFixed(1) + 'M' } } } }
      });
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Dashboard laden...</p></div>;

  if (!data.length) return (
    <div className="text-center py-16">
      <div className="text-4xl mb-4">📊</div>
      <h2 className="font-display text-xl font-semibold text-navy mb-2">Nog geen data</h2>
      <p className="text-gray-400 text-sm mb-4">Upload eerst een Excel-export via het Admin-paneel</p>
      <a href="/dashboard/admin" className="inline-flex bg-gold text-navy-deep px-5 py-2 rounded-xl font-semibold text-sm hover:bg-gold-light transition-all">Ga naar Data Upload</a>
    </div>
  );

  const rows = filtered();
  const totalSales = rows.reduce((s, r) => s + parseFloat(r.net_sales), 0);
  const totalGM = rows.reduce((s, r) => s + parseFloat(r.gross_margin), 0);
  const gmPct = totalSales > 0 ? (totalGM / totalSales * 100) : 0;
  const stores = [...new Set(data.map(r => r.store_number))];
  const bums = [...new Set(data.map(r => r.bum))].sort();

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Sales Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Building Depot Trading B.V.</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={store} onChange={e => setStore(e.target.value)} className="bg-white border border-gray-200 text-navy text-sm px-3 py-2 rounded-lg">
            <option value="all">Alle winkels</option>
            {stores.map(s => <option key={s} value={s}>{s === '1' ? 'Curaçao' : s === 'B' ? 'Bonaire' : s}</option>)}
          </select>
          <select value={bum} onChange={e => setBum(e.target.value)} className="bg-white border border-gray-200 text-navy text-sm px-3 py-2 rounded-lg">
            <option value="all">Alle managers</option>
            {bums.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KPI label="Net Sales" value={formatCurrency(totalSales)} sub={`${rows.length.toLocaleString()} transacties`} color="bg-blue" />
        <KPI label="Gross Margin" value={formatCurrency(totalGM)} color="bg-gold" />
        <KPI label="GM%" value={formatPct(gmPct)} sub="Gewogen gemiddelde" color="bg-navy" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">Maandelijkse omzet</h3>
          <div style={{ height: '260px' }}><canvas ref={monthlyRef} /></div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">Bruto marge %</h3>
          <div style={{ height: '260px' }}><canvas ref={gmRef} /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">Per manager</h3>
          <div style={{ height: '240px' }}><canvas ref={bumRef} /></div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">Top 10 departementen</h3>
          <div style={{ height: '240px' }}><canvas ref={deptRef} /></div>
        </div>
      </div>
    </div>
  );
}
