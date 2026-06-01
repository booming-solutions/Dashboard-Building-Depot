// =============================================================================
//  StatementsDashboard.jsx
//  Bestemming (App Router):  app/finance/statements/page.js  ->  rename naar page.js
//        of als component:   components/finance/StatementsDashboard.jsx
//  Data:   statements-data.json  ->  zelfde map als deze component
//          (dus app/finance/statements/statements-data.json)
//          (of /public en pas de import aan)
//
//  Building Depot — P&L / Balans / Kasstroom dashboard
//  Bron: GL-exports 2022–2026 + mapping (ruwe GL, v1). Bedragen in × 1.000 XCG.
//  NB: ruwe GL wijkt licht af van de gereclasseerde aandeelhoudersrapportage.
// =============================================================================
'use client';

import React, { useMemo, useState } from 'react';
import DATA from './statements-data.json';

/* ----------------------------- data helpers ------------------------------ */
const META = DATA.meta;
const ROWS = DATA.rows;
const YEARS = META.years;                       // ['2022'...'2026']
const PERIODS = META.periodsAvailable;          // { '2026': 5, ... }
const ENTITY_NAMES = META.entityNames || {};
const ENTITIES = ['CONS', ...META.entities];

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// ending balance (B) or cumulative (P) at period p; for P+month -> movement
function val(r, y, p, mode) {
  y = String(y);
  const arr = r.m[y];
  if (!arr) return 0;
  const end = arr[p - 1] || 0;
  if (r.t === 'B' || mode === 'ytd') return end;
  const prev = p === 1 ? (r.b[y] || 0) : (arr[p - 2] || 0);
  return end - prev;
}
// movement of a balance item over the selected window (for cashflow)
function delta(r, y, p, mode) {
  y = String(y);
  const arr = r.m[y];
  if (!arr) return 0;
  const end = arr[p - 1] || 0;
  const start = mode === 'ytd'
    ? (r.b[y] || 0)
    : (p === 1 ? (r.b[y] || 0) : (arr[p - 2] || 0));
  return end - start;
}

function makeAgg(entity) {
  const pool = entity === 'CONS' ? ROWS : ROWS.filter((r) => r.e === entity);
  return {
    pool,
    sum(pred, y, p, mode) {
      let s = 0;
      for (const r of pool) if (pred(r)) s += val(r, y, p, mode);
      return s;
    },
    sumDelta(pred, y, p, mode) {
      let s = 0;
      for (const r of pool) if (pred(r)) s += delta(r, y, p, mode);
      return s;
    },
    breakdown(pred, level, y, p, mode) {
      const map = new Map();
      for (const r of pool) {
        if (!pred(r)) continue;
        const k = r[level];
        map.set(k, (map.get(k) || 0) + val(r, y, p, mode));
      }
      return [...map.entries()].filter(([, v]) => Math.abs(v) > 0.5)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    },
  };
}

const byH = (h) => (r) => r.h === h;
const byC2 = (c) => (r) => r.c2 === c;

/* ------------------------------ P&L builder ------------------------------- */
const OPEX_C2 = [
  ['Personnel expenses (including management)', 'Personeelskosten (incl. management)'],
  ['Office expenses', 'Kantoorkosten'],
  ['Selling expenses', 'Verkoopkosten'],
  ['General operating expenses', 'Algemene bedrijfskosten'],
  ['Transportation', 'Transport'],
  ['Depreciation expenses', 'Afschrijvingen'],
  ['Profit sharing', 'Winstdeling'],
];

function buildPnl(A, y, p, mode) {
  const omzet = -A.sum(byH('Totale omzet'), y, p, mode);
  const kp = A.sum(byH('Totale kostprijs verkopen'), y, p, mode);
  const bruto = omzet - kp;
  const okp = A.sum(byH('Totale Overige kostprijs verkopen'), y, p, mode);
  const netto = bruto - okp;
  const opexLines = OPEX_C2.map(([c, lbl]) => ({ key: c, label: lbl, value: A.sum(byC2(c), y, p, mode) }));
  const other = A.sum(byH('Other expenses/(income)'), y, p, mode);
  if (Math.abs(other) > 0.5) opexLines.push({ key: 'Other expenses/(income)', label: 'Overige lasten/(baten)', value: other, isHoofd: true });
  const opex = opexLines.reduce((s, l) => s + l.value, 0);
  const ebit = netto - opex;
  const fin = A.sum(byH('Total financieringskosten'), y, p, mode);
  const overige = A.sum(byH('Overige'), y, p, mode);
  const resultaat = ebit - fin - overige;
  return { omzet, kp, bruto, okp, netto, opexLines, opex, ebit, fin, overige, resultaat };
}

