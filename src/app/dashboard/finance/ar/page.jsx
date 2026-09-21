// BESTEMMING: src/app/dashboard/finance/ar/page.jsx
// Data:       src/data/ar-data.json   (import als '@/data/ar-data.json')
'use client';
import { useState, useMemo } from 'react';
import DATA from '@/data/ar-data.json';

/* ---- opmaak (XCG) ---- */
const nl = (x, d = 0) => Number(x).toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtM(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return nl(x / 1e6, 1) + ' mln';
  if (a >= 1e3) return nl(x / 1e3, 0) + ' k';
  return nl(x, 0);
}
const pct = (x) => nl(x, 1) + '%';

/* ---- veroudering ---- */
const BUCKETS = DATA.buckets;
const BLAB = DATA.bucketLabels;
const BCOL = { niet_vervallen: '#1f7a4d', d1_30: '#5a8f4e', d31_60: '#b8893b', d61_90: '#c47a2e', d91_180: '#b2542f', d180: '#b23b3b' };

/* ---- actiebanden (op basis van oudste vervallen post per klant) ---- */
const BANDS = ['b1_30', 'b31_60', 'b61_90', 'b91_180', 'b180'];
const BANDMETA = {
  b1_30:   { label: '1–30 dgn',   col: '#5a8f4e', action: 'Herinneren — bel kort na vervaldatum' },
  b31_60:  { label: '31–60 dgn',  col: '#b8893b', action: 'Actief nabellen — nu betalen', focus: true },
  b61_90:  { label: '61–90 dgn',  col: '#c47a2e', action: '2e aanmaning + kredietstop aankondigen' },
  b91_180: { label: '91–180 dgn', col: '#b2542f', action: 'Aanmaning + kredietstop / betalingsregeling' },
  b180:    { label: '180+ dgn',   col: '#b23b3b', action: 'Escalatie: incasso / juridisch / afboeken' },
};

export default function ARReport() {
  const snaps = DATA.snapshots;
  const cur = snaps[snaps.length - 1];
  const [tab, setTab] = useState('actie');
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
          <span className="muted"> · {nl(cur.nCustomers)} debiteuren · netto {fmtM(cur.net)} XCG</span>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'actie' ? 'on' : ''} onClick={() => setTab('actie')}>Actielijst</button>
        <button className={tab === 'overzicht' ? 'on' : ''} onClick={() => setTab('overzicht')}>Overzicht</button>
      </nav>
      {tab === 'actie' ? <ActieView cur={cur} /> : <Overzicht cur={cur} snaps={snaps} />}
    </div>
  );
}

