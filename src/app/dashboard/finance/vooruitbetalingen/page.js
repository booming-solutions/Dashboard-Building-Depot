/* ============================================================
   BESTAND: vooruitbetalingen_page.js
   KOPIEER NAAR: src/app/dashboard/finance/vooruitbetalingen/page.js
   (nieuwe map: vooruitbetalingen/, hernoemen naar page.js)

   DOEL: de aanbetalingslijst van Keukendepot inlezen, controleren
   en als batch klaarzetten voor de Eagle Bridge, die de regels
   in "New A/P Transactions" invoert.

   STATUS: preview. De knop "Batch klaarzetten" schrijft nog niet
   naar de database en start de Bridge nog niet — hij toont wat er
   verstuurd zou worden. Zie de TODO's onderaan bij handleSend().

   Logica staat in src/lib/eaglePrepay.js zodat de Bridge en een
   latere server-route dezelfde regels gebruiken.
   ============================================================ */
'use client';

import { Fragment, useState, useMemo, useRef, useCallback } from 'react';
import {
  ENTITEITEN, PREPAY_CONFIG,
  lastDayPrevMonth, toISODate, parseISODate, eagleDate, nlDate,
  minBoekdatum, checkBoekdatum,
  money, nlAmount,
  readWorkbook, analyseRows,
  bookedXcg, statusOf, inBatch, isManual, buildBatch,
} from '@/lib/eaglePrepay';


/* ------------------------------------------------------------------ UI */

