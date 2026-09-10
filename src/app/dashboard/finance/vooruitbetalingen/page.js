/* ============================================================
   BESTAND: vooruitbetalingen_page.js
   KOPIEER NAAR: src/app/dashboard/finance/vooruitbetalingen/page.js
   (nieuwe map: vooruitbetalingen/, hernoemen naar page.js)

   DOEL: de aanbetalingslijst van Keukendepot inlezen, controleren
   en als batch klaarzetten voor de Eagle Bridge, die de regels
   in "New A/P Transactions" invoert.

   STATUS: preview, maar de koppeling met Eagle werkt:
     1. "Boeken in Eagle" slaat de batch op (POST /api/finance/prepay/batches)
        en start de Eagle Bridge op de PC via eagleprepay://batch/<id>.
     2. De Bridge haalt de batch op, boekt regel voor regel en meldt
        elke stap terug (POST .../voortgang).
     3. Deze pagina leest de voortgang elke 2 s uit Supabase
        (eagle_prepay_batches / _rows / _events) en toont hem live.
   Fallback als de Bridge niet reageert: het batchbestand downloaden en
   dubbelklikken — ook dan komt de voortgang terug.

   Logica staat in src/lib/eaglePrepay.js zodat de Bridge en de
   server-routes dezelfde regels gebruiken.
   ============================================================ */
'use client';