/* ============================ ACTIELIJST ============================ */
function ActieView({ cur }) {
  const [seg, setSeg] = useState('Zakelijk');
  const [band, setBand] = useState(null);
  const [sortKey, setSortKey] = useState('overdue');
  const [overOnly, setOverOnly] = useState(false);

  const segList = ['Zakelijk', ...Object.keys(cur.segments).filter((s) => s !== 'Zakelijk')];
  const scopeAgg =
    seg === null ? cur.actionBands.all :
    cur.actionBands[seg] ? cur.actionBands[seg] :
    bandAggFrom(cur.debtors.filter((d) => d.seg === seg));

  const rows = useMemo(() => {
    let d = cur.debtors.filter((r) => r.overdue > 0);
    if (seg) d = d.filter((r) => r.seg === seg);
    if (band) d = d.filter((r) => r.band === band);
    if (overOnly) d = d.filter((r) => r.over > 0);
    d.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
    return d;
  }, [cur, seg, band, sortKey, overOnly]);

  const focus = cur.actionBands.Zakelijk.b31_60;
  const zk = cur.actionBands.Zakelijk;
  const zkN = BANDS.reduce((s, k) => s + zk[k].n, 0);
  const zkOverdue = BANDS.reduce((s, k) => s + zk[k].overdue, 0);
  const bandTot = (k) => scopeAgg[k] || { n: 0, overdue: 0 };
  const allOverdue = BANDS.reduce((s, k) => s + (scopeAgg[k]?.overdue || 0), 0);
  const allN = BANDS.reduce((s, k) => s + (scopeAgg[k]?.n || 0), 0);

  return (
    <>
      <div className="focusrow">
        <div className="focus-card">
          <div className="fc-ey">★ Vroege interventie · zakelijk 31–60 dgn</div>
          <div className="fc-v">{focus.n} bedrijven · {fmtM(focus.overdue)}</div>
          <div className="fc-s">Chase nu — vóórdat ze doorschuiven naar 90+. Boodschap: betaling direct na vervaldatum.</div>
        </div>
        <div className="focus-note">
          <b>Zakelijk vervallen totaal:</b> {zkN} bedrijven · {fmtM(zkOverdue)}. Grootste zakelijke buckets: 91–180 ({fmtM(zk.b91_180.overdue)}) en 180+ ({fmtM(zk.b180.overdue)}) → escaleren.
          {' '}Daarvan <b>{cur.overLimitZakelijk.n}</b> boven kredietlimiet ({fmtM(cur.overLimitZakelijk.amount)}) → kredietstop overwegen.
          <br />
          <span className="muted">Particuliere staart: {nl(cur.consumerTail.n)} posten &gt;180 dgn ({fmtM(cur.consumerTail.overdue)}) — beleids-/batchactie, niet individueel chasen.</span>
        </div>
      </div>

      <section className="card">
        <div className="filters">
          <div className="fgroup">
            <span className="flbl">Segment</span>
            <button className={'seg-btn' + (seg === null ? ' on' : '')} onClick={() => setSeg(null)}>Alle</button>
            {segList.map((s) => (
              <button key={s} className={'seg-btn' + (seg === s ? ' on' : '')} onClick={() => setSeg(s)}>{s}</button>
            ))}
          </div>
          <div className="fgroup">
            <span className="flbl">Actieband</span>
            <button className={'seg-btn' + (band === null ? ' on' : '')} onClick={() => setBand(null)}>
              Alle vervallen <em>{allN} · {fmtM(allOverdue)}</em>
            </button>
            {BANDS.map((k) => (
              <button key={k} className={'seg-btn band' + (band === k ? ' on' : '') + (BANDMETA[k].focus ? ' focus' : '')} onClick={() => setBand(band === k ? null : k)}>
                {BANDMETA[k].focus ? '★ ' : ''}{BANDMETA[k].label} <em>{bandTot(k).n} · {fmtM(bandTot(k).overdue)}</em>
              </button>
            ))}
          </div>
          <div className="fgroup right">
            <button className={'seg-btn' + (overOnly ? ' on' : '')} onClick={() => setOverOnly(!overOnly)}>⚠ boven limiet</button>
            <span className="flbl">sorteer</span>
            {[['overdue', 'vervallen'], ['net', 'openstaand'], ['oldest', 'oudste']].map(([k, l]) => (
              <button key={k} className={'seg-btn' + (sortKey === k ? ' on' : '')} onClick={() => setSortKey(k)}>{l}</button>
            ))}
            <button className="exp" onClick={() => exportCsv(rows, seg, band)}>Exporteer (CSV)</button>
          </div>
        </div>

        <div className="tbl-wrap">
          <table className="debt">
            <thead>
              <tr>
                <th className="r">#</th><th>Klant</th><th>Segment</th>
                <th className="r">Vervallen</th><th className="r">Netto</th>
                <th className="r">Krediet</th><th className="r">Oudste</th><th className="r">Fact.</th>
                <th>Actie</th><th>Aanbevolen stap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.cust + i}>
                  <td className="r idx">{i + 1}</td>
                  <td className="nm"><b>{r.name}</b><span className="cnum">{r.cust}</span>{(r.ph || r.em) && <span className="contact">{r.ph && <a href={'tel:' + r.ph}>{r.ph}</a>}{r.ph && r.em ? ' · ' : ''}{r.em && <a href={'mailto:' + r.em}>{r.em}</a>}</span>}</td>
                  <td className="sg">{r.seg}</td>
                  <td className="r num warn">{fmtM(r.overdue)}</td>
                  <td className="r num">{fmtM(r.net)}</td>
                  <td className="r num kred">{r.climit > 0 ? fmtM(r.climit) : '—'}{r.over > 0 && <span className="ovl">▲ {fmtM(r.over)}</span>}</td>
                  <td className="r num">{r.oldest} d</td>
                  <td className="r num">{r.ndocsOver}/{r.ndocs}</td>
                  <td><span className="badge" style={{ '--bc': BANDMETA[r.band]?.col }}>{BANDMETA[r.band]?.label}</span></td>
                  <td className="act">{BANDMETA[r.band]?.action}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="10" className="empty">Geen posten in deze selectie.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint">
          {rows.length} klanten in beeld. Bedragen XCG, netto na credits; veroudering op vervaldatum. Actieband = status van de
          oudste openstaande post per klant. Individuele regels voor alle zakelijke klanten + de grootste accounts; klein-particulier
          &gt;180 dgn zit in de staart-beleidsactie hierboven.
        </p>
      </section>
    </>
  );
}

