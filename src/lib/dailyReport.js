/* ============================================================
   BESTAND: dailyReport.js
   KOPIEER NAAR: src/lib/dailyReport.js
   (nieuw bestand)

   Shared logica voor:
   - Data ophalen voor het dagrapport (per store)
   - HTML email template renderen
   - Wordt gebruikt door zowel /api/cron/daily-report
     als /dashboard/sales/daily-report

   Werkt met service role client als input (server-side).
   ============================================================ */

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

export const STORE_LABELS = { '1': 'Curaçao', 'B': 'Bonaire' };

const fmt = n => (Number(n) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtM = n => {
  const a = Math.abs(Number(n) || 0);
  return (n < 0 ? '-' : '') + (a >= 1e6 ? (a/1e6).toFixed(2) + 'M' : (a/1e3).toFixed(0) + 'K');
};
const fmtP = n => (Number(n) || 0).toFixed(1) + '%';
const pctChg = (c, p) => p ? ((c - p) / Math.abs(p) * 100) : 0;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

/**
 * Haalt alle data op voor het dagrapport voor één store.
 * Gebruikt sales_daily voor dag-niveau pacing (echte LY patterns).
 *
 * @param supabase service-role client
 * @param storeNumber '1' of 'B'
 * @param reportDate Date object (welke dag is "vandaag" in het rapport)
 */
export async function getDailyReportData(supabase, storeNumber, reportDate) {
  const reportDateStr = reportDate.toISOString().slice(0, 10);
  const curYear = reportDate.getFullYear();
  const curMonth = reportDate.getMonth() + 1;
  const dayOfMonth = reportDate.getDate();
  const totalDaysInMonth = daysInMonth(curYear, curMonth);
  const lyYear = curYear - 1;

  // === 1. Vandaag (per dept) ===
  let allTodayRows = [];
  {
    let from = 0; const step = 1000;
    while (true) {
      const { data: b } = await supabase
        .from('sales_data')
        .select('dept_code, dept_name, bum, net_sales, gross_margin')
        .eq('store_number', storeNumber)
        .eq('sale_date', reportDateStr)
        .range(from, from + step - 1);
      if (!b || !b.length) break;
      allTodayRows = allTodayRows.concat(b);
      if (b.length < step) break;
      from += step;
    }
  }
  const todaySales = allTodayRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const todayMargin = allTodayRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const todayMarginPct = todaySales ? (todayMargin / todaySales * 100) : 0;

  // === 2. Vandaag LY (zelfde dag vorig jaar) ===
  const lyDateStr = `${lyYear}-${String(curMonth).padStart(2,'0')}-${String(dayOfMonth).padStart(2,'0')}`;
  let lyTodayRows = [];
  {
    let from = 0; const step = 1000;
    while (true) {
      const { data: b } = await supabase
        .from('sales_data')
        .select('net_sales, gross_margin')
        .eq('store_number', storeNumber)
        .eq('sale_date', lyDateStr)
        .range(from, from + step - 1);
      if (!b || !b.length) break;
      lyTodayRows = lyTodayRows.concat(b);
      if (b.length < step) break;
      from += step;
    }
  }
  const lyTodaySales = lyTodayRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyTodayMargin = lyTodayRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const lyTodayMarginPct = lyTodaySales ? (lyTodayMargin / lyTodaySales * 100) : 0;

  // === 3. MTD t/m vandaag ===
  // Sales_monthly heeft de hele huidige maand al op cum stand t/m laatste data
  const { data: cyMonthRows } = await supabase
    .from('sales_monthly')
    .select('net_sales, gross_margin')
    .eq('store_number', storeNumber)
    .eq('year', curYear)
    .eq('month', curMonth);
  const mtdSales = (cyMonthRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const mtdMargin = (cyMonthRows || []).reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const mtdMarginPct = mtdSales ? (mtdMargin / mtdSales * 100) : 0;

  // === 4. MTD LY t/m zelfde dag (gebruik sales_daily voor echte pacing) ===
  let lyDailyMtdRows = [];
  {
    let from = 0; const step = 1000;
    while (true) {
      const { data: b } = await supabase
        .from('sales_daily')
        .select('net_sales, gross_margin, day')
        .eq('store_number', storeNumber)
        .eq('year', lyYear)
        .eq('month', curMonth)
        .lte('day', dayOfMonth)
        .range(from, from + step - 1);
      if (!b || !b.length) break;
      lyDailyMtdRows = lyDailyMtdRows.concat(b);
      if (b.length < step) break;
      from += step;
    }
  }
  const lyMTDSales = lyDailyMtdRows.reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyMTDMargin = lyDailyMtdRows.reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const lyMTDMarginPct = lyMTDSales ? (lyMTDMargin / lyMTDSales * 100) : 0;

  // === 5. LY hele maand ===
  const { data: lyFullMonthRows } = await supabase
    .from('sales_monthly')
    .select('net_sales, gross_margin')
    .eq('store_number', storeNumber)
    .eq('year', lyYear)
    .eq('month', curMonth);
  const lyFullMonthSales = (lyFullMonthRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);

  // === 6. YTD ===
  const { data: ytdRows } = await supabase
    .from('sales_monthly')
    .select('net_sales, gross_margin, month')
    .eq('store_number', storeNumber)
    .eq('year', curYear)
    .lte('month', curMonth);
  const ytdSales = (ytdRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const ytdMargin = (ytdRows || []).reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const ytdMarginPct = ytdSales ? (ytdMargin / ytdSales * 100) : 0;

  // === 7. LY YTD t/m zelfde dag ===
  // Volle vorige maanden + huidige maand pro-rated via lyMTDSales
  const { data: lyYTDFullMonths } = await supabase
    .from('sales_monthly')
    .select('net_sales, gross_margin')
    .eq('store_number', storeNumber)
    .eq('year', lyYear)
    .lt('month', curMonth);
  const lyYTDFullSales = (lyYTDFullMonths || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);
  const lyYTDFullMargin = (lyYTDFullMonths || []).reduce((s, r) => s + parseFloat(r.gross_margin || 0), 0);
  const lyYTDSales = lyYTDFullSales + lyMTDSales;
  const lyYTDMargin = lyYTDFullMargin + lyMTDMargin;
  const lyYTDMarginPct = lyYTDSales ? (lyYTDMargin / lyYTDSales * 100) : 0;

  // === 8. LY hele jaar ===
  const { data: lyFullYearRows } = await supabase
    .from('sales_monthly')
    .select('net_sales')
    .eq('store_number', storeNumber)
    .eq('year', lyYear);
  const lyFullYearSales = (lyFullYearRows || []).reduce((s, r) => s + parseFloat(r.net_sales || 0), 0);

  // === 9. Budget — target budget voor maand en FY ===
  const { data: budgetRows } = await supabase
    .from('budget_data')
    .select('month, amount, budget_type')
    .eq('store_number', storeNumber)
    .like('month', `${curYear}-%`)
    .in('budget_type', ['target_sales', 'target_margin']);
  let monthBudgetSales = 0, monthBudgetMargin = 0;
  let fyBudgetSales = 0, fyBudgetMargin = 0;
  let mtdBudgetSales = 0, mtdBudgetMargin = 0;  // cumulatief budget tot huidige maand
  (budgetRows || []).forEach(b => {
    const [by, bm] = b.month.split('-').map(Number);
    const amt = parseFloat(b.amount || 0);
    if (b.budget_type === 'target_sales') {
      fyBudgetSales += amt;
      if (bm === curMonth) monthBudgetSales += amt;
      if (bm <= curMonth) mtdBudgetSales += amt;
    } else if (b.budget_type === 'target_margin') {
      fyBudgetMargin += amt;
      if (bm === curMonth) monthBudgetMargin += amt;
      if (bm <= curMonth) mtdBudgetMargin += amt;
    }
  });
  // YTD budget = cumulatief budget volledige maanden + pro-rated huidige maand op dag-niveau
  const ytdBudgetSales = (mtdBudgetSales - monthBudgetSales) + (monthBudgetSales * dayOfMonth / totalDaysInMonth);
  const ytdBudgetMargin = (mtdBudgetMargin - monthBudgetMargin) + (monthBudgetMargin * dayOfMonth / totalDaysInMonth);
  // Daily budget = monthBudget / daysInMonth (linear)
  const dailyBudgetSales = monthBudgetSales / totalDaysInMonth;
  const dailyBudgetMargin = monthBudgetMargin / totalDaysInMonth;

  // === 10. Forecast — Run rate & Verkooppatroon LY ===
  const runRateForecast = dayOfMonth > 0 ? (mtdSales / dayOfMonth) * totalDaysInMonth : 0;
  // LY pacing pct = hoeveel % van LY hele maand was er op dag X gerealiseerd
  const lyPacingPct = lyFullMonthSales > 0
    ? (lyMTDSales / lyFullMonthSales)
    : (dayOfMonth / totalDaysInMonth);
  const safePacing = (lyPacingPct <= 0.01 || lyPacingPct > 1) ? (dayOfMonth / totalDaysInMonth) : lyPacingPct;
  const lyPacingForecast = safePacing > 0 ? (mtdSales / safePacing) : 0;

  // FY forecast
  const dayOfYear = Math.floor((reportDate - new Date(curYear, 0, 0)) / (1000 * 60 * 60 * 24));
  const totalDaysInYear = daysInMonth(curYear, 2) === 29 ? 366 : 365;
  const fyRunRateForecast = dayOfYear > 0 ? (ytdSales / dayOfYear) * totalDaysInYear : 0;
  const fyLyPacingPct = lyFullYearSales ? (lyYTDSales / lyFullYearSales) : (dayOfYear / totalDaysInYear);
  const fyLyPacingForecast = fyLyPacingPct > 0 ? (ytdSales / fyLyPacingPct) : 0;

  // === 11. Top performers vs LY (departementen) ===
  const deptAgg = {};
  allTodayRows.forEach(r => {
    if (!r.dept_code) return;
    const key = r.dept_code;
    if (!deptAgg[key]) deptAgg[key] = { dept_code: r.dept_code, dept_name: r.dept_name, sales: 0, margin: 0 };
    deptAgg[key].sales += parseFloat(r.net_sales || 0);
    deptAgg[key].margin += parseFloat(r.gross_margin || 0);
  });
  // LY sales per dept op dezelfde dag
  let lyDeptRows = [];
  {
    let from = 0; const step = 1000;
    while (true) {
      const { data: b } = await supabase
        .from('sales_data')
        .select('dept_code, net_sales')
        .eq('store_number', storeNumber)
        .eq('sale_date', lyDateStr)
        .range(from, from + step - 1);
      if (!b || !b.length) break;
      lyDeptRows = lyDeptRows.concat(b);
      if (b.length < step) break;
      from += step;
    }
  }
  const lyDeptAgg = {};
  lyDeptRows.forEach(r => {
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
  const worstVsLY = deptList
    .filter(d => d.var_pct !== null && d.var_pct < 0)
    .sort((a, b) => a.var_pct - b.var_pct).slice(0, 5);

  // === 12. BUM ranking vandaag ===
  const bumAgg = {};
  allTodayRows.forEach(r => {
    if (!r.bum || r.bum === 'OTHER') return;
    if (!bumAgg[r.bum]) bumAgg[r.bum] = { bum: r.bum, sales: 0, margin: 0 };
    bumAgg[r.bum].sales += parseFloat(r.net_sales || 0);
    bumAgg[r.bum].margin += parseFloat(r.gross_margin || 0);
  });
  const bumRanking = Object.values(bumAgg).sort((a, b) => b.sales - a.sales);

  // === 13. Maandelijks overzicht (huidige + LY) voor chart-data referentie ===
  const { data: cyAllMonths } = await supabase
    .from('sales_monthly')
    .select('month, net_sales')
    .eq('store_number', storeNumber)
    .eq('year', curYear);
  const { data: lyAllMonths } = await supabase
    .from('sales_monthly')
    .select('month, net_sales')
    .eq('store_number', storeNumber)
    .eq('year', lyYear);
  const monthlyCY = Array(12).fill(0);
  const monthlyLY = Array(12).fill(0);
  const monthlyBudget = Array(12).fill(0);
  (cyAllMonths || []).forEach(r => { monthlyCY[r.month - 1] += parseFloat(r.net_sales || 0); });
  (lyAllMonths || []).forEach(r => { monthlyLY[r.month - 1] += parseFloat(r.net_sales || 0); });
  (budgetRows || []).filter(b => b.budget_type === 'target_sales').forEach(b => {
    const [, bm] = b.month.split('-').map(Number);
    monthlyBudget[bm - 1] += parseFloat(b.amount || 0);
  });

  return {
    storeNumber,
    storeLabel: STORE_LABELS[storeNumber] || storeNumber,
    reportDate, reportDateStr,
    curYear, curMonth, dayOfMonth, totalDaysInMonth, lyYear,
    dayOfYear, totalDaysInYear,
    // Vandaag
    todaySales, todayMargin, todayMarginPct,
    lyTodaySales, lyTodayMargin, lyTodayMarginPct,
    dailyBudgetSales, dailyBudgetMargin,
    // MTD
    mtdSales, mtdMargin, mtdMarginPct,
    lyMTDSales, lyMTDMargin, lyMTDMarginPct,
    monthBudgetSales, monthBudgetMargin,
    // YTD
    ytdSales, ytdMargin, ytdMarginPct,
    lyYTDSales, lyYTDMargin, lyYTDMarginPct,
    fyBudgetSales, fyBudgetMargin,
    ytdBudgetSales, ytdBudgetMargin,
    // Forecast
    runRateForecast, lyPacingForecast, lyPacingPct: safePacing,
    fyRunRateForecast, fyLyPacingForecast,
    // Vergelijkingen
    lyFullMonthSales, lyFullYearSales,
    // Top performers
    topByVolume, worstVsLY, bumRanking,
    // Chart data
    monthlyCY, monthlyLY, monthlyBudget,
  };
}

/**
 * Genereert volledige HTML email body.
 * Twee secties: Curaçao + Bonaire, elk met alle data.
 *
 * @param storeReports array van getDailyReportData uitkomsten
 * @param siteUrl bv. 'https://www.boomingsolutions.ai'
 */
export function renderEmailHTML(storeReports, siteUrl) {
  const reportDate = storeReports[0].reportDate;
  const dateLabel = `${reportDate.getDate()} ${MN[reportDate.getMonth()]} ${reportDate.getFullYear()}`;
  const dashboardUrl = `${siteUrl}/dashboard/sales/daily-report?date=${storeReports[0].reportDateStr}`;

  // CSS inline want email clients negeren meestal <style>
  const colors = {
    navy: '#1B3A5C', orange: '#E84E1B', text: '#1a0a04', mute: '#6b5240',
    border: '#e5ddd4', bg: '#faf7f4', green: '#16a34a', red: '#dc2626',
    amber: '#d97706', soft: '#fafaf8',
  };

  function badge(pct, inverse = false) {
    if (pct === null || pct === undefined) return '';
    const positive = inverse ? pct < 0 : pct >= 0;
    const bg = positive ? '#dcfce7' : '#fee2e2';
    const tx = positive ? colors.green : colors.red;
    const sign = pct >= 0 ? '+' : '';
    return `<span style="background:${bg};color:${tx};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:monospace;">${sign}${fmtP(pct)}</span>`;
  }

  function storeSection(r) {
    // Vandaag vs LY en Budget
    const todayVsLY = pctChg(r.todaySales, r.lyTodaySales);
    const todayVsBudget = pctChg(r.todaySales, r.dailyBudgetSales);
    // MTD vs LY en Budget
    const mtdVsLY = pctChg(r.mtdSales, r.lyMTDSales);
    const mtdVsBudgetExpected = r.monthBudgetSales * (r.dayOfMonth / r.totalDaysInMonth);
    const mtdVsBudget = pctChg(r.mtdSales, mtdVsBudgetExpected);
    // YTD vs LY en Budget
    const ytdVsLY = pctChg(r.ytdSales, r.lyYTDSales);
    const ytdVsBudget = pctChg(r.ytdSales, r.ytdBudgetSales);
    // Forecast vs budget
    const fcstVsBudget = pctChg(r.lyPacingForecast, r.monthBudgetSales);
    const fyFcstVsBudget = pctChg(r.fyLyPacingForecast, r.fyBudgetSales);

    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
      <tr>
        <td>
          <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:900;color:${colors.text};margin:0 0 4px 0;">${r.storeLabel}</h2>
          <p style="font-size:12px;color:${colors.mute};margin:0 0 16px 0;">Dag ${r.dayOfMonth} van ${r.totalDaysInMonth} · ${MN[r.curMonth-1]} ${r.curYear}</p>

          <!-- VANDAAG -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Vandaag (${dateLabel})</p>
            </td></tr>
            <tr><td style="padding:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="width:50%;padding-right:8px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">Omzet</p>
                    <p style="margin:4px 0;font-family:monospace;font-size:24px;font-weight:700;color:${colors.text};">${fmt(r.todaySales)}</p>
                    <p style="margin:2px 0;font-size:11px;color:${colors.mute};font-family:monospace;">LY: ${fmt(r.lyTodaySales)} ${badge(todayVsLY)}</p>
                    <p style="margin:2px 0;font-size:11px;color:${colors.mute};font-family:monospace;">Bud: ${fmt(r.dailyBudgetSales)} ${badge(todayVsBudget)}</p>
                  </td>
                  <td style="width:50%;padding-left:8px;vertical-align:top;">
                    <p style="margin:0;font-size:11px;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">Bruto Marge</p>
                    <p style="margin:4px 0;font-family:monospace;font-size:24px;font-weight:700;color:${colors.text};">${fmt(r.todayMargin)} <span style="font-size:14px;color:${colors.mute};">(${fmtP(r.todayMarginPct)})</span></p>
                    <p style="margin:2px 0;font-size:11px;color:${colors.mute};font-family:monospace;">LY: ${fmt(r.lyTodayMargin)} (${fmtP(r.lyTodayMarginPct)})</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- MTD -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Month-To-Date</p>
            </td></tr>
            <tr><td style="padding:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">Omzet MTD</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.mtdSales)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">vs LY (${fmtM(r.lyMTDSales)})</td>
                  <td style="padding:6px 0;text-align:right;">${badge(mtdVsLY)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">vs Budget pace (${fmtM(mtdVsBudgetExpected)})</td>
                  <td style="padding:6px 0;text-align:right;">${badge(mtdVsBudget)}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid ${colors.border};padding:0;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">Marge MTD</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.mtdMargin)} (${fmtP(r.mtdMarginPct)})</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">Marge % LY</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;">${fmtP(r.lyMTDMarginPct)}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- YTD -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Year-To-Date</p>
            </td></tr>
            <tr><td style="padding:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">Omzet YTD</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.ytdSales)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">vs LY (${fmtM(r.lyYTDSales)})</td>
                  <td style="padding:6px 0;text-align:right;">${badge(ytdVsLY)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">vs Budget pace (${fmtM(r.ytdBudgetSales)})</td>
                  <td style="padding:6px 0;text-align:right;">${badge(ytdVsBudget)}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid ${colors.border};padding:0;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">Marge YTD</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.ytdMargin)} (${fmtP(r.ytdMarginPct)})</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- FORECAST -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Forecast <span style="font-weight:400;font-style:italic;color:${colors.amber};">(concept)</span></p>
            </td></tr>
            <tr><td style="padding:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">${MN[r.curMonth-1]} — Run rate</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.runRateForecast)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">${MN[r.curMonth-1]} — Verkooppatroon LY</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.lyPacingForecast)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">${MN[r.curMonth-1]} — Budget</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;">${fmtM(r.monthBudgetSales)} ${badge(fcstVsBudget)}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid ${colors.border};padding:0;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">FY — Run rate</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.fyRunRateForecast)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">FY — Verkooppatroon LY</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${fmtM(r.fyLyPacingForecast)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:${colors.mute};">FY — Budget</td>
                  <td style="padding:6px 0;text-align:right;font-family:monospace;">${fmtM(r.fyBudgetSales)} ${badge(fyFcstVsBudget)}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- TOP 5 -->
          ${r.topByVolume.length ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Top 5 Departementen (vandaag)</p>
            </td></tr>
            <tr><td style="padding:8px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;">
                ${r.topByVolume.map(d => `
                <tr>
                  <td style="padding:6px 0;color:${colors.text};border-bottom:1px solid ${colors.border};">${d.dept_name}</td>
                  <td style="padding:6px 8px 6px 0;text-align:right;font-family:monospace;border-bottom:1px solid ${colors.border};">${fmt(d.sales)}</td>
                  <td style="padding:6px 0;text-align:right;border-bottom:1px solid ${colors.border};font-size:11px;color:${colors.mute};">${fmtP(d.mgn_pct)} BM</td>
                </tr>`).join('')}
              </table>
            </td></tr>
          </table>` : ''}

          <!-- ZORGENKINDJES -->
          ${r.worstVsLY.length ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">Aandachtspunten (slechtste vs LY)</p>
            </td></tr>
            <tr><td style="padding:8px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;">
                ${r.worstVsLY.map(d => `
                <tr>
                  <td style="padding:6px 0;color:${colors.text};border-bottom:1px solid ${colors.border};">${d.dept_name}</td>
                  <td style="padding:6px 8px 6px 0;text-align:right;font-family:monospace;border-bottom:1px solid ${colors.border};">${fmt(d.sales)} (LY: ${fmt(d.ly)})</td>
                  <td style="padding:6px 0;text-align:right;border-bottom:1px solid ${colors.border};">${badge(d.var_pct)}</td>
                </tr>`).join('')}
              </table>
            </td></tr>
          </table>` : ''}

          <!-- BUM RANKING -->
          ${r.bumRanking.length ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${colors.border};border-radius:8px;margin-bottom:16px;background:#fff;">
            <tr><td style="padding:12px 16px;background:${colors.bg};border-bottom:1px solid ${colors.border};">
              <p style="margin:0;font-size:11px;font-weight:700;color:${colors.mute};text-transform:uppercase;letter-spacing:0.6px;">BUM Ranking (vandaag)</p>
            </td></tr>
            <tr><td style="padding:8px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;">
                ${r.bumRanking.map((b, i) => `
                <tr>
                  <td style="padding:6px 0;color:${colors.text};border-bottom:1px solid ${colors.border};font-weight:600;">${i+1}. ${b.bum}</td>
                  <td style="padding:6px 8px 6px 0;text-align:right;font-family:monospace;border-bottom:1px solid ${colors.border};">${fmt(b.sales)}</td>
                  <td style="padding:6px 0;text-align:right;border-bottom:1px solid ${colors.border};font-size:11px;color:${colors.mute};">${b.sales ? fmtP(b.margin/b.sales*100) : '—'} BM</td>
                </tr>`).join('')}
              </table>
            </td></tr>
          </table>` : ''}
        </td>
      </tr>
    </table>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Building Depot Daily Report — ${dateLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f3f0eb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f0eb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1B3A5C 0%,#152238 100%);padding:24px;">
          <h1 style="margin:0;color:#fff;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:900;">Building Depot Daily Report</h1>
          <p style="margin:4px 0 0 0;color:rgba(255,255,255,0.7);font-size:13px;">${dateLabel}</p>
        </td></tr>

        <!-- Content -->
        <tr><td style="padding:24px;">
          ${storeReports.map(storeSection).join('')}

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:16px;">
            <tr><td align="center">
              <a href="${dashboardUrl}" style="display:inline-block;background:${colors.orange};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:14px;">
                Bekijk volledig rapport in dashboard →
              </a>
              <p style="margin:8px 0 0 0;font-size:11px;color:${colors.mute};">Inclusief grafieken, vergelijkingen per maand en alle detail-data</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:${colors.bg};padding:16px 24px;border-top:1px solid ${colors.border};">
          <p style="margin:0;font-size:11px;color:${colors.mute};text-align:center;">
            Automatisch gegenereerd door Booming Solutions · <a href="${siteUrl}" style="color:${colors.mute};">boomingsolutions.ai</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `;
}
