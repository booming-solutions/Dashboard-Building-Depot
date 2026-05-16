/* ============================================================
   BESTAND: page.js (daily report dashboard pagina)
   KOPIEER NAAR: src/app/dashboard/sales/daily-report/page.js
   (NIEUWE map maken: daily-report)

   Volledige dagrapport-pagina met:
   - Per store: alle KPI's uit de email (vandaag/MTD/YTD/forecast)
   - Plus visualisaties: monthly chart TY vs LY vs Budget
   - Top 5 / worst 5 / BUM ranking
   - Accepteert ?date=YYYY-MM-DD query param (anders vandaag)
   ============================================================ */
'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

const fmt = n => (Number(n) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtM = n => {
  const a = Math.abs(Number(n) || 0);
  return (n < 0 ? '-' : '') + (a >= 1e6 ? (a/1e6).toFixed(2) + 'M' : (a/1e3).toFixed(0) + 'K');
};
const fmtP = n => (Number(n) || 0).toFixed(1) + '%';
const pctChg = (c, p) => p ? ((c - p) / Math.abs(p) * 100) : 0;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const STORE_LABELS = { '1': 'Curaçao', 'B': 'Bonaire' };

function fmtDateLong(d) {
  return d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear();
}

function Badge({ pct, inverse = false }) {
  if (pct === null || pct === undefined) return null;
  const positive = inverse ? pct < 0 : pct >= 0;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono ${positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {pct >= 0 ? '+' : ''}{fmtP(pct)}
    </span>
  );
}

// Zelfde data-ophalen als de shared library, maar dan client-side via Supabase
async function fetchStoreReport(supabase, storeNumber, reportDate) {
  const reportDateStr = reportDate.toISOString().slice(0, 10);
  const curYear = reportDate.getFullYear();
  const curMonth = reportDate.getMonth() + 1;
  const dayOfMonth = reportDate.getDate();
  const totalDaysInMonth = daysInMonth(curYear, curMonth);
  const lyYear = curYear - 1;
  const lyDateStr = `${lyYear}-${String(curMonth).padStart(2,'0')}-${String(dayOfMonth).padStart(2,'0')}`;
  const totalDaysInYear = daysInMonth(curYear, 2) === 29 ? 366 : 365;
  const dayOfYear = Math.floor((reportDate - new Date(curYear, 0, 0)) / (1000 * 60 * 60 * 24));

  // 1. Vandaag (FB-rijen gefilterd)
  let allTodayRowsRaw = [];
  let from = 0; const step = 1000;
  while (true) {
    const { data: b } = await supabase
      .from('sales_data')
      .select('dept_code, dept_name, bum, net_sales, gross_margin')
      .eq('store_number', storeNumber)
      .eq('sale_date', reportDateStr)
      .range(from, from + step - 1);
    if (!b || !b.length) break;
    allTodayRowsRaw = allTodayRowsRaw.concat(b);
    if (b.length < step) break;
    from += step;
  }
  const allTodayRows = allTodayRowsRaw.filter(r => !(r.dept_code && r.dept_code.startsWith('FB')));
  const todaySales = allTodayRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const todayMargin = allTodayRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const todayMarginPct = todaySales ? (todayMargin / todaySales * 100) : 0;

  // 2. Vandaag LY (FB-rijen gefilterd)
  let lyTodayRowsRaw = [];
  from = 0;
  while (true) {
    const { data: b } = await supabase
      .from('sales_data')
      .select('dept_code, net_sales, gross_margin')
      .eq('store_number', storeNumber)
      .eq('sale_date', lyDateStr)
      .range(from, from + step - 1);
    if (!b || !b.length) break;
    lyTodayRowsRaw = lyTodayRowsRaw.concat(b);
    if (b.length < step) break;
    from += step;
  }
  const lyTodayRows = lyTodayRowsRaw.filter(r => !(r.dept_code && r.dept_code.startsWith('FB')));
  const lyTodaySales = lyTodayRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyTodayMargin = lyTodayRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const lyTodayMarginPct = lyTodaySales ? (lyTodayMargin / lyTodaySales * 100) : 0;

  // 3. MTD — directe sales_data aggregatie, real-time inclusief vandaag
  let mtdRowsRaw = [];
  const monthStartStr = `${curYear}-${String(curMonth).padStart(2,'0')}-01`;
  from = 0;
  while (true) {
    const { data: b } = await supabase
      .from('sales_data')
      .select('net_sales, gross_margin, dept_code')
      .eq('store_number', storeNumber)
      .gte('sale_date', monthStartStr)
      .lte('sale_date', reportDateStr)
      .range(from, from + step - 1);
    if (!b || !b.length) break;
    mtdRowsRaw = mtdRowsRaw.concat(b);
    if (b.length < step) break;
    from += step;
  }
  const mtdRows = mtdRowsRaw.filter(r => !(r.dept_code && r.dept_code.startsWith('FB')));
  const mtdSales = mtdRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const mtdMargin = mtdRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const mtdMarginPct = mtdSales ? (mtdMargin / mtdSales * 100) : 0;

  // 4. MTD LY (via sales_daily)
  let lyDailyMtdRows = [];
  from = 0;
  while (true) {
    const { data: b } = await supabase
      .from('sales_daily').select('net_sales, gross_margin, day')
      .eq('store_number', storeNumber).eq('year', lyYear).eq('month', curMonth)
      .lte('day', dayOfMonth).range(from, from + step - 1);
    if (!b || !b.length) break;
    lyDailyMtdRows = lyDailyMtdRows.concat(b);
    if (b.length < step) break;
    from += step;
  }
  const lyMTDSales = lyDailyMtdRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyMTDMargin = lyDailyMtdRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const lyMTDMarginPct = lyMTDSales ? (lyMTDMargin / lyMTDSales * 100) : 0;

  // 5. LY hele maand
  const { data: lyFullMonthRows } = await supabase
    .from('sales_monthly').select('net_sales, gross_margin')
    .eq('store_number', storeNumber).eq('year', lyYear).eq('month', curMonth);
  const lyFullMonthSales = (lyFullMonthRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);

  // 6. YTD — directe sales_data aggregatie, real-time inclusief vandaag
  let ytdRowsRaw = [];
  const yearStartStr = `${curYear}-01-01`;
  from = 0;
  while (true) {
    const { data: b } = await supabase
      .from('sales_data')
      .select('net_sales, gross_margin, dept_code')
      .eq('store_number', storeNumber)
      .gte('sale_date', yearStartStr)
      .lte('sale_date', reportDateStr)
      .range(from, from + step - 1);
    if (!b || !b.length) break;
    ytdRowsRaw = ytdRowsRaw.concat(b);
    if (b.length < step) break;
    from += step;
  }
  const ytdRowsFiltered = ytdRowsRaw.filter(r => !(r.dept_code && r.dept_code.startsWith('FB')));
  const ytdSales = ytdRowsFiltered.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const ytdMargin = ytdRowsFiltered.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const ytdMarginPct = ytdSales ? (ytdMargin / ytdSales * 100) : 0;

  // 7. LY YTD t/m zelfde dag
  const { data: lyYTDFullMonths } = await supabase
    .from('sales_monthly').select('net_sales, gross_margin')
    .eq('store_number', storeNumber).eq('year', lyYear).lt('month', curMonth);
  const lyYTDFullSales = (lyYTDFullMonths || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyYTDSales = lyYTDFullSales + lyMTDSales;
  const lyYTDMargin = (lyYTDFullMonths || []).reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0) + lyMTDMargin;
  const lyYTDMarginPct = lyYTDSales ? (lyYTDMargin / lyYTDSales * 100) : 0;

  // 8. LY hele jaar
  const { data: lyFullYearRows } = await supabase
    .from('sales_monthly').select('net_sales')
    .eq('store_number', storeNumber).eq('year', lyYear);
  const lyFullYearSales = (lyFullYearRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);

  // 9. Budget — paginated query (1.728 rijen overschrijdt Supabase default limit van 1000)
  let budgetRows = [];
  {
    let bFrom = 0; const bStep = 1000;
    while (true) {
      const { data: b } = await supabase
        .from('budget_data').select('month, amount, budget_type')
        .eq('store_number', storeNumber).like('month', `${curYear}-%`)
        .in('budget_type', ['target_sales', 'target_margin'])
        .range(bFrom, bFrom + bStep - 1);
      if (!b || !b.length) break;
      budgetRows = budgetRows.concat(b);
      if (b.length < bStep) break;
      bFrom += bStep;
    }
  }
  let monthBudgetSales = 0, monthBudgetMargin = 0;
  let fyBudgetSales = 0, fyBudgetMargin = 0;
  let mtdBudgetSales = 0;
  const monthlyBudget = Array(12).fill(0);
  budgetRows.forEach(b => {
    const [, bm] = b.month.split('-').map(Number);
    const amt = parseFloat(b.amount || 0);
    if (b.budget_type === 'target_sales') {
      fyBudgetSales += amt;
      monthlyBudget[bm - 1] += amt;
      if (bm === curMonth) monthBudgetSales += amt;
      if (bm <= curMonth) mtdBudgetSales += amt;
    } else if (b.budget_type === 'target_margin') {
      fyBudgetMargin += amt;
      if (bm === curMonth) monthBudgetMargin += amt;
    }
  });
  const ytdBudgetSales = (mtdBudgetSales - monthBudgetSales) + (monthBudgetSales * dayOfMonth / totalDaysInMonth);
  const dailyBudgetSales = monthBudgetSales / totalDaysInMonth;

  // 10. Forecast
  const runRateForecast = dayOfMonth > 0 ? (mtdSales / dayOfMonth) * totalDaysInMonth : 0;
  const lyPacingPct = lyFullMonthSales > 0 ? (lyMTDSales / lyFullMonthSales) : (dayOfMonth / totalDaysInMonth);
  const safePacing = (lyPacingPct <= 0.01 || lyPacingPct > 1) ? (dayOfMonth / totalDaysInMonth) : lyPacingPct;
  const lyPacingForecast = safePacing > 0 ? (mtdSales / safePacing) : 0;
  const fyRunRateForecast = dayOfYear > 0 ? (ytdSales / dayOfYear) * totalDaysInYear : 0;
  const fyLyPacingPct = lyFullYearSales ? (lyYTDSales / lyFullYearSales) : (dayOfYear / totalDaysInYear);
  const fyLyPacingForecast = fyLyPacingPct > 0 ? (ytdSales / fyLyPacingPct) : 0;

  // 11. Departementen vandaag + LY
  const deptAgg = {};
  allTodayRows.forEach(r => {
    if (!r.dept_code) return;
    if (!deptAgg[r.dept_code]) deptAgg[r.dept_code] = { dept_code: r.dept_code, dept_name: r.dept_name, sales: 0, margin: 0 };
    deptAgg[r.dept_code].sales += parseFloat(r.net_sales || 0);
    deptAgg[r.dept_code].margin += parseFloat(r.gross_margin || 0);
  });
  const lyDeptAgg = {};
  lyTodayRows.forEach(r => {
    if (!lyDeptAgg[r.dept_code]) lyDeptAgg[r.dept_code] = 0;
    lyDeptAgg[r.dept_code] += parseFloat(r.net_sales || 0);
  });
  const deptList = Object.values(deptAgg).map(d => ({
    ...d,
    ly: lyDeptAgg[d.dept_code] || 0,
    var_pct: lyDeptAgg[d.dept_code] ? ((d.sales - lyDeptAgg[d.dept_code]) / Math.abs(lyDeptAgg[d.dept_code]) * 100) : null,
    mgn_pct: d.sales ? (d.margin / d.sales * 100) : 0,
  }));
  const topByVolume = [...deptList].sort((a, b) => b.sales - a.sales).slice(0, 5);
  const worstVsLY = deptList.filter(d => d.var_pct !== null && d.var_pct < 0).sort((a, b) => a.var_pct - b.var_pct).slice(0, 5);

  // 12. BUM ranking
  const bumAgg = {};
  allTodayRows.forEach(r => {
    if (!r.bum || r.bum === 'OTHER') return;
    if (!bumAgg[r.bum]) bumAgg[r.bum] = { bum: r.bum, sales: 0, margin: 0 };
    bumAgg[r.bum].sales += parseFloat(r.net_sales || 0);
    bumAgg[r.bum].margin += parseFloat(r.gross_margin || 0);
  });
  const bumRanking = Object.values(bumAgg).sort((a, b) => b.sales - a.sales);

  // 13. Monthly arrays
  const { data: cyAllMonths } = await supabase
    .from('sales_monthly').select('month, net_sales')
    .eq('store_number', storeNumber).eq('year', curYear);
  const { data: lyAllMonths } = await supabase
    .from('sales_monthly').select('month, net_sales')
    .eq('store_number', storeNumber).eq('year', lyYear);
  const monthlyCY = Array(12).fill(0);
  const monthlyLY = Array(12).fill(0);
  (cyAllMonths || []).forEach(r => { monthlyCY[r.month - 1] += parseFloat(r.net_sales || 0); });
  (lyAllMonths || []).forEach(r => { monthlyLY[r.month - 1] += parseFloat(r.net_sales || 0); });

  return {
    storeNumber, storeLabel: STORE_LABELS[storeNumber] || storeNumber,
    reportDate, curYear, curMonth, dayOfMonth, totalDaysInMonth,
    todaySales, todayMargin, todayMarginPct,
    lyTodaySales, lyTodayMargin, lyTodayMarginPct, dailyBudgetSales,
    mtdSales, mtdMargin, mtdMarginPct, lyMTDSales, lyMTDMargin, lyMTDMarginPct, monthBudgetSales,
    ytdSales, ytdMargin, ytdMarginPct, lyYTDSales, lyYTDMargin, lyYTDMarginPct,
    fyBudgetSales, ytdBudgetSales,
    runRateForecast, lyPacingForecast, fyRunRateForecast, fyLyPacingForecast,
    lyFullMonthSales,
    topByVolume, worstVsLY, bumRanking,
    monthlyCY, monthlyLY, monthlyBudget,
  };
}

function StoreSection({ r }) {
  const todayVsLY = pctChg(r.todaySales, r.lyTodaySales);
  const todayVsBudget = pctChg(r.todaySales, r.dailyBudgetSales);
  const mtdVsLY = pctChg(r.mtdSales, r.lyMTDSales);
  const mtdBudgetExpected = r.monthBudgetSales * (r.dayOfMonth / r.totalDaysInMonth);
  const mtdVsBudget = pctChg(r.mtdSales, mtdBudgetExpected);
  const ytdVsLY = pctChg(r.ytdSales, r.lyYTDSales);
  const ytdVsBudget = pctChg(r.ytdSales, r.ytdBudgetSales);
  const fcstVsBudget = pctChg(r.lyPacingForecast, r.monthBudgetSales);
  const fyFcstVsBudget = pctChg(r.fyLyPacingForecast, r.fyBudgetSales);

  // Chart.js canvas ref + useEffect om chart te bouwen/destroyen
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;
    // Cleanup vorige chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }
    // TY waarden: alleen tonen voor maanden tot en met de huidige
    const tyValues = r.monthlyCY.map((v, i) => (i + 1 <= r.curMonth ? Math.round(v) : null));
    const lyValues = r.monthlyLY.map(v => Math.round(v));
    const bdValues = r.monthlyBudget.map(v => Math.round(v));

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: MN,
        datasets: [
          {
            label: r.curYear + ' TY',
            data: tyValues,
            backgroundColor: 'rgba(232,78,27,0.25)',
            borderColor: '#E84E1B',
            borderWidth: 1,
            borderRadius: 4,
            order: 2,
          },
          {
            label: (r.curYear - 1) + ' LY',
            data: lyValues,
            type: 'line',
            borderColor: '#888',
            borderDash: [5, 5],
            pointBackgroundColor: '#888',
            pointRadius: 4,
            tension: 0.3,
            fill: false,
            order: 1,
          },
          {
            label: r.curYear + ' Budget',
            data: bdValues,
            type: 'line',
            borderColor: '#d97706',
            borderDash: [3, 3],
            pointBackgroundColor: '#d97706',
            pointRadius: 4,
            tension: 0.3,
            fill: false,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}` } },
        },
        scales: {
          y: { ticks: { callback: v => fmtM(v) }, grid: { color: '#f0ebe5' } },
          x: { grid: { display: false } },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [r]);

  return (
    <div className="mb-8">
      <h2 className="text-[24px] font-black mb-1" style={{ fontFamily: "'Playfair Display',Georgia,serif" }}>{r.storeLabel}</h2>
      <p className="text-[13px] text-[#6b5240] mb-4">Dag {r.dayOfMonth} van {r.totalDaysInMonth} · {MN[r.curMonth-1]} {r.curYear}</p>

      {/* Vandaag */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-5 mb-4">
        <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide mb-3">Vandaag ({fmtDateLong(r.reportDate)})</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-[#6b5240] uppercase tracking-wide font-semibold">Omzet</p>
            <p className="font-mono text-[28px] font-bold text-[#1a0a04]">{fmt(r.todaySales)}</p>
            <p className="text-[12px] text-[#6b5240] font-mono mt-1">LY: {fmt(r.lyTodaySales)} <Badge pct={todayVsLY} /></p>
            <p className="text-[12px] text-[#6b5240] font-mono">Budget: {fmt(r.dailyBudgetSales)} <Badge pct={todayVsBudget} /></p>
          </div>
          <div>
            <p className="text-[11px] text-[#6b5240] uppercase tracking-wide font-semibold">Bruto Marge</p>
            <p className="font-mono text-[28px] font-bold text-[#1a0a04]">{fmt(r.todayMargin)} <span className="text-[16px] text-[#6b5240]">({fmtP(r.todayMarginPct)})</span></p>
            <p className="text-[12px] text-[#6b5240] font-mono mt-1">LY: {fmt(r.lyTodayMargin)} ({fmtP(r.lyTodayMarginPct)})</p>
          </div>
        </div>
      </div>

      {/* MTD + YTD + Forecast grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* MTD */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-4">
          <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide mb-3">Month-To-Date</p>
          <p className="font-mono text-[20px] font-bold">{fmtM(r.mtdSales)}</p>
          <p className="text-[11px] text-[#6b5240] mt-2 font-mono">LY: {fmtM(r.lyMTDSales)} <Badge pct={mtdVsLY} /></p>
          <p className="text-[11px] text-[#6b5240] font-mono">Bud pace: {fmtM(mtdBudgetExpected)} <Badge pct={mtdVsBudget} /></p>
          <p className="text-[11px] text-[#6b5240] font-mono mt-2 pt-2 border-t border-[#e5ddd4]">Marge: {fmtM(r.mtdMargin)} ({fmtP(r.mtdMarginPct)})</p>
        </div>
        {/* YTD */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-4">
          <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide mb-3">Year-To-Date</p>
          <p className="font-mono text-[20px] font-bold">{fmtM(r.ytdSales)}</p>
          <p className="text-[11px] text-[#6b5240] mt-2 font-mono">LY: {fmtM(r.lyYTDSales)} <Badge pct={ytdVsLY} /></p>
          <p className="text-[11px] text-[#6b5240] font-mono">Bud pace: {fmtM(r.ytdBudgetSales)} <Badge pct={ytdVsBudget} /></p>
          <p className="text-[11px] text-[#6b5240] font-mono mt-2 pt-2 border-t border-[#e5ddd4]">Marge: {fmtM(r.ytdMargin)} ({fmtP(r.ytdMarginPct)})</p>
        </div>
        {/* Forecast */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-4">
          <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide mb-1">Forecast <span className="italic font-normal text-[#d97706] normal-case">(concept)</span></p>
          <p className="text-[10px] text-[#6b5240] mb-3">Maand-eindstand</p>
          <p className="font-mono text-[18px] font-bold">{fmtM(r.lyPacingForecast)}</p>
          <p className="text-[10px] text-[#6b5240] font-mono">Run rate: {fmtM(r.runRateForecast)}</p>
          <p className="text-[10px] text-[#6b5240] font-mono mt-1">Budget: {fmtM(r.monthBudgetSales)} <Badge pct={fcstVsBudget} /></p>
          <p className="text-[11px] text-[#6b5240] font-mono mt-2 pt-2 border-t border-[#e5ddd4]">FY: {fmtM(r.fyLyPacingForecast)} vs {fmtM(r.fyBudgetSales)} <Badge pct={fyFcstVsBudget} /></p>
        </div>
      </div>

      {/* Monthly chart */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-4 mb-4">
        <p className="text-[13px] font-bold mb-3">Maandelijkse Omzet — TY vs LY vs Budget</p>
        <div style={{ height: 280 }}>
          <canvas ref={chartRef} />
        </div>
      </div>

      {/* Tabellen */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {r.topByVolume.length > 0 && (
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Top 5 Departementen (vandaag)</p>
            </div>
            <table className="w-full">
              <tbody>
                {r.topByVolume.map(d => (
                  <tr key={d.dept_code}>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4]">{d.dept_name}</td>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(d.sales)}</td>
                    <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-right text-[#6b5240]">{fmtP(d.mgn_pct)} BM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.worstVsLY.length > 0 && (
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
            <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
              <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Aandachtspunten (slechtste vs LY)</p>
            </div>
            <table className="w-full">
              <tbody>
                {r.worstVsLY.map(d => (
                  <tr key={d.dept_code}>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4]">{d.dept_name}</td>
                    <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.sales)} / LY {fmt(d.ly)}</td>
                    <td className="p-2 border-b border-[#e5ddd4] text-right"><Badge pct={d.var_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* BUM ranking */}
      {r.bumRanking.length > 0 && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-4">
          <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
            <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">BUM Ranking (vandaag)</p>
          </div>
          <table className="w-full">
            <tbody>
              {r.bumRanking.map((b, i) => (
                <tr key={b.bum}>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-semibold">{i+1}. {b.bum}</td>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] text-right font-mono">{fmt(b.sales)}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-right text-[#6b5240]">
                    {b.sales ? fmtP(b.margin/b.sales*100) : '—'} BM
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DailyReportContent() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reportDate, setReportDate] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let d;
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          d = new Date(dateParam + 'T12:00:00');
        } else {
          d = new Date();
          d.setHours(12, 0, 0, 0);
        }
        if (cancelled) return;
        setReportDate(d);
        const r1 = await fetchStoreReport(supabase, '1', d);
        const rB = await fetchStoreReport(supabase, 'B', d);
        if (cancelled) return;
        setReports([r1, rB]);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateParam]);

  if (loading) return <LoadingLogo text="Rapport laden..." />;
  if (error) {
    return (
      <div className="max-w-[800px] mx-auto py-12">
        <p className="text-[15px] text-red-700">Fout: {error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>
      <div className="mb-6">
        <h1 className="text-[28px] font-black" style={{ fontFamily: "'Playfair Display',Georgia,serif" }}>Daily Report</h1>
        <p className="text-[14px] text-[#6b5240]">{reportDate ? fmtDateLong(reportDate) : ''}</p>
      </div>
      {reports.map(r => <StoreSection key={r.storeNumber} r={r} />)}
    </div>
  );
}

// Wrapper met Suspense boundary - vereist door Next.js 14 voor pagina's die useSearchParams gebruiken
export default function DailyReportPage() {
  return (
    <Suspense fallback={<LoadingLogo text="Rapport laden..." />}>
      <DailyReportContent />
    </Suspense>
  );
}