/* ============================ OVERZICHT ============================ */
function Overzicht({ cur, snaps }) {
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
    { l: 'DSO', v: `${nl(cur.dso, 0)} dgn`, s: `gem. open ${nl(cur.wavgOpen, 0)} dgn`, tone: 'gold' },
    { l: 'Top-10 concentratie', v: pct(cur.top10pct), s: `top-25 ${fmtM(cur.top25)}`, tone: 'ink' },
  ];
  return (
    <>
      <section className="kpis">
        {kpi.map((k) => (<div className={'kpi ' + k.tone} key={k.l}><div className="kl">{k.l}</div><div className="kv">{k.v}</div><div className="ks">{k.s}</div></div>))}
      </section>
      <section className="grid2">
        <div className="card">
          <div className="card-h"><h2>Ontwikkeling openstaand & veroudering</h2><span className="muted">per meetmoment</span></div>
          <DevChart snaps={snaps} /><Legend />
          {snaps.length < 2 && <p className="hint">Nog één meetmoment. De reeks bouwt zich op zodra je wekelijkse export binnenkomt — dan zie je hier de trend en de verschuiving tussen ouderdomsklassen.</p>}
        </div>
        <div className="card">
          <div className="card-h"><h2>Veroudering</h2><span className="muted">{fmtDate(cur.date)}</span></div>
          <table className="aging"><tbody>
            {BUCKETS.map((b) => { const val = cur.buckets[b] || 0; const w = grossTotal ? (val / grossTotal) * 100 : 0;
              return (<tr key={b}><td className="ab-l"><span className="dot" style={{ background: BCOL[b] }} />{BLAB[b]}</td><td className="ab-bar"><span style={{ width: w + '%', background: BCOL[b] }} /></td><td className="ab-p">{pct(w)}</td><td className="ab-v">{fmtM(val)}</td></tr>); })}
            <tr className="tot"><td>Totaal bruto</td><td /><td /><td className="ab-v">{fmtM(grossTotal)}</td></tr>
          </tbody></table>
          <div className="segblock"><div className="seg-h">Per segment</div>
            {segEntries.map(([s, v]) => { const w = cur.net ? (v / cur.net) * 100 : 0;
              return (<button key={s} className={'segrow' + (seg === s ? ' on' : '')} onClick={() => setSeg(seg === s ? null : s)}><span className="sname">{s}</span><span className="sbar"><span style={{ width: Math.max(2, w) + '%' }} /></span><span className="sval">{fmtM(v)}</span></button>); })}
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h wrap"><h2>Debiteuren {seg ? <span className="chip">{seg} ✕</span> : ''}</h2>
          <div className="controls">
            {seg && <button className="lnk" onClick={() => setSeg(null)}>filter wissen</button>}
            <div className="sortseg"><span className="muted">sorteer</span>{[['net', 'openstaand'], ['overdue', 'vervallen'], ['oldest', 'oudste']].map(([k, lbl]) => (<button key={k} className={'seg-btn' + (sortKey === k ? ' on' : '')} onClick={() => setSortKey(k)}>{lbl}</button>))}</div>
            <div className="sortseg">{[25, 100].map((n) => (<button key={n} className={'seg-btn' + (topN === n ? ' on' : '')} onClick={() => setTopN(n)}>top {n}</button>))}</div>
          </div>
        </div>
        <div className="tbl-wrap"><table className="debt"><thead><tr><th className="r">#</th><th>Klant</th><th>Segment</th><th className="r">Netto openstaand</th><th className="r">Waarvan vervallen</th><th className="r">Oudste</th><th className="agh">Ouderdomsverdeling</th></tr></thead>
          <tbody>{debtors.slice(0, topN).map((r, i) => (<tr key={r.cust + i}><td className="r idx">{i + 1}</td><td className="nm"><b>{r.name}</b><span className="cnum">{r.cust}</span></td><td className="sg">{r.seg}</td><td className="r num">{fmtM(r.net)}</td><td className={'r num' + (r.overdue > 0 ? ' warn' : '')}>{fmtM(r.overdue)}</td><td className="r num">{r.oldest > 0 ? r.oldest + ' d' : '—'}</td><td><RowAging b={r.b} gross={r.gross} /></td></tr>))}</tbody>
        </table></div>
      </section>
    </>
  );
}