function Pill({ status }) {
  const map = {
    error:     ['Fout', 'bg-red-100 text-red-800'],
    action:    ['Bevestigen', 'bg-amber-100 text-amber-800'],
    confirmed: ['Bevestigd', 'bg-emerald-100 text-emerald-800'],
    removed:   ['Uit batch', 'bg-gray-200 text-gray-600'],
    ready:     ['Gereed', 'bg-emerald-100 text-emerald-800'],
  };
  const [label, cls] = map[status] || map.ready;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function Tile({ k, v, s, tone }) {
  const toneCls = tone === 'ok' ? 'text-emerald-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'err' ? 'text-red-700'
    : 'text-[#1B3A5C]';
  return (
    <div className="px-4 py-3 border-r border-gray-100 last:border-r-0">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{k}</div>
      <div className={`mt-1 text-[20px] font-bold tabular-nums ${toneCls}`}>{v}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{s}</div>
    </div>
  );
}

/* ------------------------------------------------------------- pagina */

export default function VooruitbetalingenPage() {
  const vandaag = useMemo(() => new Date(), []);
  const fileRef = useRef(null);

  const [entity, setEntity] = useState(null);
  const [boekdatum, setBoekdatum] = useState(toISODate(lastDayPrevMonth(vandaag)));
  const [fileName, setFileName] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [rowState, setRowState] = useState({});
  const [openRow, setOpenRow] = useState({});
  const [filter, setFilter] = useState('alles');
  const [dragOver, setDragOver] = useState(false);
  const [readError, setReadError] = useState(null);
  const [sent, setSent] = useState(null);
  const [showPayload, setShowPayload] = useState(false);
  const [copied, setCopied] = useState(false);

  const minDatum = useMemo(() => minBoekdatum(vandaag), [vandaag]);
  const maxDatum = useMemo(
    () => new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate())),
    [vandaag]
  );
  const datumFout = checkBoekdatum(boekdatum, vandaag);

  const { rows, modal } = useMemo(() => analyseRows(rawRows), [rawRows]);

  const st = useCallback((n) => rowState[n] || { status: 'pending', mode: 'keep', xcg: 0 }, [rowState]);
  const setSt = useCallback((n, patch) => {
    setRowState(prev => ({ ...prev, [n]: { ...(prev[n] || { status: 'pending', mode: 'keep', xcg: 0 }), ...patch } }));
    setSent(null);
  }, []);

  const batchRows = rows.filter(r => inBatch(r, rowState[r.excelRow]));
  const actionRows = rows.filter(r => statusOf(r, rowState[r.excelRow]) === 'action');
  const manualRows = rows.filter(r => isManual(r, rowState[r.excelRow]));
  const totXcg = batchRows.reduce((s, r) => s + bookedXcg(r, rowState[r.excelRow]), 0);

  const blocked = !entity || !!datumFout || actionRows.length > 0 || batchRows.length === 0;

  /* ------------------------------------------------------------ inlezen */

  function resetAll() {
    setFileName(null); setRawRows([]); setRowState({}); setOpenRow({});
    setFilter('alles'); setReadError(null); setSent(null); setShowPayload(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const res = readWorkbook(e.target.result);
      if (fileRef.current) fileRef.current.value = '';
      if (!res.ok) { setReadError(res.error); return; }
      setReadError(null);
      setFileName(file.name);
      setRawRows(res.rows);
      setRowState({});
      setOpenRow({});
      setFilter('alles');
      setSent(null);
      setShowPayload(false);
    };
    reader.readAsArrayBuffer(file);
  }

  /* ------------------------------------------------------------ acties */

  function handleSend() {
    const batch = buildBatch({
      rows, rowState, entity, boekdatumISO: boekdatum, fileName, modal,
      batchId: null,
    });
    // TODO (na preview):
    //  1. POST naar /api/finance/prepay-batches -> batch opslaan in Supabase,
    //     regels met dedupeKey zodat dubbel boeken onmogelijk is.
    //  2. Met het teruggekregen batchId de Bridge starten:
    //     window.location.href = `eagleprepay://batch/${batchId}`;
    //  3. Status per regel terugkoppelen (vouchernummer of foutmelding).
    setSent(batch);
    setShowPayload(true);
  }

  function copyManual() {
    const lines = [['Rij', 'Betaaldatum', 'Leverancier', 'Fact.nummer', 'Euro', 'XCG', 'Reden'].join('\t')];
    manualRows.forEach(r => {
      const reden = r.errors.length
        ? r.errors.join(' ')
        : 'Handmatig uit de batch gehaald' + (r.flags.length ? ` — ${r.flags.map(f => f.code).join(', ')}` : '');
      lines.push([
        r.excelRow,
        r.betaaldatum ? nlDate(parseISODate(r.betaaldatum)) : '',
        r.leverancier, r.factuurnummer,
        r.euro > 0 ? money(r.euro) : '',
        r.xcg > 0 ? money(r.xcg) : '',
        reden,
      ].join('\t'));
    });
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })
      .catch(() => {});
  }

  /* ------------------------------------------------------------- render */

  const shown = rows.filter(r => {
    const s = statusOf(r, rowState[r.excelRow]);
    if (filter === 'actie') return s === 'action';
    if (filter === 'batch') return inBatch(r, rowState[r.excelRow]);
    if (filter === 'handmatig') return isManual(r, rowState[r.excelRow]);
    return true;
  });

  const boekdatumObj = parseISODate(boekdatum);

  return (
    <div className="p-6 max-w-[1180px]">

      {/* kop */}
      <div className="flex items-start gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">Finance · Keukendepot</p>
          <h1 className="text-[24px] font-bold text-[#1B3A5C] mt-1">Vooruitbetalingen boeken in Eagle</h1>
          <p className="text-[13px] text-gray-500 mt-1 max-w-[62ch]">
            Upload de aanbetalingslijst, bevestig wat opvalt, en zet de batch klaar voor Eagle.
            Er wordt altijd het XCG-bedrag geboekt.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />Preview
        </span>
      </div>

      {/* STAP 1 — entiteit en datum */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">1</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Entiteit en boekdatum</h2>
        <span className="ml-auto text-[12px] text-gray-400">Bepaalt beide grootboekrekeningen en de datum in Eagle</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-3 mb-7">
        {ENTITEITEN.map(e => {
          const on = entity === e.code;
          return (
            <button key={e.code} type="button"
              onClick={() => { setEntity(e.code); setSent(null); }}
              className={`text-left rounded-xl border p-4 transition-all ${on ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="flex items-center gap-2.5">
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${on ? 'border-[#1B3A5C] bg-[#1B3A5C] ring-2 ring-inset ring-white' : 'border-gray-300'}`} />
                <span className="font-semibold text-[15px] text-[#1B3A5C]">{e.naam}</span>
                <span className="ml-auto text-[12px] text-gray-400 font-mono">entiteit {e.code}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-dashed border-gray-200 flex gap-6">
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">AP-rekening</div>
                  <div className="font-mono text-[13px] text-[#1B3A5C]">{PREPAY_CONFIG.apAccountMain}-{e.code}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Distributie</div>
                  <div className="font-mono text-[13px] text-[#1B3A5C]">{PREPAY_CONFIG.distributionAccountMain}-{e.code}</div>
                </div>
              </div>
            </button>
          );
        })}

        <div className={`rounded-xl border p-4 bg-white ${datumFout ? 'border-red-300' : 'border-gray-200'}`}>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Voucher &amp; invoice date</div>
          <div className="font-mono text-[21px] font-bold text-[#1B3A5C] mt-1">{eagleDate(boekdatumObj)}</div>
          <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">
            Altijd de laatste dag van de vorige maand — {nlDate(boekdatumObj)}. De betaaldatum uit de Excel wordt hiervoor niet gebruikt.
          </p>
          <input
            type="date"
            value={boekdatum}
            min={toISODate(minDatum)}
            max={toISODate(maxDatum)}
            onChange={e => { if (e.target.value) { setBoekdatum(e.target.value); setSent(null); } }}
            className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] font-mono focus:outline-none focus:border-[#1B3A5C]"
          />
          <p className="text-[11px] text-gray-400 mt-1.5">
            Vroegst toegestaan: {nlDate(minDatum)} — maximaal {PREPAY_CONFIG.maxDagenTerug} dagen terug,
            daarboven blokkeert Eagle de boeking.
          </p>
          {datumFout && <p className="text-[12px] text-red-700 font-medium mt-1.5">{datumFout}</p>}
        </div>
      </div>

      {/* STAP 2 — bestand */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">2</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Bestand</h2>
        <span className="ml-auto text-[12px] text-gray-400">Tabblad <span className="font-mono">Lijst</span>, kolommen A t/m I</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-7">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
          className={`rounded-xl border-2 border-dashed p-5 flex items-center gap-4 flex-wrap transition-colors ${dragOver ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-300 bg-gray-50'}`}>
          <div className="flex-1 min-w-[240px]">
            <strong className="block text-[14px] text-[#1B3A5C]">
              {rows.length ? 'Bestand geladen' : 'Sleep de Excel hierheen'}
            </strong>
            <p className="text-[12.5px] text-gray-500 mt-0.5">
              {rows.length
                ? 'Sleep een ander bestand hierheen om te vervangen, of maak eerst leeg.'
                : 'of kies een bestand. Alleen .xlsx — de indeling wordt vóór het inlezen gecontroleerd.'}
            </p>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:brightness-110">
            {rows.length ? 'Bestand vervangen' : 'Bestand kiezen'}
          </button>
          {rows.length > 0 && (
            <button type="button" onClick={resetAll}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-[13px] font-semibold hover:bg-red-50">
              Leegmaken
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
            onChange={e => handleFile(e.target.files?.[0])} />
        </div>

        <div className="mt-3 flex items-center gap-3 flex-wrap text-[13px] text-gray-600">
          <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-0.5 text-[12px]">
            {rows.length ? 'Ingelezen' : 'Geen bestand'}
          </span>
          <span>{rows.length ? `${fileName} · ${rows.length} regels` : 'Nog niets ingelezen'}</span>
        </div>

        {readError && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-[13px] text-red-800 whitespace-pre-line">
            {readError}
          </div>
        )}
      </div>

      {/* samenvatting */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        <Tile k="Regels" v={rows.length || '—'} s={rows.length ? `leverancier ${rows[0].leverancierNr}` : 'geen bestand'} />
        <Tile k="Te boeken XCG" v={rows.length ? nlAmount(totXcg) : '—'} s={`${batchRows.length} regel(s)`} tone={batchRows.length ? 'ok' : null} />
        <Tile k="Te bevestigen" v={rows.length ? actionRows.length : '—'} s={actionRows.length ? 'vraagt om een keuze' : 'niets open'} tone={actionRows.length ? 'warn' : null} />
        <Tile k="Handmatig" v={rows.length ? manualRows.length : '—'} s={manualRows.length ? 'gaat niet mee' : 'geen'} tone={manualRows.length ? 'err' : null} />
        <Tile k="Koers" v={modal.rate === null ? '—' : modal.rate} s={modal.rate === null ? 'nog onbekend' : `vaakst: ${modal.count}×`} />
        <Tile k="Klaar" v={rows.length ? `${batchRows.length} / ${rows.length}` : '—'} s={entity ? `entiteit ${entity}` : 'kies entiteit'} tone={rows.length && batchRows.length === rows.length && entity ? 'ok' : null} />
      </div>

      {/* STAP 3 — controle */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">3</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Controle</h2>
        <span className="ml-auto text-[12px] text-gray-400">
          {!rows.length ? 'Nog geen bestand'
            : actionRows.length ? `${actionRows.length} regel(s) wachten op bevestiging`
            : 'Dubbelen, koers en veldlengtes gecontroleerd'}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          {[
            ['alles', 'Alle regels', rows.length],
            ['actie', 'Te bevestigen', actionRows.length],
            ['batch', 'Gaat naar Eagle', batchRows.length],
            ['handmatig', 'Handmatig', manualRows.length],
          ].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-[12.5px] border transition-all ${filter === k ? 'bg-[#1B3A5C] border-[#1B3A5C] text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {label} ({n})
            </button>
          ))}
          {modal.rate !== null && (
            <span className="ml-auto text-[12px] text-gray-400">
              Koers {modal.rate} komt {modal.count}× voor en geldt als de norm voor dit bestand.
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-[13.5px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Rij', 'Betaaldatum', 'Leverancier', 'Fact.nummer', 'Euro', 'XCG', 'Koers', 'Voucher Ref', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 whitespace-nowrap ${[4, 5, 6].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400 text-[13.5px]">
                  Nog geen bestand ingelezen. Kies of sleep de aanbetalingslijst hierboven.
                </td></tr>
              )}
              {rows.length > 0 && !shown.length && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400 text-[13.5px]">Geen regels in deze selectie.</td></tr>
              )}

              {shown.map(row => {
                const s = statusOf(row, rowState[row.excelRow]);
                const rst = st(row.excelRow);
                const rowCls = s === 'error' ? 'bg-red-50' : s === 'action' ? 'bg-amber-50' : s === 'removed' ? 'opacity-50' : '';
                const heeftKoers = row.flags.some(f => f.code === 'KOERS');
                return (
                  <Fragment key={row.excelRow}>
                    <tr className={`border-b border-gray-100 ${rowCls}`}>
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{row.excelRow}</td>
                      <td className="px-3 py-2">{row.betaaldatum ? nlDate(parseISODate(row.betaaldatum)) : '—'}</td>
                      <td className="px-3 py-2">{row.leverancier}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{row.factuurnummer}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.euro > 0 ? nlAmount(row.euro) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.xcg > 0 ? nlAmount(bookedXcg(row, rowState[row.excelRow])) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{row.rate === null ? '—' : row.rate}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{row.voucherRef}</td>
                      <td className="px-3 py-2"><Pill status={s} /></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpenRow(o => ({ ...o, [row.excelRow]: !o[row.excelRow] }))}
                          className="text-[12px] text-[#1B3A5C] underline underline-offset-2">
                          {openRow[row.excelRow] ? 'verberg' : 'record'}
                        </button>
                      </td>
                    </tr>

                    {row.errors.length > 0 && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={10} className="px-5 py-3">
                          <div className="border-l-[3px] border-red-500 pl-3.5">
                            <div className="text-[13.5px] font-semibold text-red-700">Deze regel kan niet geboekt worden</div>
                            <ul className="mt-1.5 space-y-1">
                              {row.errors.map((e, i) => (
                                <li key={i} className="flex gap-2.5 text-[13px] text-gray-700">
                                  <span className="font-mono text-[10.5px] font-semibold bg-white border border-gray-200 rounded px-1.5 py-px flex-none">FOUT</span>
                                  <span>{e}</span>
                                </li>
                              ))}
                            </ul>
                            <div className="text-[12.5px] text-gray-400 mt-1.5">Staat op de lijst handmatig boeken.</div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {row.errors.length === 0 && row.flags.length > 0 && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={10} className="px-5 py-3.5">
                          <div className={`border-l-[3px] pl-3.5 ${s === 'confirmed' ? 'border-emerald-500' : s === 'removed' ? 'border-gray-400' : 'border-amber-500'}`}>
                            <div className={`text-[13.5px] font-semibold ${s === 'confirmed' ? 'text-emerald-700' : s === 'removed' ? 'text-gray-500' : 'text-amber-700'}`}>
                              {s === 'confirmed' ? 'Bevestigd — gaat mee in de batch'
                                : s === 'removed' ? 'Uit de batch gehaald — staat op de lijst handmatig boeken'
                                : 'Bevestiging nodig'}
                            </div>
                            <ul className="mt-2 space-y-1.5">
                              {row.flags.map((f, i) => (
                                <li key={i} className="flex gap-2.5 text-[13px] text-gray-700 max-w-[80ch]">
                                  <span className="font-mono text-[10.5px] font-semibold bg-white border border-gray-200 rounded px-1.5 py-px flex-none">{f.code}</span>
                                  <span>{f.text}</span>
                                </li>
                              ))}
                            </ul>

                            {heeftKoers && s !== 'removed' && (
                              <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                                <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] cursor-pointer ${rst.mode === 'keep' ? 'border-[#1B3A5C] bg-[#1B3A5C]/5 font-semibold' : 'border-gray-200 bg-white'}`}>
                                  <input type="radio" name={`m${row.excelRow}`} checked={rst.mode === 'keep'}
                                    onChange={() => setSt(row.excelRow, { mode: 'keep' })} />
                                  Bedrag laten staan — XCG {nlAmount(row.xcg)}
                                </label>
                                <label className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] cursor-pointer ${rst.mode === 'override' ? 'border-[#1B3A5C] bg-[#1B3A5C]/5 font-semibold' : 'border-gray-200 bg-white'}`}>
                                  <input type="radio" name={`m${row.excelRow}`} checked={rst.mode === 'override'}
                                    onChange={() => setSt(row.excelRow, { mode: 'override' })} />
                                  Zelf invullen
                                </label>
                                <input type="number" step="0.01" min="0" placeholder="XCG"
                                  disabled={rst.mode !== 'override'}
                                  value={rst.mode === 'override' && rst.xcg ? rst.xcg : ''}
                                  onChange={e => setSt(row.excelRow, { xcg: Number(e.target.value) })}
                                  className="w-32 px-2.5 py-2 rounded-lg border border-gray-300 font-mono text-[13px] disabled:opacity-40 focus:outline-none focus:border-[#1B3A5C]" />
                              </div>
                            )}

                            <div className="mt-3 flex gap-2.5 flex-wrap">
                              {s === 'removed' ? (
                                <button type="button" onClick={() => setSt(row.excelRow, { status: 'pending' })}
                                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
                                  Terugzetten in de batch
                                </button>
                              ) : (
                                <>
                                  {s !== 'confirmed' ? (
                                    <button type="button" onClick={() => setSt(row.excelRow, { status: 'confirmed' })}
                                      className="px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[12.5px] font-semibold hover:brightness-110">
                                      Bevestigen en meenemen
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => setSt(row.excelRow, { status: 'pending' })}
                                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
                                      Bevestiging intrekken
                                    </button>
                                  )}
                                  <button type="button" onClick={() => setSt(row.excelRow, { status: 'removed' })}
                                    className="px-3 py-1.5 rounded-lg border border-red-200 text-[12.5px] font-semibold text-red-700 hover:bg-red-50">
                                    Uit batch halen
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {openRow[row.excelRow] && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={10} className="px-5 py-4">
                          <div className="max-w-[760px] rounded-lg border border-gray-200 bg-white overflow-hidden">
                            <div className="px-3.5 py-2 bg-gray-100 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                              Wat de Bridge in Eagle invult · rij {row.excelRow}
                            </div>
                            <dl className="grid grid-cols-[220px_1fr]">
                              {[
                                ['Trx Type', PREPAY_CONFIG.trxType],
                                ['Vendor', row.leverancierNr],
                                ['Voucher Date', eagleDate(boekdatumObj)],
                                ['Invoice Date', eagleDate(boekdatumObj)],
                                ['Vendor Ref No', row.factuurnummer],
                                ['AP Account', `${PREPAY_CONFIG.apAccountMain} - ${entity || '000'}`],
                                ['Terms Code', `${PREPAY_CONFIG.termsCode}  (${PREPAY_CONFIG.termsCodeLabel})`],
                                ['Voucher Ref', row.voucherRef],
                                ['Invoice Amount', money(bookedXcg(row, rowState[row.excelRow]))],
                                ['Due Date / Disc Date', 'niet aanraken — systeemdatum'],
                                ['Add', 'F4'],
                                ['Distribution — account', `${PREPAY_CONFIG.distributionAccountMain} - ${entity || '000'}`],
                                ['Distribution — Job', '(leeg)'],
                                ['Distribution — bedrag', money(bookedXcg(row, rowState[row.excelRow]))],
                              ].map(([k, v], i, arr) => (
                                <Fragment key={k}>
                                  <dt className={`px-3.5 py-1.5 text-[13px] text-gray-400 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>{k}</dt>
                                  <dd className={`px-3.5 py-1.5 font-mono text-[12.5px] text-[#1B3A5C] ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>{v}</dd>
                                </Fragment>
                              ))}
                            </dl>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* handmatig */}
      {manualRows.length > 0 && (
        <>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">!</span>
            <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Handmatig boeken</h2>
            <span className="ml-auto text-[12px] text-gray-400">Regels die niet meegaan in de batch</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13.5px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Rij', 'Betaaldatum', 'Leverancier', 'Fact.nummer', 'Euro', 'XCG', 'Reden', ''].map((h, i) => (
                      <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 ${[4, 5].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {manualRows.map(r => (
                    <tr key={r.excelRow} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{r.excelRow}</td>
                      <td className="px-3 py-2">{r.betaaldatum ? nlDate(parseISODate(r.betaaldatum)) : '—'}</td>
                      <td className="px-3 py-2">{r.leverancier}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{r.factuurnummer}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.euro > 0 ? nlAmount(r.euro) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.xcg > 0 ? nlAmount(r.xcg) : '—'}</td>
                      <td className="px-3 py-2 text-[12.5px] text-gray-600">
                        {r.errors.length ? r.errors.join(' ') : `Handmatig uit de batch gehaald${r.flags.length ? ' — ' + r.flags.map(f => f.code).join(', ') : ''}`}
                      </td>
                      <td className="px-3 py-2">
                        {!r.errors.length && (
                          <button type="button" onClick={() => setSt(r.excelRow, { status: 'pending' })}
                            className="text-[12px] text-[#1B3A5C] underline underline-offset-2">terugzetten</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center gap-4 flex-wrap">
              <div className="flex-1 text-[13px] text-gray-600">
                <strong className="text-[#1B3A5C]">{manualRows.length} regel(s) gaan niet mee naar Eagle.</strong>{' '}
                Deze lijst blijft staan zodat ze los geboekt kunnen worden.
              </div>
              <button type="button" onClick={copyManual}
                className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
                {copied ? 'Gekopieerd' : 'Lijst kopiëren'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* STAP 4 — naar Eagle */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">4</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Naar Eagle</h2>
        <span className="ml-auto text-[12px] text-gray-400">Zet Eagle klaar op New A/P Transactions vóór je start</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px] text-[13px] text-gray-600">
            {!rows.length ? <><strong className="text-[#1B3A5C]">Nog geen bestand.</strong> Lees eerst een aanbetalingslijst in.</>
              : !entity ? <><strong className="text-[#1B3A5C]">Kies eerst een entiteit.</strong> Zonder die keuze staat niet vast op welke rekening geboekt wordt.</>
              : datumFout ? <><strong className="text-[#1B3A5C]">De boekdatum klopt niet.</strong> {datumFout}</>
              : actionRows.length ? <><strong className="text-[#1B3A5C]">{actionRows.length} regel(s) wachten op bevestiging.</strong> Bevestig ze of haal ze uit de batch.</>
              : !batchRows.length ? <><strong className="text-[#1B3A5C]">Geen boekbare regels.</strong> Alles staat op de lijst handmatig boeken.</>
              : <>
                  <strong className="text-[#1B3A5C]">
                    {batchRows.length} regel(s) klaar voor {ENTITEITEN.find(e => e.code === entity)?.naam}.
                  </strong>{' '}
                  Rekening {PREPAY_CONFIG.apAccountMain}-{entity}, distributie {PREPAY_CONFIG.distributionAccountMain}-{entity},
                  datum {eagleDate(boekdatumObj)}
                  {manualRows.length ? ` · ${manualRows.length} regel(s) blijven achter voor handmatig boeken.` : '.'}
                  {sent && <><br /><span className="text-gray-500">Preview: de batch is nog niet opgeslagen en de Bridge is nog niet gestart.</span></>}
                </>}
          </div>
          <button type="button" disabled={blocked} onClick={handleSend}
            className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
            Batch klaarzetten voor Eagle
          </button>
          <button type="button" onClick={() => setShowPayload(v => !v)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
            {showPayload ? 'Verberg' : 'Toon wat de agent ontvangt'}
          </button>
        </div>
        {showPayload && (
          <pre className="px-5 py-4 bg-gray-50 border-t border-gray-200 font-mono text-[12px] leading-relaxed overflow-x-auto text-gray-600">
            {JSON.stringify(
              sent || buildBatch({ rows, rowState, entity: entity || '000', boekdatumISO: boekdatum, fileName, modal, batchId: null }),
              null, 2
            )}
          </pre>
        )}
      </div>

    </div>
  );
}