/* ----------------------------- Balans builder ----------------------------- */
const ASSET_LINES = [
  ['Goodwill', 'Goodwill', 'fixed'],
  ['Total fixed assets', 'Materiële vaste activa', 'fixed'],
  ['Financial fixed assets', 'Financiële vaste activa', 'fixed'],
  ['Total inventory', 'Voorraden', 'current'],
  ['Accounts receivable', 'Debiteuren', 'current'],
  ['Intercompany receivables', 'Intercompany vorderingen', 'current'],
  ['C/A Management', 'Rekening-courant management', 'current'],
  ['Prepaid expenses and other receivables', 'Vooruitbetaald & overige vorderingen', 'current'],
  ['Other receivables', 'Overige vorderingen', 'current'],
  ['Liquide middelen', 'Liquide middelen', 'current'],
];
const LIAB_LINES = [
  ['Provisions', 'Voorzieningen'],
  ['Long term Liabilities', 'Langlopende schulden'],
  ['Accounts payable', 'Crediteuren'],
  ['other payables', 'Overige schulden'],
];

function buildBalans(A, y, p, pnlResult) {
  const assets = ASSET_LINES.map(([h, lbl, grp]) => ({ key: h, label: lbl, grp, value: A.sum(byH(h), y, p, 'ytd') }));
  const totalAssets = assets.reduce((s, a) => s + a.value, 0);
  const equity = -A.sum(byH('Total equity'), y, p, 'ytd');
  const liab = LIAB_LINES.map(([h, lbl]) => ({ key: h, label: lbl, value: -A.sum(byH(h), y, p, 'ytd') }));
  const totalLiab = equity + pnlResult + liab.reduce((s, l) => s + l.value, 0);
  return { assets, totalAssets, equity, result: pnlResult, liab, totalLiab, diff: totalAssets - totalLiab };
}

/* ---------------------------- Kasstroom builder --------------------------- */
function buildCash(A, y, p, mode, netResult) {
  const dA = (h) => -A.sumDelta(byH(h), y, p, mode);  // asset increase => cash out
  const dL = (h) => -A.sumDelta(byH(h), y, p, mode);  // liab raw negative; identical formula
  const wc = [
    ['Total inventory', 'Mutatie voorraden'],
    ['Accounts receivable', 'Mutatie debiteuren'],
    ['Prepaid expenses and other receivables', 'Mutatie vooruitbetaald & ov. vord.'],
    ['Other receivables', 'Mutatie overige vorderingen'],
    ['Accounts payable', 'Mutatie crediteuren'],
    ['other payables', 'Mutatie overige schulden'],
    ['Provisions', 'Mutatie voorzieningen'],
  ].map(([h, lbl]) => ({ label: lbl, value: dA(h) }));
  const operating = netResult + wc.reduce((s, l) => s + l.value, 0);

  const inv = [
    ['Goodwill', 'Mutatie goodwill'],
    ['Total fixed assets', 'Investeringen materiële vaste activa (netto)'],
    ['Financial fixed assets', 'Mutatie financiële vaste activa'],
  ].map(([h, lbl]) => ({ label: lbl, value: dA(h) }));
  const investing = inv.reduce((s, l) => s + l.value, 0);

  const fin = [
    ['Long term Liabilities', 'Mutatie langlopende schulden'],
    ['Total equity', 'Mutatie eigen vermogen (excl. resultaat)'],
    ['Intercompany receivables', 'Mutatie intercompany'],
    ['C/A Management', 'Mutatie rekening-courant management'],
  ].map(([h, lbl]) => ({ label: lbl, value: dL(h) }));
  const financing = fin.reduce((s, l) => s + l.value, 0);

  const indicative = operating + investing + financing;
  const actual = A.sumDelta(byH('Liquide middelen'), y, p, mode);
  const reconcile = actual - indicative;
  const cashEnd = A.sum(byH('Liquide middelen'), y, p, 'ytd');
  const cashBegin = cashEnd - actual;
  return { netResult, wc, operating, inv, investing, fin, financing, indicative, actual, reconcile, cashBegin, cashEnd };
}

