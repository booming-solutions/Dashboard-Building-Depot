// BESTEMMING: src/app/dashboard/finance/ar/page.jsx
// Data:       src/data/ar-data.json   (import als '@/data/ar-data.json')
'use client';
import { useState, useMemo } from 'react';
import DATA from '@/data/ar-data.json';

/* ---- opmaak-helpers (XCG) ---- */
const nl = (x, d = 0) =>
  Number(x).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtM(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return nl(x / 1e6, 1) + ' mln';
  if (a >= 1e3) return nl(x / 1e3, 0) + ' k';
  return nl(x, 0);
}
const pct = (x) => nl(x, 1) + '%';

/* ---- veroudering: volgorde, labels, kleuren ---- */
const BUCKETS = DATA.buckets;
const BLAB = DATA.bucketLabels;
const BCOL = {
  niet_vervallen: '#1f7a4d',
  d1_30: '#5a8f4e',
  d31_60: '#b8893b',
  d61_90: '#c47a2e',
  d91_180: '#b2542f',
  d180: '#b23b3b',
};

export default function ARReport() {
  const snaps = DATA.snapshots;
  const cur = snaps[snaps.length - 1];
  const [sortKey, setSortKey] = useState('net');
  const [topN, setTopN] = useState(25);
  const [seg, setSeg] = useState(null);

  const grossTotal = cur.gross;
  const segEntries = Object.entries(cur.segments);

  const debtors = useMemo(() => {
    let d = cur.debtors.slice();
    if (seg) d = d.filter((r) => r.seg === seg);
    d.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
    return d;
  }, [cur, sortKey, seg]);

  const kpi = [
    { l: 'Totaal openstaand', v: fmtM(cur.net), s: `bruto ${fmtM(cur.gross)} · credits ${fmtM(cur.credits)}`, tone: 'ink' },
    { l: 'Vervallen', v: pct(cur.pctOverdue), s: `${fmtM(cur.overdue)} van bruto`, tone: 'red' },
    { l: '> 90 dagen', v: pct(cur.pctOver90), s: `${fmtM(cur.over90)}`, tone: 'red' },
    { l: 'DSO', v: `${nl(cur.dso, 0)} dgn`, s: `gem. open ${nl(cur.wavgOpen, 0)} dgn · ${nl(cur.wavgDue, 0)} te laat`, tone: 'gold' },
    { l: 'Top-10 concentratie', v: pct(cur.top10pct), s: `top-25 ${fmtM(cur.top25)}`, tone: 'ink' },
  ];

  return (
    <div className="arw">
      <style>{css}</style>

      <header className="ar-head">
        <div>
          <div className="eyebrow">Finance · Debiteuren</div>
          <h1>AR-ontwikkeling</h1>
        </div>
        <div className="asof">
          Meetmoment <b>{fmtDate(cur.date)}</b>
          <span className="muted"> · {nl(cur.nCustomers)} debiteuren · {nl(cur.nDocs)} posten · XCG</span>
        </div>
      </header>

      {/* KPI-strip */}
      <section className="kpis">
        {kpi.map((k) => (
          <div className={'kpi ' + k.tone} key={k.l}>
            <div className="kl">{k.l}</div>
            <div className="kv">{k.v}</div>
            <div className="ks">{k.s}</div>
          </div>
        ))}
      </section>

      {/* Ontwikkeling + veroudering */}
      <section className="grid2">
        <div className="card">
          <div className="card-h">
            <h2>Ontwikkeling openstaand & veroudering</h2>
            <span className="muted">per meetmoment</span>
          </div>
          <DevChart snaps={snaps} />
          <Legend />
          {snaps.length < 2 && (
            <p className="hint">
              Nog één meetmoment. De reeks bouwt zich op zodra je wekelijkse export binnenkomt — dan
              zie je hier de trend in totaal openstaand en de verschuiving tussen ouderdomsklassen.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-h"><h2>Veroudering</h2><span className="muted">{fmtDate(cur.date)}</span></div>
          <table className="aging">
            <tbody>
              {BUCKETS.map((b) => {
                const val = cur.buckets[b] || 0;
                const w = grossTotal ? (val / grossTotal) * 100 : 0;
                return (
                  <tr key={b}>
                    <td className="ab-l"><span className="dot" style={{ background: BCOL[b] }} />{BLAB[b]}</td>
                    <td className="ab-bar"><span style={{ width: w + '%', background: BCOL[b] }} /></td>
                    <td className="ab-p">{pct(w)}</td>
                    <td className="ab-v">{fmtM(val)}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td>Totaal bruto</td><td /><td /><td className="ab-v">{fmtM(grossTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className="segblock">
            <div className="seg-h">Per segment</div>
            {segEntries.map(([s, v]) => {
              const w = cur.net ? (v / cur.net) * 100 : 0;
              return (
                <button
                  key={s}
                  className={'segrow' + (seg === s ? ' on' : '')}
                  onClick={() => setSeg(seg === s ? null : s)}
                  title="Filter de debiteurenlijst op dit segment"
                >
                  <span className="sname">{s}</span>
                  <span className="sbar"><span style={{ width: Math.max(2, w) + '%' }} /></span>
                  <span className="sval">{fmtM(v)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Top-debiteuren */}
      <section className="card">
        <div className="card-h wrap">
          <h2>Debiteuren {seg ? <span className="chip">{seg} ✕</span> : ''}</h2>
          <div className="controls">
            {seg && <button className="lnk" onClick={() => setSeg(null)}>filter wissen</button>}
            <div className="sortseg">
              <span className="muted">sorteer</span>
              {[['net', 'openstaand'], ['overdue', 'vervallen'], ['oldest', 'oudste']].map(([k, lbl]) => (
                <button key={k} className={'seg-btn' + (sortKey === k ? ' on' : '')} onClick={() => setSortKey(k)}>{lbl}</button>
              ))}
            </div>
            <div className="sortseg">
              {[25, 100].map((n) => (
                <button key={n} className={'seg-btn' + (topN === n ? ' on' : '')} onClick={() => setTopN(n)}>top {n}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="tbl-wrap">
          <table className="debt">
            <thead>
              <tr>
                <th className="r">#</th>
                <th>Klant</th>
                <th>Segment</th>
                <th className="r">Netto openstaand</th>
                <th className="r">Waarvan vervallen</th>
                <th className="r">Oudste</th>
                <th className="agh">Ouderdomsverdeling</th>
              </tr>
            </thead>
            <tbody>
              {debtors.slice(0, topN).map((r, i) => (
                <tr key={r.cust + i}>
                  <td className="r idx">{i + 1}</td>
                  <td className="nm"><b>{r.name}</b><span className="cnum">{r.cust}</span></td>
                  <td className="sg">{r.seg}</td>
                  <td className="r num">{fmtM(r.net)}</td>
                  <td className={'r num' + (r.overdue > 0 ? ' warn' : '')}>{fmtM(r.overdue)}</td>
                  <td className="r num">{r.oldest > 0 ? r.oldest + ' d' : '—'}</td>
                  <td><RowAging b={r.b} gross={r.gross} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Bedragen in XCG, netto (na credits/vooruitbetalingen). Veroudering op vervaldatum. Lijst toont de
          grootste {topN} debiteuren{seg ? ` binnen ${seg}` : ''}; sorteren op openstaand, vervallen bedrag of oudste post.
        </p>
      </section>
    </div>
  );
}

/* ---- ontwikkelingsgrafiek: gestapelde veroudering per meetmoment + netto-lijn ---- */
function DevChart({ snaps }) {
  const W = 640, H = 240, PL = 54, PR = 16, PT = 14, PB = 34;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxG = Math.max(...snaps.map((s) => s.gross), 1);
  const nice = niceMax(maxG);
  const n = snaps.length;
  const slot = iw / Math.max(n, 1);
  const bw = Math.min(64, slot * 0.5);
  const y = (v) => PT + ih - (v / nice) * ih;
  const ticks = 4;
  return (
    <svg className="dev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="AR-ontwikkeling">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (nice / ticks) * i;
        return (
          <g key={i}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} className="grid" />
            <text x={PL - 8} y={y(v) + 3} className="ytick">{fmtM(v)}</text>
          </g>
        );
      })}
      {snaps.map((s, si) => {
        const cx = PL + slot * si + slot / 2;
        let acc = 0;
        return (
          <g key={s.date}>
            {BUCKETS.map((b) => {
              const val = s.buckets[b] || 0;
              const h = (val / nice) * ih;
              const yy = PT + ih - acc - h;
              acc += h;
              return <rect key={b} x={cx - bw / 2} y={yy} width={bw} height={Math.max(0, h)} fill={BCOL[b]} />;
            })}
            <circle cx={cx} cy={y(s.net)} r="3.5" className="netdot" />
            <text x={cx} y={H - PB + 16} className="xtick">{fmtDate(s.date, true)}</text>
            <text x={cx} y={y(s.gross) - 6} className="blab">{fmtM(s.gross)}</text>
          </g>
        );
      })}
      {n > 1 && (
        <polyline
          className="netline"
          points={snaps.map((s, si) => `${PL + slot * si + slot / 2},${y(s.net)}`).join(' ')}
        />
      )}
    </svg>
  );
}

function Legend() {
  return (
    <div className="legend">
      {BUCKETS.map((b) => (
        <span key={b} className="lg"><span className="dot" style={{ background: BCOL[b] }} />{BLAB[b]}</span>
      ))}
      <span className="lg"><span className="dot net" />netto</span>
    </div>
  );
}

function RowAging({ b, gross }) {
  const g = gross || 1;
  return (
    <div className="rowag" title="Verdeling openstaand over ouderdomsklassen">
      {BUCKETS.map((k) => {
        const w = ((b[k] || 0) / g) * 100;
        if (w <= 0) return null;
        return <span key={k} style={{ width: w + '%', background: BCOL[k] }} />;
      })}
    </div>
  );
}

/* ---- util ---- */
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const s = v / p;
  const m = s <= 1 ? 1 : s <= 2 ? 2 : s <= 2.5 ? 2.5 : s <= 5 ? 5 : 10;
  return m * p;
}
function fmtDate(iso, short) {
  const [y, m, d] = iso.split('-');
  const mn = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return short ? `${d} ${mn[+m - 1]}` : `${d} ${mn[+m - 1]} ${y}`;
}

const css = `
.arw{--ink:#10243b;--gold:#b8893b;--paper:#f7f4ee;--green:#1f7a4d;--red:#b23b3b;--line:#e5ddcf;
  font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);
  padding:22px 26px 40px;max-width:1180px;margin:0 auto;}
.arw h1{font-family:Georgia,'Times New Roman',serif;font-size:30px;margin:2px 0 0;font-weight:600;letter-spacing:-.01em;}
.arw h2{font-family:Georgia,serif;font-size:17px;margin:0;font-weight:600;}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);}
.ar-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:18px;flex-wrap:wrap;}
.asof{font-size:13px;text-align:right;} .muted{color:#8a8172;} .ar-head .asof b{font-variant-numeric:tabular-nums;}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px;}
.kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;}
.kpi .kl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a8172;}
.kpi .kv{font-family:Georgia,serif;font-size:24px;font-weight:600;margin:3px 0 2px;font-variant-numeric:tabular-nums;}
.kpi .ks{font-size:11px;color:#8a8172;font-variant-numeric:tabular-nums;}
.kpi.red .kv{color:var(--red);} .kpi.gold .kv{color:var(--gold);} .kpi.green .kv{color:var(--green);}
.grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;margin-bottom:18px;}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;}
.card-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;}
.card-h.wrap{flex-wrap:wrap;}
svg.dev{width:100%;height:auto;display:block;}
svg.dev .grid{stroke:#efe9dd;stroke-width:1;} svg.dev .ytick{fill:#a99;font-size:9px;text-anchor:end;font-family:'IBM Plex Mono',monospace;}
svg.dev .xtick{fill:#6b6355;font-size:10px;text-anchor:middle;} svg.dev .blab{fill:var(--ink);font-size:10px;text-anchor:middle;font-weight:600;font-family:'IBM Plex Mono',monospace;}
svg.dev .netdot{fill:#fff;stroke:var(--ink);stroke-width:1.5;} svg.dev .netline{fill:none;stroke:var(--ink);stroke-width:1.5;stroke-dasharray:3 3;}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:11px;color:#6b6355;}
.legend .lg{display:flex;align-items:center;gap:5px;}
.dot{width:10px;height:10px;border-radius:2px;display:inline-block;} .dot.net{background:#fff;border:1.5px solid var(--ink);border-radius:50%;}
.hint{font-size:12px;color:#8a8172;margin:12px 0 0;line-height:1.5;}
table.aging{width:100%;border-collapse:collapse;font-size:13px;}
table.aging td{padding:5px 4px;vertical-align:middle;}
.ab-l{white-space:nowrap;} .ab-l .dot{margin-right:7px;}
.ab-bar{width:38%;} .ab-bar span{display:block;height:9px;border-radius:5px;}
.ab-p{text-align:right;color:#8a8172;font-variant-numeric:tabular-nums;width:52px;}
.ab-v{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;}
table.aging .tot td{border-top:1px solid var(--line);padding-top:8px;font-weight:600;}
.segblock{margin-top:14px;border-top:1px solid var(--line);padding-top:10px;}
.seg-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a8172;margin-bottom:6px;}
.segrow{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:4px 2px;cursor:pointer;text-align:left;border-radius:6px;}
.segrow:hover{background:#faf7f0;} .segrow.on{background:#f2ecdd;}
.segrow .sname{flex:0 0 40%;font-size:12.5px;} .segrow .sbar{flex:1;height:8px;background:#f0ebe0;border-radius:4px;overflow:hidden;}
.segrow .sbar span{display:block;height:100%;background:var(--gold);} .segrow .sval{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;color:#4a4335;}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.sortseg{display:flex;align-items:center;gap:4px;} .sortseg .muted{margin-right:4px;font-size:11px;}
.seg-btn{border:1px solid var(--line);background:#fff;border-radius:999px;padding:3px 11px;font-size:12px;cursor:pointer;color:#6b6355;}
.seg-btn.on{background:var(--ink);border-color:var(--ink);color:#fff;}
.lnk{background:none;border:0;color:var(--gold);cursor:pointer;font-size:12px;text-decoration:underline;}
.chip{font-size:12px;background:#f2ecdd;border:1px solid var(--line);border-radius:999px;padding:1px 9px;margin-left:8px;font-family:'IBM Plex Sans';font-weight:400;}
.tbl-wrap{overflow-x:auto;} table.debt{width:100%;border-collapse:collapse;font-size:13px;}
table.debt th{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a8172;text-align:left;padding:8px 10px;border-bottom:2px solid var(--ink);white-space:nowrap;}
table.debt th.r{text-align:right;} table.debt th.agh{width:150px;}
table.debt td{padding:7px 10px;border-bottom:1px solid #f0ebe0;vertical-align:middle;}
table.debt td.r{text-align:right;} .num{font-variant-numeric:tabular-nums;white-space:nowrap;}
.idx{color:#b7ae9d;font-variant-numeric:tabular-nums;} .nm b{font-weight:600;} .nm .cnum{display:block;font-size:11px;color:#a99;font-family:'IBM Plex Mono',monospace;}
.sg{color:#6b6355;font-size:12px;white-space:nowrap;} .num.warn{color:var(--red);}
.rowag{display:flex;height:9px;width:140px;border-radius:5px;overflow:hidden;background:#f0ebe0;}
.rowag span{display:block;height:100%;}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr);}.grid2{grid-template-columns:1fr;}}
`;