/* ---- CSV-export ---- */
function exportCsv(rows, seg, band) {
  const head = ['Rang', 'Klantnr', 'Naam', 'Segment', 'Vervallen_XCG', 'Netto_XCG', 'Kredietlimiet', 'Boven_limiet', 'Oudste_dgn', 'Fact_vervallen', 'Fact_open', 'Telefoon', 'Email', 'Actieband', 'Aanbevolen_stap'];
  const lines = rows.map((r, i) => [i + 1, r.cust, '"' + r.name.replace(/"/g, "'") + '"', r.seg, r.overdue, r.net, r.climit || 0, r.over || 0, r.oldest, r.ndocsOver, r.ndocs, r.ph || '', r.em || '', BANDMETA[r.band]?.label, BANDMETA[r.band]?.action].join(';'));
  const csv = '\uFEFF' + head.join(';') + '\n' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AR-actielijst_${(seg || 'alle')}_${band || 'vervallen'}_07jul2026.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}
function bandAggFrom(list) {
  const o = {};
  BANDS.forEach((k) => { const s = list.filter((d) => d.band === k && d.overdue > 0); o[k] = { n: s.length, overdue: s.reduce((a, d) => a + d.overdue, 0), net: s.reduce((a, d) => a + d.net, 0) }; });
  return o;
}

/* ---- charts/util ---- */
function DevChart({ snaps }) {
  const W = 640, H = 240, PL = 54, PR = 16, PT = 14, PB = 34, iw = W - PL - PR, ih = H - PT - PB;
  const nice = niceMax(Math.max(...snaps.map((s) => s.gross), 1)), n = snaps.length, slot = iw / Math.max(n, 1), bw = Math.min(64, slot * 0.5);
  const y = (v) => PT + ih - (v / nice) * ih, ticks = 4;
  return (
    <svg className="dev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="AR-ontwikkeling">
      {Array.from({ length: ticks + 1 }, (_, i) => { const v = (nice / ticks) * i; return (<g key={i}><line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} className="grid" /><text x={PL - 8} y={y(v) + 3} className="ytick">{fmtM(v)}</text></g>); })}
      {snaps.map((s, si) => { const cx = PL + slot * si + slot / 2; let acc = 0;
        return (<g key={s.date}>{BUCKETS.map((b) => { const val = s.buckets[b] || 0, h = (val / nice) * ih, yy = PT + ih - acc - h; acc += h; return <rect key={b} x={cx - bw / 2} y={yy} width={bw} height={Math.max(0, h)} fill={BCOL[b]} />; })}
          <circle cx={cx} cy={y(s.net)} r="3.5" className="netdot" /><text x={cx} y={H - PB + 16} className="xtick">{fmtDate(s.date, true)}</text><text x={cx} y={y(s.gross) - 6} className="blab">{fmtM(s.gross)}</text></g>); })}
      {n > 1 && <polyline className="netline" points={snaps.map((s, si) => `${PL + slot * si + slot / 2},${y(s.net)}`).join(' ')} />}
    </svg>
  );
}
function Legend() { return (<div className="legend">{BUCKETS.map((b) => (<span key={b} className="lg"><span className="dot" style={{ background: BCOL[b] }} />{BLAB[b]}</span>))}<span className="lg"><span className="dot net" />netto</span></div>); }
function RowAging({ b, gross }) { const g = gross || 1; return (<div className="rowag">{BUCKETS.map((k) => { const w = ((b[k] || 0) / g) * 100; if (w <= 0) return null; return <span key={k} style={{ width: w + '%', background: BCOL[k] }} />; })}</div>); }
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))), s = v / p, m = s <= 1 ? 1 : s <= 2 ? 2 : s <= 2.5 ? 2.5 : s <= 5 ? 5 : 10; return m * p; }
function fmtDate(iso, short) { const [y, m, d] = iso.split('-'); const mn = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']; return short ? `${d} ${mn[+m - 1]}` : `${d} ${mn[+m - 1]} ${y}`; }

const css = `
.arw{--ink:#10243b;--gold:#b8893b;--paper:#f7f4ee;--green:#1f7a4d;--red:#b23b3b;--line:#e5ddcf;font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);background:var(--paper);padding:22px 26px 40px;max-width:1180px;margin:0 auto;}
.arw h1{font-family:Georgia,serif;font-size:30px;margin:2px 0 0;font-weight:600;letter-spacing:-.01em;}
.arw h2{font-family:Georgia,serif;font-size:17px;margin:0;font-weight:600;}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);}
.ar-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:14px;flex-wrap:wrap;}
.asof{font-size:13px;text-align:right;}.muted{color:#8a8172;}
.tabs{display:flex;gap:6px;margin-bottom:18px;}
.tabs button{font-family:'IBM Plex Sans';font-size:14px;padding:7px 16px;border:1px solid var(--line);background:#fff;border-radius:8px;cursor:pointer;color:#6b6355;}
.tabs button.on{background:var(--ink);border-color:var(--ink);color:#fff;font-weight:600;}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px;}
.kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;}
.kpi .kl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a8172;}
.kpi .kv{font-family:Georgia,serif;font-size:24px;font-weight:600;margin:3px 0 2px;font-variant-numeric:tabular-nums;}
.kpi .ks{font-size:11px;color:#8a8172;font-variant-numeric:tabular-nums;}
.kpi.red .kv{color:var(--red);}.kpi.gold .kv{color:var(--gold);}
.focusrow{display:grid;grid-template-columns:300px 1fr;gap:14px;margin-bottom:16px;}
.focus-card{background:linear-gradient(135deg,#1b3350,#10243b);color:#fff;border-radius:12px;padding:16px 18px;}
.fc-ey{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;color:var(--gold);text-transform:uppercase;}
.fc-v{font-family:Georgia,serif;font-size:26px;font-weight:600;margin:6px 0 4px;}
.fc-s{font-size:12px;color:#cfd7e0;line-height:1.45;}
.focus-note{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.55;}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px;}
.card-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;}.card-h.wrap{flex-wrap:wrap;}
.filters{display:flex;flex-wrap:wrap;gap:16px 20px;align-items:center;margin-bottom:12px;}
.fgroup{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}.fgroup.right{margin-left:auto;}
.flbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#8a8172;margin-right:2px;}
.seg-btn{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer;color:#4a4335;display:inline-flex;align-items:center;gap:6px;}
.seg-btn em{font-style:normal;font-size:11px;color:#a99;font-variant-numeric:tabular-nums;}
.seg-btn.on{background:var(--ink);border-color:var(--ink);color:#fff;}.seg-btn.on em{color:#c3ccd6;}
.seg-btn.band.focus{border-color:var(--gold);}
.seg-btn.band.focus.on{background:var(--gold);border-color:var(--gold);}
.exp{border:1px solid var(--ink);background:#fff;border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer;color:var(--ink);font-weight:600;}
.tbl-wrap{overflow-x:auto;}
table.debt{width:100%;border-collapse:collapse;font-size:13px;}
table.debt th{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#8a8172;text-align:left;padding:8px 10px;border-bottom:2px solid var(--ink);white-space:nowrap;}
table.debt th.r{text-align:right;}table.debt th.agh{width:150px;}
table.debt td{padding:7px 10px;border-bottom:1px solid #f0ebe0;vertical-align:middle;}
table.debt td.r{text-align:right;}.num{font-variant-numeric:tabular-nums;white-space:nowrap;}
.idx{color:#b7ae9d;font-variant-numeric:tabular-nums;}.nm b{font-weight:600;}.nm .cnum{display:block;font-size:11px;color:#a99;font-family:'IBM Plex Mono',monospace;}
.sg{color:#6b6355;font-size:12px;white-space:nowrap;}.num.warn{color:var(--red);}
.nm .contact{display:block;font-size:11px;color:#6b6355;margin-top:1px;}
.nm .contact a{color:#6b6355;text-decoration:none;border-bottom:1px dotted #cbc3b3;}
.nm .contact a:hover{color:var(--ink);}
.kred{color:#6b6355;}.kred .ovl{display:block;color:var(--red);font-weight:600;font-size:11px;}
.badge{font-size:11px;font-weight:600;color:#fff;background:var(--bc,#888);border-radius:5px;padding:2px 8px;white-space:nowrap;}
.act{font-size:12px;color:#4a4335;}
.empty{text-align:center;color:#a99;padding:22px;}
.hint{font-size:12px;color:#8a8172;margin:12px 0 0;line-height:1.5;}
.grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;}
svg.dev{width:100%;height:auto;display:block;}
svg.dev .grid{stroke:#efe9dd;stroke-width:1;}svg.dev .ytick{fill:#a99;font-size:9px;text-anchor:end;font-family:'IBM Plex Mono',monospace;}
svg.dev .xtick{fill:#6b6355;font-size:10px;text-anchor:middle;}svg.dev .blab{fill:var(--ink);font-size:10px;text-anchor:middle;font-weight:600;font-family:'IBM Plex Mono',monospace;}
svg.dev .netdot{fill:#fff;stroke:var(--ink);stroke-width:1.5;}svg.dev .netline{fill:none;stroke:var(--ink);stroke-width:1.5;stroke-dasharray:3 3;}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:11px;color:#6b6355;}.legend .lg{display:flex;align-items:center;gap:5px;}
.dot{width:10px;height:10px;border-radius:2px;display:inline-block;}.dot.net{background:#fff;border:1.5px solid var(--ink);border-radius:50%;}
table.aging{width:100%;border-collapse:collapse;font-size:13px;}table.aging td{padding:5px 4px;vertical-align:middle;}
.ab-l{white-space:nowrap;}.ab-l .dot{margin-right:7px;}.ab-bar{width:38%;}.ab-bar span{display:block;height:9px;border-radius:5px;}
.ab-p{text-align:right;color:#8a8172;font-variant-numeric:tabular-nums;width:52px;}.ab-v{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;}
table.aging .tot td{border-top:1px solid var(--line);padding-top:8px;font-weight:600;}
.segblock{margin-top:14px;border-top:1px solid var(--line);padding-top:10px;}.seg-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a8172;margin-bottom:6px;}
.segrow{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:4px 2px;cursor:pointer;text-align:left;border-radius:6px;}
.segrow:hover{background:#faf7f0;}.segrow.on{background:#f2ecdd;}
.segrow .sname{flex:0 0 40%;font-size:12.5px;}.segrow .sbar{flex:1;height:8px;background:#f0ebe0;border-radius:4px;overflow:hidden;}.segrow .sbar span{display:block;height:100%;background:var(--gold);}
.segrow .sval{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;color:#4a4335;}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}.sortseg{display:flex;align-items:center;gap:4px;}.sortseg .muted{margin-right:4px;font-size:11px;}
.lnk{background:none;border:0;color:var(--gold);cursor:pointer;font-size:12px;text-decoration:underline;}
.chip{font-size:12px;background:#f2ecdd;border:1px solid var(--line);border-radius:999px;padding:1px 9px;margin-left:8px;font-weight:400;}
.rowag{display:flex;height:9px;width:140px;border-radius:5px;overflow:hidden;background:#f0ebe0;}.rowag span{display:block;height:100%;}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr);}.grid2{grid-template-columns:1fr;}.focusrow{grid-template-columns:1fr;}}
`;