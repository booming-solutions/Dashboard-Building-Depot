/* ============================================================
   BESTAND: page.js (Kortingen)
   KOPIEER NAAR: src/app/dashboard/sales/discounts/page.js
   (NIEUWE map maken: discounts)
   VERSIE: v1.0

   Toont:
   - KPIs: totaal omzet, totaal korting, gem korting%, laatste week
   - Wekelijkse trend met 6-weeks moving average
   - Toggle Cash/Account/Beide
   - Toggle Abs/% voor metrics
   - Top clerks tabel
   - Top accounts tabel (met running year omzet)
   - Filters: date range, clerk multi-select

   Data bron: discount_data tabel (importeer eerst CSV)
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

// ISO weeknummer berekening (Maandag = start van de week)
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
  // Eerste maandag van betreffende ISO-week
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
      className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${active ? 'bg-[#E84E1B] text-white' : 'bg-white text-[#6b5240] border border-[#e5ddd4] hover:bg-[#faf5f0]'}`}>
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

export default function KortingenPage() {
  const supabase = createClient();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState('all');  // all|cash|account
  const [metricMode, setMetricMode] = useState('pct');  // pct|abs
  const [selClerks, setSelClerks] = useState([]);  // multi-select; leeg = alle
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tab, setTab] = useState('trend');  // trend|clerks|accounts
  const trendRef = useRef(null);
  const clerkRef = useRef(null);
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
    // Default date range: laatste 52 weken
    if (all.length) {
      const dates = all.map(r => r.sale_date).sort();
      const last = new Date(dates[dates.length - 1]);
      const first = new Date(last);
      first.setDate(first.getDate() - 52 * 7);
      setDateFrom(first.toISOString().slice(0, 10));
      setDateTo(dates[dates.length - 1]);
    }
  }

  // Filter de data
  const filtered = useMemo(() => {
    if (!data.length) return [];
    return data.filter(r => {
      // Outliers eruit: discount% > 100 (data fout bij kleine bedragen)
      if (Math.abs(parseFloat(r.discount_pct) || 0) > 100) return false;
      // Customer type filter
      if (customerFilter === 'cash' && !r.is_cash) return false;
      if (customerFilter === 'account' && r.is_cash) return false;
      // Date range
      if (dateFrom && r.sale_date < dateFrom) return false;
      if (dateTo && r.sale_date > dateTo) return false;
      // Clerk multi-select
      if (selClerks.length && !selClerks.includes(r.clerk)) return false;
      return true;
    });
  }, [data, customerFilter, dateFrom, dateTo, selClerks]);

  // Aggregeer naar week
  const weekly = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const k = weekKey(new Date(r.sale_date));
      if (!map[k]) map[k] = { week: k, sales: 0, discount: 0, transactions: 0, date: weekStart(k) };
      map[k].sales += parseFloat(r.sales_amount) || 0;
      map[k].discount += parseFloat(r.discount_amount) || 0;
      map[k].transactions += 1;
    });
    const arr = Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
    // Discount % per week = discount / (sales + discount) * 100 (op brutoprijs)
    arr.forEach(w => {
      const gross = w.sales + w.discount;
      w.pct = gross ? w.discount / gross * 100 : 0;
    });
    // Moving average 6 weken
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

  // KPIs
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

  // Clerks aggregatie + running year sales (alle data laatste 52 weken voor die clerk)
  const clerks = useMemo(() => {
    const map = {};
    filtered.forEach(r => {
      const c = r.clerk || 'BLANK';
      if (!map[c]) map[c] = { clerk: c, sales: 0, discount: 0, transactions: 0 };
      map[c].sales += parseFloat(r.sales_amount) || 0;
      map[c].discount += parseFloat(r.discount_amount) || 0;
      map[c].transactions += 1;
    });
    return Object.values(map).map(c => {
      const gross = c.sales + c.discount;
      return { ...c, pct: gross ? c.discount / gross * 100 : 0 };
    }).sort((a, b) => b.discount - a.discount);
  }, [filtered]);

  // Accounts aggregatie (alleen account klanten, voor de tabel)
  const accounts = useMemo(() => {
    const map = {};
    filtered.filter(r => !r.is_cash).forEach(r => {
      const k = r.customer_number;
      if (!map[k]) map[k] = { customer_number: k, customer_name: r.customer_name, sales: 0, discount: 0, transactions: 0 };
      map[k].sales += parseFloat(r.sales_amount) || 0;
      map[k].discount += parseFloat(r.discount_amount) || 0;
      map[k].transactions += 1;
    });
    return Object.values(map).map(a => {
      const gross = a.sales + a.discount;
      return { ...a, pct: gross ? a.discount / gross * 100 : 0 };
    }).sort((a, b) => b.discount - a.discount).slice(0, 30);
  }, [filtered]);

  // Beschikbare clerks voor filter
  const allClerks = useMemo(() => {
    const s = new Set();
    data.forEach(r => { if (r.clerk) s.add(r.clerk); });
    return [...s].sort();
  }, [data]);

  // Render trend chart
  useEffect(() => {
    if (loading || !weekly.length) return;
    Object.values(chartsRef.current).forEach(c => c?.destroy());
    chartsRef.current = {};
    if (trendRef.current) {
      const lb = weekly.map(w => w.week);
      const showPct = metricMode === 'pct';
      chartsRef.current.trend = new Chart(trendRef.current, {
        type: 'bar',
        data: {
          labels: lb,
          datasets: [
            {
              label: showPct ? 'Korting % per week' : 'Korting bedrag per week',
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
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { usePointStyle: true, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: c => showPct ? `${c.dataset.label}: ${(c.raw || 0).toFixed(2)}%` : `${c.dataset.label}: ${fmt(Math.round(c.raw || 0))}`,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) },
              grid: { color: '#f0ebe5' },
            },
            x: { ticks: { maxRotation: 90, minRotation: 60, font: { size: 9 } }, grid: { display: false } },
          },
        },
      });
    }
    if (clerkRef.current) {
      const top = clerks.slice(0, 15);
      const showPct = metricMode === 'pct';
      chartsRef.current.clerk = new Chart(clerkRef.current, {
        type: 'bar',
        data: {
          labels: top.map(c => c.clerk.split(' ')[0]),
          datasets: [{
            label: showPct ? 'Korting %' : 'Korting (XCG)',
            data: top.map(c => showPct ? c.pct : c.discount),
            backgroundColor: 'rgba(232, 78, 27, 0.6)',
            borderColor: '#E84E1B',
            borderWidth: 1,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => showPct ? `${(c.raw || 0).toFixed(2)}%` : fmt(Math.round(c.raw || 0)) } } },
          scales: {
            x: { beginAtZero: true, ticks: { callback: v => showPct ? v.toFixed(1) + '%' : fmtK(v) }, grid: { color: '#f0ebe5' } },
            y: { grid: { display: false }, ticks: { font: { size: 10 } } },
          },
        },
      });
    }
    return () => { Object.values(chartsRef.current).forEach(c => c?.destroy()); chartsRef.current = {}; };
  }, [weekly, clerks, metricMode, loading]);

  function toggleClerk(c) {
    setSelClerks(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function buildExportSheets() {
    return [
      {
        name: 'Wekelijks',
        rows: weekly.map(w => ({ 'Week': w.week, 'Omzet (XCG)': Math.round(w.sales), 'Korting (XCG)': Math.round(w.discount), 'Korting %': w.pct.toFixed(2), '6w gem %': w.ma6_pct.toFixed(2), 'Transacties': w.transactions })),
      },
      {
        name: 'Per Clerk',
        rows: clerks.map(c => ({ 'Clerk': c.clerk, 'Omzet': Math.round(c.sales), 'Korting': Math.round(c.discount), 'Korting %': c.pct.toFixed(2), 'Transacties': c.transactions })),
      },
      {
        name: 'Top Accounts',
        rows: accounts.map(a => ({ 'Customer': a.customer_number, 'Naam': a.customer_name, 'Omzet': Math.round(a.sales), 'Korting': Math.round(a.discount), 'Korting %': a.pct.toFixed(2), 'Transacties': a.transactions })),
      },
    ];
  }

  if (loading) return <LoadingLogo text="Kortingen laden..." />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen kortingen data beschikbaar. Importeer eerst de discount_data tabel.</p></div>;

  const showPct = metricMode === 'pct';

  return (
    <div className="max-w-[1600px] mx-auto py-6 px-5">
      <div className="flex justify-between items-start mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Kortingen Analyse</h1>
          <p className="text-[13px] text-[#6b5240]">Wekelijkse trend in kortingen — Curaçao</p>
        </div>
        <div className="flex items-center gap-3">
          <ExcelExportButton
            filename={(() => {
              const d = new Date(); const pad = n => n < 10 ? '0' + n : '' + n;
              return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_kortingen_analyse';
            })()}
            reportTitle="Kortingen Analyse — Curaçao"
            sheets={buildExportSheets}
            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold border bg-white text-[#E84E1B] border-[#E84E1B] hover:bg-[#faf5f0] transition-colors"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 shadow-sm space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Klant</span>
          <Pill label="Alle" active={customerFilter === 'all'} onClick={() => setCustomerFilter('all')}/>
          <Pill label="Cash (*5)" active={customerFilter === 'cash'} onClick={() => setCustomerFilter('cash')}/>
          <Pill label="Account" active={customerFilter === 'account'} onClick={() => setCustomerFilter('account')}/>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Weergave</span>
          <Pill label="Percentage" active={metricMode === 'pct'} onClick={() => setMetricMode('pct')}/>
          <Pill label="Bedrag (XCG)" active={metricMode === 'abs'} onClick={() => setMetricMode('abs')}/>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Periode</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"/>
          <span className="text-[12px] text-[#6b5240]">tot</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"/>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20 mt-1">Clerk</span>
          <div className="flex-1 flex flex-wrap gap-1">
            {selClerks.length > 0 && (
              <button onClick={() => setSelClerks([])} className="px-2 py-1 rounded text-[11px] bg-[#faf5f0] text-[#6b5240] hover:bg-[#f0e8de]">
                Wis {selClerks.length} filter{selClerks.length === 1 ? '' : 's'}
              </button>
            )}
            <select onChange={e => { if (e.target.value && !selClerks.includes(e.target.value)) toggleClerk(e.target.value); e.target.value = ''; }} className="border border-[#e5ddd4] rounded px-2 py-1 text-[12px]">
              <option value="">+ Voeg clerk toe...</option>
              {allClerks.filter(c => !selClerks.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {selClerks.map(c => (
              <span key={c} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#E84E1B] text-white">
                {c}
                <button onClick={() => toggleClerk(c)} className="hover:opacity-70">×</button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <KPI label="Totaal Omzet" value={fmtK(kpis.totSales)} sub={`${kpis.txn.toLocaleString('nl-NL')} transacties`}/>
          <KPI label="Totaal Korting" value={fmtK(kpis.totDisc)} sub={`${fmtP(kpis.avgPct)} gemiddeld`}/>
          <KPI label="Gem. Korting %" value={fmtP(kpis.avgPct)} sub={`Over ${kpis.weeks} weken`}/>
          <KPI label="Laatste 6w gem." value={fmtP(kpis.ma6)} sub={kpis.lastWeek ? `t/m ${kpis.lastWeek.week}` : ''}/>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b-2 border-[#e5ddd4]">
        <button onClick={() => setTab('trend')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'trend' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Wekelijkse Trend</button>
        <button onClick={() => setTab('clerks')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab === 'clerks' ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent'}`}>Per Clerk</button>
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
            <h3 className="text-[14px] font-bold text-[#1a0a04] mb-3">Top 15 Clerks ({showPct ? 'op korting %' : 'op korting bedrag'})</h3>
            <div style={{ height: '500px' }}><canvas ref={clerkRef}/></div>
          </div>
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Alle Clerks ({clerks.length})</p>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#faf7f4]">
                  <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Clerk</th>
                  <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Omzet</th>
                  <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Korting</th>
                  <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">%</th>
                  <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Transacties</th>
                </tr>
              </thead>
              <tbody>
                {clerks.map(c => (
                  <tr key={c.clerk} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[12px] border-b border-[#e5ddd4]">{c.clerk}</td>
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

      {tab === 'accounts' && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
          <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
            <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Top 30 Accounts naar Korting (alleen account klanten, geen cash)</p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf7f4]">
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Customer #</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Naam</th>
                <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Omzet</th>
                <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Korting</th>
                <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">%</th>
                <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Transacties</th>
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

      <p className="text-[10px] text-[#a08a74] mt-4">Outliers met &gt;100% korting zijn uitgesloten van de berekeningen (data-correcties bij kleine bedragen). Korting % = korting / (omzet + korting) × 100.</p>
    </div>
  );
}