import { Fragment, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
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

const STORE_VAN = { '000': '1', '700': 'B' };

function RowPill({ status }) {
  const map = {
    wachten:           ['Wacht', 'bg-gray-100 text-gray-600'],
    bezig:             ['Bezig', 'bg-blue-100 text-blue-800 animate-pulse'],
    geboekt:           ['Geboekt', 'bg-emerald-100 text-emerald-800'],
    overgeslagen:      ['Al geboekt', 'bg-gray-200 text-gray-600'],
    gestopt:           ['Gestopt', 'bg-red-100 text-red-800'],
    geboekt_handmatig: ['Afmaken in Eagle', 'bg-amber-100 text-amber-800'],
  };
  const [label, cls] = map[status] || map.wachten;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

function BatchPill({ status }) {
  const map = {
    klaar:    ['Klaargezet — wacht op de Bridge', 'bg-gray-100 text-gray-700'],
    bezig:    ['Bezig in Eagle', 'bg-blue-100 text-blue-800'],
    afgerond: ['Afgerond', 'bg-emerald-100 text-emerald-800'],
    gestopt:  ['Gestopt', 'bg-red-100 text-red-800'],
  };
  const [label, cls] = map[status] || map.klaar;
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-bold ${cls}`}>
    {status === 'bezig' && <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />}{label}
  </span>;
}

function tijd(iso) {
  try { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
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
  const [downloadOk, setDownloadOk] = useState(null);

  // koppeling met Eagle
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [batchRec, setBatchRec] = useState(null);   // antwoord van /api/finance/prepay/batches
  const [live, setLive] = useState(null);           // { batch, rows, events } uit Supabase
  const [launched, setLaunched] = useState(false);
  const voortgangRef = useRef(null);

  const minDatum = useMemo(() => minBoekdatum(vandaag), [vandaag]);
  const maxDatum = useMemo(
    () => new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate())),
    [vandaag]
  );
  const datumFout = checkBoekdatum(boekdatum, vandaag);

  // Eerder geboekt (centraal, over alle PC's heen): per dedupeKey de
  // laatste boeking uit eagle_prepay_rows. Zo'n regel moet expliciet
  // bevestigd worden voordat hij nog een keer mee mag.
  const [eerder, setEerder] = useState({});

  const { rows, modal } = useMemo(() => {
    const res = analyseRows(rawRows);
    res.rows.forEach(row => {
      const e = eerder[row.dedupeKey];
      if (!e) return;
      const wanneer = e.tijd ? new Date(e.tijd).toLocaleDateString('nl-NL') : 'eerder';
      const wat = e.status === 'geboekt'
        ? `is op ${wanneer} al via het dashboard in Eagle geboekt${e.voucher ? ` (voucher ${e.voucher})` : ''}`
        : e.status === 'bezig'
          ? `wordt op dit moment door een andere batch geboekt`
          : `is op ${wanneer} in Eagle blijven staan om handmatig af te maken`;
      row.flags.push({
        code: 'EERDER GEBOEKT',
        text: `Fact.nummer ${row.factuurnummer} ${wat} — batch ${e.batch_id || '?'}${e.door ? `, door ${e.door}` : ''}, ` +
              `XCG ${nlAmount(e.bedrag || 0)}. Alleen bevestigen als dit echt een nieuwe aanbetaling is; anders uit de batch halen.`,
      });
    });
    return res;
  }, [rawRows, eerder]);

  useEffect(() => {
    if (!rawRows.length) { setEerder({}); return undefined; }
    let stop = false;
    const keys = Array.from(new Set(rawRows.map(r => `${r.leverancierNr}|${r.factuurnummer}`).filter(k => !k.endsWith('|'))));
    if (!keys.length) return undefined;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('eagle_prepay_rows')
          .select('dedupe_key,status,voucher,invoice_amount,updated_at,eagle_prepay_batches(batch_id,created_by,entiteit_naam)')
          .in('dedupe_key', keys)
          .in('status', ['geboekt', 'geboekt_handmatig', 'bezig'])
          .order('updated_at', { ascending: false });
        if (stop || error || !data) return;
        const map = {};
        data.forEach(r => {
          if (map[r.dedupe_key]) return; // nieuwste eerst
          map[r.dedupe_key] = {
            status: r.status, voucher: r.voucher, bedrag: r.invoice_amount, tijd: r.updated_at,
            batch_id: r.eagle_prepay_batches?.batch_id, door: r.eagle_prepay_batches?.created_by,
          };
        });
        setEerder(map);
      } catch { /* geen centrale controle mogelijk; de Bridge heeft nog zijn eigen ledger */ }
    })();
    return () => { stop = true; };
  }, [rawRows]);

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
    setBatchRec(null); setLive(null); setLaunched(false); setSaveError(null); setDownloadOk(null);
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

  /**
   * Boeken in Eagle.
   *
   * 1. De batch wordt opgeslagen via /api/finance/prepay/batches; die route
   *    geeft een startlink terug (eagleprepay://batch/<id>?t=<token>).
   * 2. De browser opent die link; Windows start de Eagle Bridge, die de
   *    batch ophaalt en gaat boeken. De Bridge meldt elke stap terug.
   * 3. Deze pagina volgt de voortgang (zie useEffect hieronder).
   */
  async function handleSend() {
    if (saving) return;
    setSaving(true); setSaveError(null); setDownloadOk(null);
    const stamp = boekdatum.replace(/-/g, '');
    const batchId = `${stamp}-${entity}-${Date.now().toString().slice(-6)}`;
    const batch = buildBatch({
      rows, rowState, entity, boekdatumISO: boekdatum, fileName, modal, batchId,
    });
    try {
      const r = await fetch('/api/finance/prepay/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `server gaf ${r.status}`);
      setBatchRec(j);
      setSent(j.payload);
      setLive(null);
      startBridge(j.launch);
      setTimeout(() => voortgangRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Opent de eagleprepay://-link; Windows geeft die door aan de Bridge. */
  function startBridge(launch) {
    if (!launch) return;
    try {
      const a = document.createElement('a');
      a.href = launch;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setLaunched(true);
    } catch {
      setLaunched(false);
    }
  }

  /** Fallback: hetzelfde batchbestand downloaden (dubbelklik start de Bridge). */
  function downloadBatch() {
    if (!batchRec) return;
    try {
      const blob = new Blob([JSON.stringify(batchRec.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = batchRec.bestandsnaam;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDownloadOk(true);
    } catch {
      setDownloadOk(false);
    }
  }

  /* -------------------------------------------------- voortgang volgen */

  useEffect(() => {
    if (!batchRec?.id) return undefined;
    const supabase = createClient();
    let stop = false;
    let timer = null;

    async function haal() {
      if (stop) return;
      try {
        const [b, r, e] = await Promise.all([
          supabase.from('eagle_prepay_batches')
            .select('id,batch_id,status,laatste_bericht,eagle_store,eagle_user,machine,bridge_versie,geboekt,overgeslagen,fout,aantal_regels,store,started_at,finished_at,updated_at')
            .eq('id', batchRec.id).maybeSingle(),
          supabase.from('eagle_prepay_rows')
            .select('rij,vendor_ref_no,invoice_amount,voucher_ref,status,stap,voucher,reden,updated_at')
            .eq('batch_uuid', batchRec.id).order('rij'),
          supabase.from('eagle_prepay_events')
            .select('id,rij,tijd,niveau,bericht')
            .eq('batch_uuid', batchRec.id).order('id', { ascending: false }).limit(60),
        ]);
        if (stop) return;
        setLive({
          batch: b.data || null,
          rows: r.data || [],
          events: (e.data || []).slice().reverse(),
          fout: b.error?.message || r.error?.message || e.error?.message || null,
        });
        const status = b.data?.status;
        if (status === 'afgerond' || status === 'gestopt') return; // klaar: niet meer pollen
      } catch (err) {
        if (!stop) setLive(prev => ({ ...(prev || { batch: null, rows: [], events: [] }), fout: err.message }));
      }
      timer = setTimeout(haal, 2000);
    }
    haal();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [batchRec?.id]);

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
        <span className="ml-auto text-[12px] text-gray-400">De Eagle Bridge op deze PC typt de regels in New A/P Transactions</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        {/* store-instructie: prominent, want Curaçao en Bonaire zijn twee stores */}
        <div className={`px-5 py-4 border-b border-gray-200 flex items-center gap-4 flex-wrap ${entity ? 'bg-[#1B3A5C]/5' : 'bg-gray-50'}`}>
          <div className="flex-none w-14 h-14 rounded-xl bg-[#1B3A5C] text-white flex items-center justify-center font-mono text-[26px] font-bold">
            {entity ? STORE_VAN[entity] : '?'}
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Vóór je start: Eagle op de juiste store</div>
            <div className="text-[15px] font-semibold text-[#1B3A5C] mt-0.5">
              {entity
                ? <>Zet Eagle op <span className="font-mono">Store {STORE_VAN[entity]}</span> — {ENTITEITEN.find(e => e.code === entity)?.naam}, en open <span className="font-mono">New A/P Transactions</span>.</>
                : <>Kies eerst een entiteit in stap 1. Curaçao = Store 1, Bonaire = Store B.</>}
            </div>
            <p className="text-[12.5px] text-gray-500 mt-1">
              De store staat bovenin het Eagle-venster ("Store: 1" of "Store: B"). De Bridge controleert dit
              zelf en weigert te boeken als het niet klopt — maar dan moet je opnieuw beginnen.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px] text-[13px] text-gray-600">
            {!rows.length ? <><strong className="text-[#1B3A5C]">Nog geen bestand.</strong> Lees eerst een aanbetalingslijst in.</>
              : !entity ? <><strong className="text-[#1B3A5C]">Kies eerst een entiteit.</strong> Zonder die keuze staat niet vast op welke rekening en store geboekt wordt.</>
              : datumFout ? <><strong className="text-[#1B3A5C]">De boekdatum klopt niet.</strong> {datumFout}</>
              : actionRows.length ? <><strong className="text-[#1B3A5C]">{actionRows.length} regel(s) wachten op bevestiging.</strong> Bevestig ze of haal ze uit de batch.</>
              : !batchRows.length ? <><strong className="text-[#1B3A5C]">Geen boekbare regels.</strong> Alles staat op de lijst handmatig boeken.</>
              : batchRec ? <>
                  <strong className="text-emerald-700">Batch {batchRec.batchId} is klaargezet en de Eagle Bridge is gestart.</strong>{' '}
                  <span className="text-gray-500">
                    Op deze PC opent een venster van de Bridge; druk daar op Enter en raak muis en toetsenbord niet aan. De voortgang zie je hieronder.
                  </span>
                  <br />
                  <span className="text-gray-500">
                    Gebeurt er niets? Dan is de Bridge op deze PC nog niet geïnstalleerd, of blokkeert de browser de link:{' '}
                    <button type="button" onClick={() => startBridge(batchRec.launch)} className="text-[#1B3A5C] underline underline-offset-2">opnieuw starten</button>
                    {' '}of{' '}
                    <button type="button" onClick={downloadBatch} className="text-[#1B3A5C] underline underline-offset-2">batchbestand downloaden</button>
                    {' '}en dubbelklikken.
                  </span>
                  {downloadOk === true && <><br /><span className="text-emerald-700">Gedownload als {batchRec.bestandsnaam}.</span></>}
                  {downloadOk === false && <><br /><span className="text-red-700 font-medium">De download werd geblokkeerd. Sta downloads toe voor deze site.</span></>}
                </>
              : <>
                  <strong className="text-[#1B3A5C]">
                    {batchRows.length} regel(s) klaar voor {ENTITEITEN.find(e => e.code === entity)?.naam}.
                  </strong>{' '}
                  Rekening {PREPAY_CONFIG.apAccountMain}-{entity}, distributie {PREPAY_CONFIG.distributionAccountMain}-{entity},
                  datum {eagleDate(boekdatumObj)}, totaal XCG {nlAmount(totXcg)}
                  {manualRows.length ? ` · ${manualRows.length} regel(s) blijven achter voor handmatig boeken.` : '.'}
                </>}
            {saveError && (
              <><br /><span className="text-red-700 font-medium">Klaarzetten mislukt: {saveError}</span></>
            )}
          </div>
          {!batchRec ? (
            <button type="button" disabled={blocked || saving} onClick={handleSend}
              className="px-5 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13.5px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? 'Klaarzetten…' : 'Boeken in Eagle'}
            </button>
          ) : (
            <button type="button" onClick={resetAll}
              className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
              Nieuwe batch
            </button>
          )}
          <button type="button" onClick={() => setShowPayload(v => !v)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
            {showPayload ? 'Verberg' : 'Toon wat de Bridge ontvangt'}
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

      {/* STAP 5 — voortgang */}
      {batchRec && (
        <div ref={voortgangRef}>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">5</span>
            <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Voortgang in Eagle</h2>
            <span className="ml-auto text-[12px] text-gray-400">Wordt elke 2 seconden bijgewerkt</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
            {(() => {
              const b = live?.batch;
              const lrows = live?.rows || [];
              const n = b?.aantal_regels || batchRows.length;
              const geboekt = lrows.filter(r => r.status === 'geboekt').length;
              const overgeslagen = lrows.filter(r => r.status === 'overgeslagen').length;
              const klaarAantal = geboekt + overgeslagen;
              const pct = n ? Math.round((klaarAantal / n) * 100) : 0;
              const status = b?.status || 'klaar';
              return (
                <>
                  <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-4 flex-wrap">
                    <BatchPill status={status} />
                    <div className="text-[13px] text-gray-600">
                      {status === 'klaar' && !launched && 'De Bridge is nog niet gestart.'}
                      {status === 'klaar' && launched && 'Wacht tot je in het Bridge-venster op Enter drukt…'}
                      {status === 'bezig' && (b?.laatste_bericht || 'Bezig…')}
                      {status === 'afgerond' && <span className="text-emerald-700 font-medium">{b?.geboekt ?? geboekt} geboekt{(b?.overgeslagen ?? overgeslagen) ? `, ${b?.overgeslagen ?? overgeslagen} al eerder gedaan` : ''}.</span>}
                      {status === 'gestopt' && <span className="text-red-700 font-medium">{b?.laatste_bericht || 'Gestopt.'}</span>}
                    </div>
                    {b?.eagle_store && (
                      <div className="ml-auto text-[12px] text-gray-500 font-mono">
                        Store {b.eagle_store} · {b.eagle_user || '?'}{b.machine ? ` · ${b.machine}` : ''}
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between text-[12px] text-gray-500 mb-1.5">
                      <span>{klaarAantal} van {n} regel(s) klaar</span>
                      <span className="font-mono">{pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${status === 'gestopt' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-[13.5px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {['Rij', 'Fact.nummer', 'XCG', 'Voucher Ref', 'Status', 'Stap', 'Voucher', 'Melding'].map((h, i) => (
                            <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 whitespace-nowrap ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {!lrows.length && (
                          <tr><td colSpan={8} className="px-5 py-6 text-center text-gray-400 text-[13px]">
                            {live?.fout ? `Voortgang kan niet gelezen worden: ${live.fout}` : 'Voortgang wordt opgehaald…'}
                          </td></tr>
                        )}
                        {lrows.map(r => (
                          <tr key={r.rij} className={`border-b border-gray-100 ${r.status === 'bezig' ? 'bg-blue-50' : r.status === 'gestopt' ? 'bg-red-50' : r.status === 'geboekt_handmatig' ? 'bg-amber-50' : ''}`}>
                            <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{r.rij}</td>
                            <td className="px-3 py-2 font-mono text-[12.5px]">{r.vendor_ref_no}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{nlAmount(r.invoice_amount)}</td>
                            <td className="px-3 py-2 font-mono text-[12px] text-gray-600">{r.voucher_ref}</td>
                            <td className="px-3 py-2"><RowPill status={r.status} /></td>
                            <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.stap || ''}</td>
                            <td className="px-3 py-2 font-mono text-[12.5px] text-[#1B3A5C]">{r.voucher || ''}</td>
                            <td className="px-3 py-2 text-[12px] text-gray-600 max-w-[320px]"><div className="line-clamp-2">{r.reden || ''}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-gray-200">
                    <div className="px-5 py-2 bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-500 flex items-center">
                      Logboek van de Bridge
                      <span className="ml-auto normal-case tracking-normal font-normal text-gray-400">laatste {Math.min(60, (live?.events || []).length)} regels</span>
                    </div>
                    <div className="px-5 py-3 max-h-[260px] overflow-y-auto font-mono text-[12px] leading-relaxed bg-white">
                      {!(live?.events || []).length && <div className="text-gray-400">Nog geen meldingen.</div>}
                      {(live?.events || []).map(ev => (
                        <div key={ev.id} className={`flex gap-3 ${ev.niveau === 'ERROR' ? 'text-red-700' : ev.niveau === 'WARN' ? 'text-amber-700' : 'text-gray-700'}`}>
                          <span className="text-gray-400 flex-none">{tijd(ev.tijd)}</span>
                          <span className="text-gray-400 flex-none w-8 text-right">{ev.rij ? `r${ev.rij}` : ''}</span>
                          <span className="whitespace-pre-wrap break-words">{ev.bericht}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}
