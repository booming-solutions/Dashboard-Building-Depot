/* ============================================================
   BESTAND: page.js  (Automatisering — BDMM facturen)
   KOPIEER NAAR: src/app/dashboard/finance/automatisering/bdmm/page.js   (NIEUW)

   DOEL: het Exact-uittreksel van BDMM Trading B.V. (één tabblad per
   entiteit: BDT, BDB, MMC, RCC) inlezen, controleren en per entiteit
   als batch door Booming in Eagle laten boeken — dezelfde opzet als
   Keukendepot (Vooruitbetalingen).

   - Debet = factuur (Trx Type R), Credit = creditnota (Trx Type C).
   - EUR × koers = XCG (koers standaard 2,00, per batch aanpasbaar).
   - AP 2000-{entiteit}, distributie 2999-{entiteit}, Terms Code 1.
   - Boekdatum: laatste dag vorige maand, max 50 dagen terug.
   - Leveranciersnummer per entiteit: 4811 / 4815 / 4814 / 4816.

   Spelregels en parsing: src/lib/eagleBdmm.js.
   Batches gaan via /api/finance/prepay/batches (soort 'bdmm') en zijn
   terug te vinden in Keukendepot › Historie en in de Boekingscheck.

   Recht: finance_bdmm.
   ============================================================ */
'use client';