/* ------------------------------ formatting -------------------------------- */
const nf = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fk(v) { // x1000
  if (v == null || isNaN(v)) return '–';
  const t = v / 1000;
  if (Math.abs(t) < 0.05) return '–';
  return nf.format(Math.round(t));
}
function pct(cur, prev) {
  if (!prev || Math.abs(prev) < 1) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/* ------------------------------ components -------------------------------- */
function Num({ v, bold, accent }) {
  const neg = v < -0.5;
  return (
    <span className={`num${bold ? ' b' : ''}${accent ? ' acc' : ''}${neg ? ' neg' : ''}`}>{fk(v)}</span>
  );
}
function Delta({ cur, prev }) {
  const p = pct(cur, prev);
  if (p == null) return <span className="delta muted">–</span>;
  const up = p >= 0;
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {nf1.format(Math.abs(p))}%</span>;
}

export default function StatementsDashboard() {
  const [entity, setEntity] = useState('CONS');
  const [year, setYear] = useState('2026');
  const maxP = PERIODS[year] || 12;
  const [period, setPeriod] = useState(Math.min(4, maxP));
  const [mode, setMode] = useState('ytd');        // 'ytd' | 'month'
  const [compare, setCompare] = useState(true);
  const [tab, setTab] = useState('pnl');          // pnl | balans | cash
  const [open, setOpen] = useState({});           // expanded P&L lines

  const p = Math.min(period, maxP);
  const A = useMemo(() => makeAgg(entity), [entity]);
  const pnl = useMemo(() => buildPnl(A, year, p, mode), [A, year, p, mode]);
  const pnlPrev = useMemo(() => {
    const py = String(+year - 1);
    return YEARS.includes(py) ? buildPnl(A, py, Math.min(p, PERIODS[py] || 12), mode) : null;
  }, [A, year, p, mode]);
  const pnlYtdForBalance = useMemo(() => buildPnl(A, year, p, 'ytd').resultaat, [A, year, p]);
  const balans = useMemo(() => buildBalans(A, year, p, pnlYtdForBalance), [A, year, p, pnlYtdForBalance]);
  const cash = useMemo(() => buildCash(A, year, p, mode, mode === 'ytd' ? pnlYtdForBalance : pnl.resultaat), [A, year, p, mode, pnl, pnlYtdForBalance]);

  // year sparkline series (revenue & result, monthly)
  const series = useMemo(() => {
    const rev = [], res = [];
    const mx = PERIODS[year] || 12;
    for (let i = 1; i <= 12; i++) {
      if (i > mx) { rev.push(null); res.push(null); continue; }
      const pp = buildPnl(A, year, i, 'month');
      rev.push(pp.omzet); res.push(pp.resultaat);
    }
    return { rev, res };
  }, [A, year]);

  const periodLabel = mode === 'ytd' ? `t/m ${MONTHS[p - 1]} ${year}` : `${MONTHS[p - 1]} ${year}`;
  const entLabel = entity === 'CONS' ? 'Geconsolideerd (groep)' : `${entity} — ${ENTITY_NAMES[entity] || ''}`;

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="sd-root">
      <style>{css}</style>

      <header className="sd-head">
        <div className="sd-title">
          <span className="sd-mark">BD</span>
          <div>
            <h1>Financiële Overzichten</h1>
            <p>Winst &amp; Verlies · Balans · Kasstroom — Building Depot</p>
          </div>
        </div>
        <div className="sd-meta">
          <div className="sd-bigsel">{entLabel}</div>
          <div className="sd-period">{periodLabel} · × 1.000 {META.currency}</div>
        </div>
      </header>

      <div className="sd-controls">
        <label>Entiteit
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="CONS">Geconsolideerd (alle)</option>
            {META.entities.map((e) => <option key={e} value={e}>{e} — {ENTITY_NAMES[e] || ''}</option>)}
          </select>
        </label>
        <label>Jaar
          <select value={year} onChange={(e) => { setYear(e.target.value); setPeriod(Math.min(period, PERIODS[e.target.value] || 12)); }}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Periode
          <select value={p} onChange={(e) => setPeriod(+e.target.value)}>
            {Array.from({ length: maxP }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{MONTHS[m - 1]} ({m})</option>)}
          </select>
        </label>
        <div className="sd-seg">
          <button className={mode === 'ytd' ? 'on' : ''} onClick={() => setMode('ytd')}>YTD</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Maand</button>
        </div>
        <label className="sd-check">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Vergelijk vorig jaar
        </label>
      </div>

      {/* KPI strip */}
      <div className="sd-kpis">
        <Kpi label="Omzet" v={pnl.omzet} prev={pnlPrev?.omzet} compare={compare} />
        <Kpi label="Brutomarge" v={pnl.bruto} prev={pnlPrev?.bruto} compare={compare} sub={`${nf1.format((pnl.bruto / (pnl.omzet || 1)) * 100)}%`} />
        <Kpi label="EBIT" v={pnl.ebit} prev={pnlPrev?.ebit} compare={compare} />
        <Kpi label="Resultaat" v={pnl.resultaat} prev={pnlPrev?.resultaat} compare={compare} accent />
      </div>

      <Spark series={series} year={year} curP={p} />

      <nav className="sd-tabs">
        {[['pnl', 'Winst & Verlies'], ['balans', 'Balans'], ['cash', 'Kasstroom']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      <div className="sd-panel">
        {tab === 'pnl' && (
          <table className="sd-table">
            <thead>
              <tr><th>Post</th><th className="r">{mode === 'ytd' ? 'YTD' : 'Maand'}</th>
                {compare && <th className="r">Vorig jaar</th>}{compare && <th className="r">Δ%</th>}</tr>
            </thead>
            <tbody>
              <Row label="Totale omzet" v={pnl.omzet} prev={pnlPrev?.omzet} compare={compare} strong
                exp={() => toggle('omz')} open={open.omz}
                detail={open.omz ? A.breakdown(byH('Totale omzet'), 'c2', year, p, mode).map(([k, v]) => [k, -v]) : null} />
              <Row label="Kostprijs verkopen" v={-pnl.kp} prev={pnlPrev ? -pnlPrev.kp : null} compare={compare}
                exp={() => toggle('kp')} open={open.kp}
                detail={open.kp ? A.breakdown(byH('Totale kostprijs verkopen'), 'c2', year, p, mode).map(([k, v]) => [k, -v]) : null} />
              <Row label="Overige kostprijs verkopen" v={-pnl.okp} prev={pnlPrev ? -pnlPrev.okp : null} compare={compare}
                exp={() => toggle('okp')} open={open.okp}
                detail={open.okp ? A.breakdown(byH('Totale Overige kostprijs verkopen'), 'c2', year, p, mode).map(([k, v]) => [k, -v]) : null} />
              <Row label="Brutomarge" v={pnl.bruto} prev={pnlPrev?.bruto} compare={compare} subtotal />
              <Row label="Nettomarge" v={pnl.netto} prev={pnlPrev?.netto} compare={compare} subtotal />
              <tr className="sd-group"><td colSpan={compare ? 4 : 2}>Operationele kosten</td></tr>
              {pnl.opexLines.map((l, i) => (
                <Row key={l.key} label={l.label} v={-l.value} indent
                  prev={pnlPrev ? -(pnlPrev.opexLines[i]?.value ?? 0) : null} compare={compare} />
              ))}
              <Row label="Totaal operationele kosten" v={-pnl.opex} prev={pnlPrev ? -pnlPrev.opex : null} compare={compare} subtotal />
              <Row label="EBIT" v={pnl.ebit} prev={pnlPrev?.ebit} compare={compare} strong />
              <Row label="Financieringskosten" v={-pnl.fin} prev={pnlPrev ? -pnlPrev.fin : null} compare={compare} />
              {Math.abs(pnl.overige) > 0.5 && <Row label="Overige" v={-pnl.overige} prev={pnlPrev ? -pnlPrev.overige : null} compare={compare} />}
              <Row label="Resultaat" v={pnl.resultaat} prev={pnlPrev?.resultaat} compare={compare} total />
            </tbody>
          </table>
        )}

        {tab === 'balans' && (
          <table className="sd-table">
            <thead><tr><th>Post</th><th className="r">Stand {periodLabel}</th></tr></thead>
            <tbody>
              <tr className="sd-group"><td colSpan={2}>Activa — Vaste activa</td></tr>
              {balans.assets.filter((a) => a.grp === 'fixed').map((a) => <Row key={a.key} label={a.label} v={a.value} indent />)}
              <tr className="sd-group"><td colSpan={2}>Activa — Vlottende activa</td></tr>
              {balans.assets.filter((a) => a.grp === 'current').map((a) => <Row key={a.key} label={a.label} v={a.value} indent />)}
              <Row label="Totaal activa" v={balans.totalAssets} total />
              <tr className="sd-group"><td colSpan={2}>Passiva</td></tr>
              <Row label="Eigen vermogen (begin/cumulatief)" v={balans.equity} indent />
              <Row label="Resultaat lopend boekjaar" v={balans.result} indent />
              {balans.liab.map((l) => <Row key={l.key} label={l.label} v={l.value} indent />)}
              <Row label="Totaal passiva" v={balans.totalLiab} total />
              <Row label="Aansluitingsverschil (ruwe GL)" v={balans.diff} warn />
            </tbody>
          </table>
        )}

        {tab === 'cash' && (
          <table className="sd-table">
            <thead><tr><th>Post</th><th className="r">{mode === 'ytd' ? 'YTD' : 'Maand'} {periodLabel}</th></tr></thead>
            <tbody>
              <Row label="Nettoresultaat" v={cash.netResult} strong />
              <tr className="sd-group"><td colSpan={2}>Operationele kasstroom</td></tr>
              {cash.wc.map((l, i) => <Row key={i} label={l.label} v={l.value} indent />)}
              <Row label="Kasstroom uit operationele activiteiten" v={cash.operating} subtotal />
              <tr className="sd-group"><td colSpan={2}>Investeringen</td></tr>
              {cash.inv.map((l, i) => <Row key={i} label={l.label} v={l.value} indent />)}
              <Row label="Kasstroom uit investeringen" v={cash.investing} subtotal />
              <tr className="sd-group"><td colSpan={2}>Financiering & intercompany</td></tr>
              {cash.fin.map((l, i) => <Row key={i} label={l.label} v={l.value} indent />)}
              <Row label="Kasstroom uit financiering" v={cash.financing} subtotal />
              <Row label="Indicatieve mutatie" v={cash.indicative} strong />
              <Row label="Aansluitingsverschil (ruwe GL)" v={cash.reconcile} warn />
              <Row label="Werkelijke mutatie liquide middelen" v={cash.actual} subtotal />
              <Row label="Beginstand liquide middelen" v={cash.cashBegin} indent />
              <Row label="Eindstand liquide middelen" v={cash.cashEnd} total />
            </tbody>
          </table>
        )}
      </div>

      <footer className="sd-foot">
        Bron: GL-exports 2022–2026 + mapping · ruwe GL (v1) · bedragen × 1.000 {META.currency} ·
        cijfers kunnen licht afwijken van de gereclasseerde aandeelhoudersrapportage ·
        kasstroom volgens indirecte methode (indicatief).
      </footer>
    </div>
  );
}

function Kpi({ label, v, prev, compare, sub, accent }) {
  return (
    <div className={`sd-kpi${accent ? ' acc' : ''}`}>
      <span className="k-l">{label}</span>
      <span className="k-v">{fk(v)}</span>
      <span className="k-s">
        {sub ? sub : null}
        {compare && prev != null ? <Delta cur={v} prev={prev} /> : null}
      </span>
    </div>
  );
}

function Row({ label, v, prev, compare, indent, strong, subtotal, total, warn, exp, open, detail }) {
  const cls = ['sd-row'];
  if (indent) cls.push('ind');
  if (strong) cls.push('strong');
  if (subtotal) cls.push('sub');
  if (total) cls.push('tot');
  if (warn) cls.push('warn');
  return (
    <>
      <tr className={cls.join(' ')}>
        <td>{exp ? <button className="exp" onClick={exp}>{open ? '−' : '+'}</button> : null}{label}</td>
        <td className="r"><Num v={v} bold={strong || total || subtotal} accent={total} /></td>
        {compare && <td className="r prev"><Num v={prev} /></td>}
        {compare && <td className="r"><Delta cur={v} prev={prev} /></td>}
      </tr>
      {detail && detail.map(([k, dv], i) => (
        <tr key={i} className="sd-row det">
          <td>{k}</td><td className="r"><Num v={dv} /></td>
          {compare && <td />}{compare && <td />}
        </tr>
      ))}
    </>
  );
}

function Spark({ series, year, curP }) {
  const W = 760, H = 90, pad = 6;
  const vals = [...series.rev, ...series.res].filter((x) => x != null);
  const max = Math.max(1, ...vals.map((x) => Math.abs(x)));
  const n = 12, bw = (W - pad * 2) / n;
  const y0 = H / 2;
  const scale = (v) => (v / max) * (H / 2 - pad);
  return (
    <div className="sd-spark">
      <div className="sp-legend"><span className="dot rev" /> Omzet (maand) <span className="dot res" /> Resultaat (maand) · {year}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={pad} x2={W - pad} y1={y0} y2={y0} className="sp-axis" />
        {series.rev.map((v, i) => v == null ? null : (
          <rect key={'r' + i} x={pad + i * bw + bw * 0.18} width={bw * 0.3}
            y={v >= 0 ? y0 - scale(v) : y0} height={Math.abs(scale(v))} className="sp-rev" />
        ))}
        {series.res.map((v, i) => v == null ? null : (
          <rect key={'s' + i} x={pad + i * bw + bw * 0.52} width={bw * 0.3}
            y={v >= 0 ? y0 - scale(v) : y0} height={Math.abs(scale(v))}
            className={v >= 0 ? 'sp-res' : 'sp-res neg'} />
        ))}
        {Array.from({ length: 12 }).map((_, i) => (
          <rect key={'h' + i} x={pad + i * bw} width={bw} y={0} height={H}
            className={'sp-hit' + (i + 1 === curP ? ' cur' : '')} />
        ))}
      </svg>
      <div className="sp-x">{MONTHS.map((m, i) => <span key={i} className={i + 1 === curP ? 'cur' : ''}>{m}</span>)}</div>
    </div>
  );
}

/* -------------------------------- styles ---------------------------------- */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;1,6..72,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.sd-root{--ink:#10243b;--ink2:#22405e;--paper:#f7f4ee;--card:#fffdf8;--line:#e4ddcf;--gold:#b8893b;--gold2:#9a6f28;--green:#1f7a4d;--red:#b23b3b;--muted:#8a96a3;
  font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  max-width:980px;margin:0 auto;padding:26px 22px 40px;border-radius:14px;line-height:1.4}
.sd-root *{box-sizing:border-box}
.sd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;border-bottom:2px solid var(--ink);padding-bottom:16px}
.sd-title{display:flex;gap:14px;align-items:center}
.sd-mark{font-family:'Newsreader',serif;font-weight:600;background:var(--ink);color:var(--paper);width:46px;height:46px;display:grid;place-items:center;font-size:20px;letter-spacing:.5px;border-radius:8px}
.sd-head h1{font-family:'Newsreader',serif;font-weight:600;font-size:27px;margin:0;letter-spacing:-.01em}
.sd-head p{margin:2px 0 0;font-size:12.5px;color:#5d6b7a}
.sd-meta{text-align:right}
.sd-bigsel{font-family:'Newsreader',serif;font-size:16px;color:var(--gold2);font-weight:600}
.sd-period{font-size:12px;color:#5d6b7a;font-variant-numeric:tabular-nums}
.sd-controls{display:flex;flex-wrap:wrap;gap:14px 18px;align-items:flex-end;margin:18px 0 4px}
.sd-controls label{display:flex;flex-direction:column;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a7785;gap:5px;font-weight:600}
.sd-controls select{font-family:inherit;font-size:13.5px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:7px;padding:7px 9px;min-width:120px}
.sd-seg{display:flex;border:1px solid var(--line);border-radius:7px;overflow:hidden;align-self:flex-end}
.sd-seg button{font-family:inherit;font-size:12.5px;padding:7px 13px;border:0;background:var(--card);color:#6a7785;cursor:pointer;font-weight:600}
.sd-seg button.on{background:var(--ink);color:var(--paper)}
.sd-check{flex-direction:row!important;align-items:center;gap:7px!important;text-transform:none!important;letter-spacing:0!important;font-size:12.5px!important;color:var(--ink)!important;align-self:flex-end}
.sd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
.sd-kpi{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--ink);border-radius:9px;padding:13px 15px;display:flex;flex-direction:column;gap:3px}
.sd-kpi.acc{border-top-color:var(--gold)}
.k-l{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#6a7785;font-weight:600}
.k-v{font-family:'IBM Plex Mono',monospace;font-size:25px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.k-s{font-size:12px;color:#6a7785;display:flex;gap:10px;align-items:center;min-height:16px}
.sd-spark{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:12px 14px 8px;margin-bottom:18px}
.sp-legend{font-size:11.5px;color:#6a7785;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:2px;display:inline-block}.dot.rev{background:var(--ink)}.dot.res{background:var(--gold);margin-left:8px}
.sd-spark svg{width:100%;height:90px;display:block}
.sp-axis{stroke:#c9c0ad;stroke-width:1}
.sp-rev{fill:var(--ink);opacity:.85}.sp-res{fill:var(--gold)}.sp-res.neg{fill:var(--red)}
.sp-hit{fill:transparent}.sp-hit.cur{fill:var(--gold);opacity:.09}
.sp-x{display:flex;justify-content:space-between;font-size:9.5px;color:#9aa3ad;padding:2px 4px 0;font-variant-numeric:tabular-nums}
.sp-x .cur{color:var(--gold2);font-weight:700}
.sd-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}
.sd-tabs button{font-family:'Newsreader',serif;font-size:16px;font-weight:600;background:none;border:0;border-bottom:2.5px solid transparent;padding:9px 16px;color:#8a96a3;cursor:pointer;margin-bottom:-1px}
.sd-tabs button.on{color:var(--ink);border-bottom-color:var(--gold)}
.sd-panel{background:var(--card);border:1px solid var(--line);border-top:0;border-radius:0 0 9px 9px;padding:6px 4px}
.sd-table{width:100%;border-collapse:collapse;font-size:13.5px}
.sd-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#7a8693;font-weight:600;padding:10px 14px;border-bottom:1px solid var(--line)}
.sd-table th.r,.sd-table td.r{text-align:right}
.sd-row td{padding:6.5px 14px;border-bottom:1px solid #f0ebe0}
.sd-row.ind td:first-child{padding-left:26px;color:#3e4d5c}
.sd-row.det td{padding:3px 14px 3px 40px;font-size:12px;color:#8a96a3;border-bottom:0}
.sd-row.det td:first-child{text-transform:capitalize}
.sd-group td{background:#f3eee2;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--gold2);font-weight:700;padding:7px 14px}
.sd-row.strong td{font-weight:600}
.sd-row.sub td{font-weight:600;border-top:1px solid var(--line);background:#faf7f0}
.sd-row.tot td{font-weight:700;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink);background:#f3eee2;font-size:14.5px}
.sd-row.warn td{color:var(--red);font-style:italic;font-size:12.5px}
.num{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
.num.b{font-weight:600}.num.acc{color:var(--gold2)}.num.neg{color:var(--red)}
.sd-row.tot .num.neg{color:var(--red)}
.prev .num{color:#9aa3ad}
.delta{font-size:11.5px;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
.delta.up{color:var(--green)}.delta.down{color:var(--red)}.delta.muted{color:#b8c0c8}
.exp{font-family:'IBM Plex Mono',monospace;width:17px;height:17px;line-height:14px;border:1px solid var(--line);background:var(--paper);border-radius:4px;margin-right:8px;cursor:pointer;color:var(--gold2);font-weight:700;padding:0}
.sd-foot{font-size:11px;color:#8a96a3;margin-top:16px;line-height:1.5;border-top:1px solid var(--line);padding-top:12px}
@media(max-width:640px){.sd-kpis{grid-template-columns:repeat(2,1fr)}.sd-head{flex-direction:column;align-items:flex-start}.sd-meta{text-align:left}}
`;