import { Fragment, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import {
  lastDayPrevMonth, toISODate, parseISODate, eagleDate, nlDate,
  minBoekdatum, checkBoekdatum, money, nlAmount,
} from '@/lib/eaglePrepay';
import {
  BDMM_CONFIG, BDMM_ENTITEITEN, readWorkbookBdmm, analyseRowsBdmm,
  statusOfBdmm, inBatchBdmm, isManualBdmm, buildBatchBdmm,
} from '@/lib/eagleBdmm';

const STORE_VAN = { '000': '1', '700': 'B', '600': 'M', '400': 'R' };

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

function RowPill({ status }) {
  const map = {
    wachten:           ['Wacht', 'bg-gray-100 text-gray-600'],
    bezig:             ['Bezig', 'bg-blue-100 text-blue-800 animate-pulse'],
    geboekt:           ['Geboekt', 'bg-emerald-100 text-emerald-800'],
    overgeslagen:      ['Al geboekt', 'bg-gray-200 text-gray-600'],
    gestopt:           ['Fout — niet geboekt', 'bg-red-100 text-red-800'],
    geboekt_handmatig: ['Afmaken in Eagle', 'bg-amber-100 text-amber-800'],
    geweigerd:         ['Geweigerd door Eagle', 'bg-amber-100 text-amber-800'],
  };
  const [label, cls] = map[status] || map.wachten;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

function BatchPill({ status }) {
  const map = {
    klaar:    ['Klaargezet — wacht op Booming', 'bg-gray-100 text-gray-700'],
    bezig:    ['Bezig in Eagle', 'bg-blue-100 text-blue-800'],
    afgerond: ['Afgerond', 'bg-emerald-100 text-emerald-800'],
    gestopt:  ['Gestopt', 'bg-red-100 text-red-800'],
  };
  const [label, cls] = map[status] || map.klaar;
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-bold ${cls}`}>
    {status === 'bezig' && <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />}{label}
  </span>;
}

function Tile({ k, v, s, tone }) {
  const toneCls = tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'err' ? 'text-red-700' : 'text-[#1B3A5C]';
  return (
    <div className="px-4 py-3 border-r border-gray-100 last:border-r-0">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{k}</div>
      <div className={`mt-1 text-[20px] font-bold tabular-nums ${toneCls}`}>{v}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{s}</div>
    </div>
  );
}

function tijd(iso) {
  try { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; }
}

/* ------------------------------------------------------------- pagina */

export default function BdmmPage() {
  const vandaag = useMemo(() => new Date(), []);
  const fileRef = useRef(null);

  const [boekdatum, setBoekdatum] = useState(toISODate(lastDayPrevMonth(vandaag)));
  const [koers, setKoers] = useState(String(BDMM_CONFIG.koersStandaard.toFixed(2)));
  const [fileName, setFileName] = useState(null);
  const [tabbladen, setTabbladen] = useState([]);       // uit readWorkbookBdmm
  const [overgeslagen, setOvergeslagen] = useState([]);
  const [tab, setTab] = useState(null);                 // geselecteerd tabblad (naam)
  const [rowState, setRowState] = useState({});         // `${tab}|${excelRow}` -> { status }
  const [openRow, setOpenRow] = useState({});
  const [filter, setFilter] = useState('alles');
  const [dragOver, setDragOver] = useState(false);
  const [readError, setReadError] = useState(null);
  const [eerder, setEerder] = useState({});

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [batchRec, setBatchRec] = useState(null);
  const [live, setLive] = useState(null);
  const [launched, setLaunched] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const voortgangRef = useRef(null);

  const minDatum = useMemo(() => minBoekdatum(vandaag), [vandaag]);
  const maxDatum = useMemo(() => new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate())), [vandaag]);
  const datumFout = checkBoekdatum(boekdatum, vandaag);
  const koersNum = Number(String(koers).replace(',', '.'));
  const koersFout = !(koersNum > 0 && koersNum < 10) ? 'Vul een geldige koers in (bijv. 2,00).' : null;

  const huidig = tabbladen.find(t => t.naam === tab) || null;
  const entity = huidig ? huidig.entiteit : null;

  const rows = useMemo(() => {
    if (!huidig) return [];
    return analyseRowsBdmm(huidig.rows, huidig.entiteit.vendor, koersNum > 0 ? koersNum : BDMM_CONFIG.koersStandaard, eerder);
  }, [huidig, koersNum, eerder]);

  const key = useCallback((r) => `${tab}|${r.excelRow}`, [tab]);
  const st = useCallback((r) => rowState[key(r)] || { status: 'pending' }, [rowState, key]);
  const setSt = useCallback((r, patch) => {
    setRowState(prev => ({ ...prev, [key(r)]: { ...(prev[key(r)] || { status: 'pending' }), ...patch } }));
  }, [key]);

  const batchRows = rows.filter(r => inBatchBdmm(r, st(r)));
  const actionRows = rows.filter(r => statusOfBdmm(r, st(r)) === 'action');
  const manualRows = rows.filter(r => isManualBdmm(r, st(r)));
  const totEur = batchRows.reduce((s, r) => s + r.eur, 0);
  const totXcg = batchRows.reduce((s, r) => s + r.xcg, 0);
  const nCredit = batchRows.filter(r => r.isCredit).length;

  const blocked = !entity || !!datumFout || !!koersFout || actionRows.length > 0 || batchRows.length === 0;

  /* --------------------------------------------------------- inlezen */

  function resetAll() {
    setFileName(null); setTabbladen([]); setOvergeslagen([]); setTab(null); setRowState({}); setOpenRow({});
    setFilter('alles'); setReadError(null); setBatchRec(null); setLive(null); setLaunched(false); setSaveError(null); setShowPayload(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const res = readWorkbookBdmm(e.target.result);
      if (fileRef.current) fileRef.current.value = '';
      if (!res.ok) { setReadError(res.error); return; }
      setReadError(null);
      setFileName(file.name);
      setTabbladen(res.tabbladen);
      setOvergeslagen(res.overgeslagen || []);
      setTab(res.tabbladen[0]?.naam || null);
      setRowState({}); setOpenRow({}); setFilter('alles');
      setBatchRec(null); setLive(null); setLaunched(false); setSaveError(null);
    };
    reader.readAsArrayBuffer(file);
  }

  // eerder geboekt (alle tabbladen in één keer)
  useEffect(() => {
    if (!tabbladen.length) { setEerder({}); return undefined; }
    let stop = false;
    const keys = [];
    tabbladen.forEach(t => t.rows.forEach(r => { if (r.onzeRef) keys.push(`${t.entiteit.vendor}|${r.onzeRef}`); }));
    const uniek = Array.from(new Set(keys));
    if (!uniek.length) return undefined;
    (async () => {
      try {
        const supabase = createClient();
        const map = {};
        for (let i = 0; i < uniek.length; i += 200) {
          const { data, error } = await supabase
            .from('eagle_prepay_rows')
            .select('dedupe_key,status,voucher,reden,invoice_amount,updated_at,eagle_prepay_batches(batch_id,created_by,entiteit_naam)')
            .in('dedupe_key', uniek.slice(i, i + 200))
            .in('status', ['geboekt', 'geboekt_handmatig', 'bezig', 'geweigerd'])
            .order('updated_at', { ascending: false });
          if (error || !data) continue;
          data.forEach(r => {
            if (map[r.dedupe_key]) return;
            map[r.dedupe_key] = {
              status: r.status, voucher: r.voucher, reden: r.reden, bedrag: r.invoice_amount, tijd: r.updated_at,
              batch_id: r.eagle_prepay_batches?.batch_id, door: r.eagle_prepay_batches?.created_by,
            };
          });
        }
        if (!stop) setEerder(map);
      } catch { /* geen centrale controle; Booming heeft zijn eigen ledger */ }
    })();
    return () => { stop = true; };
  }, [tabbladen]);

  /* ---------------------------------------------------------- boeken */

  async function handleSend() {
    if (saving || !huidig) return;
    setSaving(true); setSaveError(null);
    const stamp = boekdatum.replace(/-/g, '');
    const batchId = `${stamp}-${entity.code}-BDMM-${Date.now().toString().slice(-6)}`;
    const rs = {}; rows.forEach(r => { rs[r.excelRow] = st(r); });
    const batch = buildBatchBdmm({
      rows, rowState: rs, entiteit: entity.code, boekdatumISO: boekdatum, koers: koersNum, fileName, tabblad: huidig.naam, batchId,
    });
    try {
      const r = await fetch('/api/finance/prepay/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `server gaf ${r.status}`);
      setBatchRec(j);
      setLive(null);
      startBooming(j.launch);
      setTimeout(() => voortgangRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  function startBooming(launch) {
    if (!launch) return;
    try {
      const a = document.createElement('a'); a.href = launch; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setLaunched(true);
    } catch { setLaunched(false); }
  }

  function downloadBatch() {
    if (!batchRec) return;
    try {
      const blob = new Blob([JSON.stringify(batchRec.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = batchRec.bestandsnaam;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* niets */ }
  }

  useEffect(() => {
    if (!batchRec?.id) return undefined;
    const supabase = createClient();
    let stop = false; let timer = null;
    async function haal() {
      if (stop) return;
      try {
        const [b, r, e] = await Promise.all([
          supabase.from('eagle_prepay_batches')
            .select('id,batch_id,status,laatste_bericht,eagle_store,eagle_user,machine,geboekt,overgeslagen,fout,aantal_regels,store,started_at,finished_at,updated_at')
            .eq('id', batchRec.id).maybeSingle(),
          supabase.from('eagle_prepay_rows')
            .select('rij,vendor_ref_no,invoice_amount,voucher_ref,status,stap,voucher,reden,updated_at')
            .eq('batch_uuid', batchRec.id).order('rij'),
          supabase.from('eagle_prepay_events')
            .select('id,rij,tijd,niveau,bericht').eq('batch_uuid', batchRec.id).order('id', { ascending: false }).limit(60),
        ]);
        if (stop) return;
        setLive({ batch: b.data || null, rows: r.data || [], events: (e.data || []).slice().reverse(), fout: b.error?.message || r.error?.message || null });
        const status = b.data?.status;
        if (status === 'afgerond' || status === 'gestopt') return;
      } catch (err) {
        if (!stop) setLive(prev => ({ ...(prev || { batch: null, rows: [], events: [] }), fout: err.message }));
      }
      timer = setTimeout(haal, 2000);
    }
    haal();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [batchRec?.id]);

  /* ---------------------------------------------------------- render */

  const shown = rows.filter(r => {
    const s = statusOfBdmm(r, st(r));
    if (filter === 'actie') return s === 'action';
    if (filter === 'batch') return inBatchBdmm(r, st(r));
    if (filter === 'handmatig') return isManualBdmm(r, st(r));
    return true;
  });
  const boekdatumObj = parseISODate(boekdatum);

  return (
    <div className="p-6 max-w-[1180px]">

      <div className="flex items-start gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">Finance · Automatisering</p>
          <h1 className="text-[24px] font-bold text-[#1B3A5C] mt-1">BDMM-facturen boeken in Eagle</h1>
          <p className="text-[13px] text-gray-500 mt-1 max-w-[66ch]">
            Upload het Exact-uittreksel van BDMM Trading (tabbladen BDT, BDB, MMC, RCC), kies de koers, bevestig wat opvalt,
            en laat Booming per entiteit de facturen (R) en creditnota&apos;s (C) in Eagle boeken.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <a href="/api/private/werkinstructie-vooruitbetalingen" target="_blank" rel="noopener"
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">Werkinstructie</a>
          <a href="/dashboard/finance/vooruitbetalingen#historie"
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">Historie</a>
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />Preview
          </span>
        </div>
      </div>

      {/* STAP 1 — datum en koers */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">1</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Boekdatum en koers</h2>
        <span className="ml-auto text-[12px] text-gray-400">Gelden voor alle tabbladen in dit bestand</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-3 mb-7">
        <div className={`rounded-xl border p-4 bg-white ${datumFout ? 'border-red-300' : 'border-gray-200'}`}>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Voucher &amp; invoice date</div>
          <div className="font-mono text-[21px] font-bold text-[#1B3A5C] mt-1">{eagleDate(boekdatumObj)}</div>
          <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">Standaard de laatste dag van de vorige maand — {nlDate(boekdatumObj)}. De factuurdatum uit Exact wordt niet gebruikt.</p>
          <input type="date" value={boekdatum} min={toISODate(minDatum)} max={toISODate(maxDatum)}
            onChange={e => { if (e.target.value) { setBoekdatum(e.target.value); setBatchRec(null); } }}
            className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] font-mono focus:outline-none focus:border-[#1B3A5C]" />
          <p className="text-[11px] text-gray-400 mt-1.5">Vroegst toegestaan: {nlDate(minDatum)} — maximaal {BDMM_CONFIG.maxDagenTerug} dagen terug.</p>
          {datumFout && <p className="text-[12px] text-red-700 font-medium mt-1.5">{datumFout}</p>}
        </div>
        <div className={`rounded-xl border p-4 bg-white ${koersFout ? 'border-red-300' : 'border-gray-200'}`}>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Koers EUR → XCG</div>
          <div className="font-mono text-[21px] font-bold text-[#1B3A5C] mt-1">1 EUR = {Number.isFinite(koersNum) ? koersNum.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0') : '—'} XCG</div>
          <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">De bedragen in het bestand zijn euro&apos;s; in Eagle wordt XCG geboekt (EUR × koers, afgerond op centen).</p>
          <input type="text" inputMode="decimal" value={koers}
            onChange={e => { setKoers(e.target.value); setBatchRec(null); }}
            className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] font-mono focus:outline-none focus:border-[#1B3A5C]" />
          <p className="text-[11px] text-gray-400 mt-1.5">Standaard {BDMM_CONFIG.koersStandaard.toFixed(2)}. Pas aan als de koers afwijkt; de gebruikte koers wordt bij de batch bewaard.</p>
          {koersFout && <p className="text-[12px] text-red-700 font-medium mt-1.5">{koersFout}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 p-4 bg-white">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Vaste waarden</div>
          <dl className="mt-2 grid grid-cols-[130px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-gray-400">Debet / Credit</dt><dd className="font-mono text-[#1B3A5C]">Trx Type R / C</dd>
            <dt className="text-gray-400">AP-rekening</dt><dd className="font-mono text-[#1B3A5C]">{BDMM_CONFIG.apAccountMain}-entiteit</dd>
            <dt className="text-gray-400">Distributie</dt><dd className="font-mono text-[#1B3A5C]">{BDMM_CONFIG.distributionAccountMain}-entiteit</dd>
            <dt className="text-gray-400">Terms Code</dt><dd className="font-mono text-[#1B3A5C]">{BDMM_CONFIG.termsCode} ({BDMM_CONFIG.termsCodeLabel})</dd>
            <dt className="text-gray-400">Factuurnummer</dt><dd className="font-mono text-[#1B3A5C]">kolom &quot;Onze ref.&quot;</dd>
            <dt className="text-gray-400">Voucher Ref</dt><dd className="font-mono text-[#1B3A5C]">{BDMM_CONFIG.voucherRefPrefix} …</dd>
          </dl>
        </div>
      </div>

      {/* STAP 2 — bestand */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">2</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Bestand en entiteit</h2>
        <span className="ml-auto text-[12px] text-gray-400">Exact-uittreksel &quot;Kaart | Relatie&quot;, één tabblad per entiteit</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-7">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
          className={`rounded-xl border-2 border-dashed p-5 flex items-center gap-4 flex-wrap transition-colors ${dragOver ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-300 bg-gray-50'}`}>
          <div className="flex-1 min-w-[240px]">
            <strong className="block text-[14px] text-[#1B3A5C]">{tabbladen.length ? 'Bestand geladen' : 'Sleep de Excel hierheen'}</strong>
            <p className="text-[12.5px] text-gray-500 mt-0.5">
              {tabbladen.length ? `${fileName} · ${tabbladen.length} tabblad(en) met facturen` : 'Alleen .xlsx. Tabbladen BDT, BDB, MMC en RCC worden herkend; andere tabbladen worden overgeslagen.'}
            </p>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:brightness-110">
            {tabbladen.length ? 'Bestand vervangen' : 'Bestand kiezen'}
          </button>
          {tabbladen.length > 0 && (
            <button type="button" onClick={resetAll} className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-[13px] font-semibold hover:bg-red-50">Leegmaken</button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </div>
        {readError && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-[13px] text-red-800 whitespace-pre-line">{readError}</div>}
        {overgeslagen.length > 0 && tabbladen.length > 0 && (
          <div className="mt-3 text-[12px] text-gray-400">Overgeslagen tabblad(en): {overgeslagen.join(', ')}.</div>
        )}

        {tabbladen.length > 0 && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {tabbladen.map(t => {
              const on = tab === t.naam;
              const eur = t.rows.reduce((s, r) => s + r.eur, 0);
              const nc = t.rows.filter(r => r.isCredit).length;
              return (
                <button key={t.naam} type="button" onClick={() => { setTab(t.naam); setFilter('alles'); setBatchRec(null); setLive(null); }}
                  className={`text-left rounded-xl border p-4 transition-all ${on ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${on ? 'border-[#1B3A5C] bg-[#1B3A5C] ring-2 ring-inset ring-white' : 'border-gray-300'}`} />
                    <span className="font-semibold text-[14px] text-[#1B3A5C]">{t.entiteit.naam}</span>
                  </div>
                  <div className="mt-2 text-[11px] text-gray-400 font-mono">tabblad {t.naam} · entiteit {t.entiteit.code} · vendor {t.entiteit.vendor}</div>
                  <div className="mt-3 pt-3 border-t border-dashed border-gray-200 grid grid-cols-2 gap-2">
                    <div><div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Regels</div><div className="font-mono text-[13px] text-[#1B3A5C]">{t.rows.length}{nc ? <span className="text-gray-400"> ({nc} credit)</span> : ''}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">EUR</div><div className="font-mono text-[13px] text-[#1B3A5C]">{nlAmount(eur)}</div></div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* samenvatting */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        <Tile k="Regels" v={rows.length || '—'} s={huidig ? `tabblad ${huidig.naam}` : 'kies een tabblad'} />
        <Tile k="Te boeken EUR" v={rows.length ? nlAmount(totEur) : '—'} s={`${batchRows.length} regel(s)`} />
        <Tile k="Te boeken XCG" v={rows.length ? nlAmount(totXcg) : '—'} s={`koers ${Number.isFinite(koersNum) ? koersNum : '—'}`} tone={batchRows.length ? 'ok' : null} />
        <Tile k="Creditnota's" v={rows.length ? nCredit : '—'} s="Trx Type C" tone={nCredit ? 'warn' : null} />
        <Tile k="Te bevestigen" v={rows.length ? actionRows.length : '—'} s={actionRows.length ? 'vraagt om een keuze' : 'niets open'} tone={actionRows.length ? 'warn' : null} />
        <Tile k="Handmatig" v={rows.length ? manualRows.length : '—'} s={manualRows.length ? 'gaat niet mee' : 'geen'} tone={manualRows.length ? 'err' : null} />
      </div>

      {/* STAP 3 — controle */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">3</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Controle</h2>
        <span className="ml-auto text-[12px] text-gray-400">
          {!rows.length ? 'Nog geen tabblad' : actionRows.length ? `${actionRows.length} regel(s) wachten op bevestiging` : 'Dubbelen, creditnota’s en eerder geboekt gecontroleerd'}
        </span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          {[['alles', 'Alle regels', rows.length], ['actie', 'Te bevestigen', actionRows.length], ['batch', 'Gaat naar Eagle', batchRows.length], ['handmatig', 'Handmatig', manualRows.length]].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-[12.5px] border transition-all ${filter === k ? 'bg-[#1B3A5C] border-[#1B3A5C] text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {label} ({n})
            </button>
          ))}
          {actionRows.length > 0 && (
            <button type="button" onClick={() => actionRows.forEach(r => setSt(r, { status: 'confirmed' }))}
              className="ml-auto text-[12px] text-[#1B3A5C] underline underline-offset-2">alle {actionRows.length} bevestigen</button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13.5px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Rij', 'Datum Exact', 'Onze ref.', 'Omschrijving', 'Type', 'EUR', 'XCG', 'Voucher Ref', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 whitespace-nowrap ${[5, 6].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400 text-[13.5px]">Nog geen bestand of tabblad gekozen.</td></tr>}
              {rows.length > 0 && !shown.length && <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400 text-[13.5px]">Geen regels in deze selectie.</td></tr>}
              {shown.map(row => {
                const s = statusOfBdmm(row, st(row));
                const rowCls = s === 'error' ? 'bg-red-50' : s === 'action' ? 'bg-amber-50' : s === 'removed' ? 'opacity-50' : '';
                return (
                  <Fragment key={row.excelRow}>
                    <tr className={`border-b border-gray-100 ${rowCls}`}>
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{row.excelRow}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.datum ? nlDate(parseISODate(row.datum)) : '—'}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{row.onzeRef}</td>
                      <td className="px-3 py-2 max-w-[260px] truncate" title={row.omschrijving}>{row.omschrijving}</td>
                      <td className="px-3 py-2"><span className={`font-mono text-[11px] font-bold rounded px-1.5 py-px ${row.isCredit ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{row.trxType}</span></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{nlAmount(row.eur)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{nlAmount(row.xcg)}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{row.voucherRef}</td>
                      <td className="px-3 py-2"><Pill status={s} /></td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpenRow(o => ({ ...o, [row.excelRow]: !o[row.excelRow] }))} className="text-[12px] text-[#1B3A5C] underline underline-offset-2">
                          {openRow[row.excelRow] ? 'verberg' : 'record'}
                        </button>
                      </td>
                    </tr>
                    {row.errors.length > 0 && (
                      <tr className="border-b border-gray-100 bg-gray-50"><td colSpan={10} className="px-5 py-3">
                        <div className="border-l-[3px] border-red-500 pl-3.5">
                          <div className="text-[13.5px] font-semibold text-red-700">Deze regel kan niet geboekt worden</div>
                          <ul className="mt-1.5 space-y-1">{row.errors.map((e, i) => <li key={i} className="text-[13px] text-gray-700">{e}</li>)}</ul>
                          <div className="text-[12.5px] text-gray-400 mt-1.5">Staat op de lijst handmatig boeken.</div>
                        </div>
                      </td></tr>
                    )}
                    {row.errors.length === 0 && row.flags.length > 0 && (
                      <tr className="border-b border-gray-100 bg-gray-50"><td colSpan={10} className="px-5 py-3.5">
                        <div className={`border-l-[3px] pl-3.5 ${s === 'confirmed' ? 'border-emerald-500' : s === 'removed' ? 'border-gray-400' : 'border-amber-500'}`}>
                          <div className={`text-[13.5px] font-semibold ${s === 'confirmed' ? 'text-emerald-700' : s === 'removed' ? 'text-gray-500' : 'text-amber-700'}`}>
                            {s === 'confirmed' ? 'Bevestigd — gaat mee in de batch' : s === 'removed' ? 'Uit de batch gehaald — staat op de lijst handmatig boeken' : 'Bevestiging nodig'}
                          </div>
                          <ul className="mt-2 space-y-1.5">
                            {row.flags.map((f, i) => (
                              <li key={i} className="flex gap-2.5 text-[13px] text-gray-700 max-w-[80ch]">
                                <span className="font-mono text-[10.5px] font-semibold bg-white border border-gray-200 rounded px-1.5 py-px flex-none">{f.code}</span><span>{f.text}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 flex gap-2.5 flex-wrap">
                            {s === 'removed' ? (
                              <button type="button" onClick={() => setSt(row, { status: 'pending' })} className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">Terugzetten in de batch</button>
                            ) : (
                              <>
                                {s !== 'confirmed'
                                  ? <button type="button" onClick={() => setSt(row, { status: 'confirmed' })} className="px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[12.5px] font-semibold hover:brightness-110">Bevestigen en meenemen</button>
                                  : <button type="button" onClick={() => setSt(row, { status: 'pending' })} className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] font-semibold text-[#1B3A5C] hover:bg-gray-50">Bevestiging intrekken</button>}
                                <button type="button" onClick={() => setSt(row, { status: 'removed' })} className="px-3 py-1.5 rounded-lg border border-red-200 text-[12.5px] font-semibold text-red-700 hover:bg-red-50">Uit batch halen</button>
                              </>
                            )}
                          </div>
                        </div>
                      </td></tr>
                    )}
                    {openRow[row.excelRow] && (
                      <tr className="border-b border-gray-100 bg-gray-50"><td colSpan={10} className="px-5 py-4">
                        <div className="max-w-[760px] rounded-lg border border-gray-200 bg-white overflow-hidden">
                          <div className="px-3.5 py-2 bg-gray-100 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-500">Wat Booming in Eagle invult · rij {row.excelRow}</div>
                          <dl className="grid grid-cols-[220px_1fr]">
                            {[
                              ['Trx Type', row.trxType + (row.isCredit ? '  (creditnota)' : '  (factuur)')],
                              ['Vendor', entity?.vendor],
                              ['Voucher Date / Invoice Date', eagleDate(boekdatumObj)],
                              ['Vendor Ref No', row.onzeRef],
                              ['AP Account', `${BDMM_CONFIG.apAccountMain} - ${entity?.code}`],
                              ['Terms Code', `${BDMM_CONFIG.termsCode}  (${BDMM_CONFIG.termsCodeLabel})`],
                              ['Voucher Ref', row.voucherRef],
                              ['Invoice Amount', `${money(row.xcg)}  (EUR ${money(row.eur)} × ${koersNum})`],
                              ['Due Date / Disc Date', eagleDate(boekdatumObj)],
                              ['Add', 'F4'],
                              ['Distribution — account', `${BDMM_CONFIG.distributionAccountMain} - ${entity?.code}`],
                              ['Distribution — bedrag', money(row.xcg)],
                            ].map(([k, v], i, arr) => (
                              <Fragment key={k}>
                                <dt className={`px-3.5 py-1.5 text-[13px] text-gray-400 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>{k}</dt>
                                <dd className={`px-3.5 py-1.5 font-mono text-[12.5px] text-[#1B3A5C] ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>{v}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </div>
                      </td></tr>
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
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  {['Rij', 'Onze ref.', 'Omschrijving', 'EUR', 'XCG', 'Reden', ''].map((h, i) => (
                    <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 ${[3, 4].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {manualRows.map(r => (
                    <tr key={r.excelRow} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{r.excelRow}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{r.onzeRef}</td>
                      <td className="px-3 py-2 max-w-[240px] truncate">{r.omschrijving}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{nlAmount(r.eur)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{nlAmount(r.xcg)}</td>
                      <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.errors.length ? r.errors.join(' ') : `Handmatig uit de batch gehaald${r.flags.length ? ' — ' + r.flags.map(f => f.code).join(', ') : ''}`}</td>
                      <td className="px-3 py-2">{!r.errors.length && <button type="button" onClick={() => setSt(r, { status: 'pending' })} className="text-[12px] text-[#1B3A5C] underline underline-offset-2">terugzetten</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* STAP 4 — naar Eagle */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-bold text-[#1B3A5C] bg-[#1B3A5C]/10 rounded px-2 py-0.5">4</span>
        <h2 className="text-[15px] font-semibold text-[#1B3A5C]">Naar Eagle</h2>
        <span className="ml-auto text-[12px] text-gray-400">Booming op deze PC typt de regels in New A/P Transactions</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-7">
        <div className={`px-5 py-4 border-b border-gray-200 flex items-center gap-4 flex-wrap ${entity ? 'bg-[#1B3A5C]/5' : 'bg-gray-50'}`}>
          <div className="flex-none w-14 h-14 rounded-xl bg-[#1B3A5C] text-white flex items-center justify-center font-mono text-[26px] font-bold">{entity ? (STORE_VAN[entity.code] || '?') : '?'}</div>
          <div className="flex-1 min-w-[260px]">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">Vóór je start: Eagle op de juiste store</div>
            <div className="text-[15px] font-semibold text-[#1B3A5C] mt-0.5">
              {entity
                ? <>Zet Eagle op <span className="font-mono">Store {STORE_VAN[entity.code] || '?'}</span> — {entity.naam}, en open <span className="font-mono">New A/P Transactions</span>.</>
                : <>Kies eerst een tabblad (entiteit) in stap 2.</>}
            </div>
            <p className="text-[12.5px] text-gray-500 mt-1">De store staat bovenin het Eagle-venster. Booming controleert dit zelf en weigert te boeken als het niet klopt.</p>
          </div>
        </div>
        <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px] text-[13px] text-gray-600">
            {!rows.length ? <><strong className="text-[#1B3A5C]">Nog geen bestand.</strong> Lees eerst het uittreksel in en kies een tabblad.</>
              : datumFout ? <><strong className="text-[#1B3A5C]">De boekdatum klopt niet.</strong> {datumFout}</>
              : koersFout ? <><strong className="text-[#1B3A5C]">De koers klopt niet.</strong> {koersFout}</>
              : actionRows.length ? <><strong className="text-[#1B3A5C]">{actionRows.length} regel(s) wachten op bevestiging.</strong> Bevestig ze of haal ze uit de batch.</>
              : !batchRows.length ? <><strong className="text-[#1B3A5C]">Geen boekbare regels.</strong></>
              : batchRec ? <>
                  <strong className="text-emerald-700">Batch {batchRec.batchId} is klaargezet en Booming is gestart.</strong>{' '}
                  <span className="text-gray-500">Druk in het Booming-venster op Enter en raak muis en toetsenbord niet aan. De voortgang zie je hieronder.</span><br />
                  <span className="text-gray-500">Gebeurt er niets? <button type="button" onClick={() => startBooming(batchRec.launch)} className="text-[#1B3A5C] underline underline-offset-2">opnieuw starten</button> of <button type="button" onClick={downloadBatch} className="text-[#1B3A5C] underline underline-offset-2">batchbestand downloaden</button> en dubbelklikken.</span>
                </>
              : <>
                  <strong className="text-[#1B3A5C]">{batchRows.length} regel(s) klaar voor {entity.naam}</strong>{' '}
                  — vendor {entity.vendor}, rekening {BDMM_CONFIG.apAccountMain}-{entity.code} / {BDMM_CONFIG.distributionAccountMain}-{entity.code}, datum {eagleDate(boekdatumObj)},
                  EUR {nlAmount(totEur)} → XCG {nlAmount(totXcg)}{nCredit ? `, waarvan ${nCredit} creditnota's (C)` : ''}
                  {manualRows.length ? ` · ${manualRows.length} regel(s) blijven achter voor handmatig boeken.` : '.'}
                  {tabbladen.length > 1 && <><br /><span className="text-gray-400">De andere tabbladen boek je daarna één voor één: kies het tabblad in stap 2 en start opnieuw.</span></>}
                </>}
            {saveError && <><br /><span className="text-red-700 font-medium">Klaarzetten mislukt: {saveError}</span></>}
          </div>
          {!batchRec ? (
            <button type="button" disabled={blocked || saving} onClick={handleSend}
              className="px-5 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13.5px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? 'Klaarzetten…' : `Boeken in Eagle${entity ? ` — ${entity.kort}` : ''}`}
            </button>
          ) : (
            <button type="button" onClick={() => { setBatchRec(null); setLive(null); setLaunched(false); }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">Volgend tabblad</button>
          )}
          <button type="button" onClick={() => setShowPayload(v => !v)} className="px-4 py-2 rounded-lg border border-gray-300 text-[13px] font-semibold text-[#1B3A5C] hover:bg-gray-50">
            {showPayload ? 'Verberg' : 'Toon wat Booming ontvangt'}
          </button>
        </div>
        {showPayload && huidig && (
          <pre className="px-5 py-4 bg-gray-50 border-t border-gray-200 font-mono text-[12px] leading-relaxed overflow-x-auto text-gray-600">
            {JSON.stringify(batchRec?.payload || buildBatchBdmm({ rows, rowState: Object.fromEntries(rows.map(r => [r.excelRow, st(r)])), entiteit: entity.code, boekdatumISO: boekdatum, koers: koersNum, fileName, tabblad: huidig.naam, batchId: null }), null, 2)}
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
              const b = live?.batch; const lrows = live?.rows || [];
              const n = b?.aantal_regels || batchRows.length;
              const klaarAantal = lrows.filter(r => r.status === 'geboekt' || r.status === 'overgeslagen').length;
              const pct = n ? Math.round((klaarAantal / n) * 100) : 0;
              const status = b?.status || 'klaar';
              return (
                <>
                  <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-4 flex-wrap">
                    <BatchPill status={status} />
                    <div className="text-[13px] text-gray-600">
                      {status === 'klaar' && !launched && 'Booming is nog niet gestart.'}
                      {status === 'klaar' && launched && 'Wacht tot je in het Booming-venster op Enter drukt…'}
                      {status === 'bezig' && (b?.laatste_bericht || 'Bezig…')}
                      {status === 'afgerond' && <span className="text-emerald-700 font-medium">{b?.geboekt ?? 0} geboekt{b?.overgeslagen ? `, ${b.overgeslagen} al eerder gedaan` : ''}{b?.fout ? <span className="text-amber-700">, {b.fout} uitzondering(en) — zie hieronder</span> : ''}.</span>}
                      {status === 'gestopt' && <span className="text-red-700 font-medium">{b?.laatste_bericht || 'Gestopt.'}</span>}
                    </div>
                    {b?.eagle_store && <div className="ml-auto text-[12px] text-gray-500 font-mono">Store {b.eagle_store} · {b.eagle_user || '?'}{b.machine ? ` · ${b.machine}` : ''}</div>}
                  </div>
                  <div className="px-5 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between text-[12px] text-gray-500 mb-1.5"><span>{klaarAantal} van {n} regel(s) klaar</span><span className="font-mono">{pct}%</span></div>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${status === 'gestopt' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-[13.5px]">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        {['Rij', 'Onze ref.', 'XCG', 'Voucher Ref', 'Status', 'Stap', 'Voucher', 'Melding'].map((h, i) => (
                          <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 whitespace-nowrap ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {!lrows.length && <tr><td colSpan={8} className="px-5 py-6 text-center text-gray-400 text-[13px]">{live?.fout ? `Voortgang kan niet gelezen worden: ${live.fout}` : 'Voortgang wordt opgehaald…'}</td></tr>}
                        {lrows.map(r => (
                          <tr key={r.rij} className={`border-b border-gray-100 ${r.status === 'bezig' ? 'bg-blue-50' : r.status === 'gestopt' ? 'bg-red-50' : (r.status === 'geboekt_handmatig' || r.status === 'geweigerd') ? 'bg-amber-50' : ''}`}>
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
                    <div className="px-5 py-2 bg-gray-50 border-b border-gray-200 text-[11px] uppercase tracking-wider font-semibold text-gray-500">Logboek van Booming</div>
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
