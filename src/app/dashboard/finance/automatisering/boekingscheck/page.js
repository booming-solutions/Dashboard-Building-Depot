/* ============================================================
   BESTAND: page.js  (Automatisering — Boekingscheck)
   KOPIEER NAAR: src/app/dashboard/finance/automatisering/boekingscheck/page.js   (NIEUW)

   DOEL: een Excel met vooruitbetalingen uploaden en per regel laten
   zien of die via Booming in Eagle geboekt is — met vouchernummer,
   datum, batch en wie het deed — of juist niet (geweigerd, gestopt,
   handmatig-lijst, of helemaal niet via Booming ingelezen).

   Bron: de tabellen eagle_prepay_batches / eagle_prepay_rows in
   Supabase, die Booming tijdens het boeken bijwerkt. Wat buiten
   Booming om (handmatig) in Eagle is geboekt, is hier niet zichtbaar.

   Bestand: bij voorkeur de gewone aanbetalingslijst (tabblad "Lijst").
   Elke andere Excel met een kolom "Fact.nummer" (en optioneel
   "LeverancierNR.") werkt ook; ontbreekt het leveranciersnummer, dan
   wordt 4741 aangenomen.

   Recht: finance_prepay (zelfde als Keukendepot).
   ============================================================ */
'use client';

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase';
import ExcelExportButton from '@/components/ExcelExportButton';
import { readWorkbook, nlAmount } from '@/lib/eaglePrepay';

const STANDAARD_VENDOR = '4741';

const STATUS = {
  geboekt:           { label: 'Geboekt via Booming',        cls: 'bg-emerald-100 text-emerald-800', tone: 'ok' },
  geweigerd:         { label: 'Geweigerd door Eagle',       cls: 'bg-amber-100 text-amber-800',     tone: 'warn' },
  geboekt_handmatig: { label: 'Afmaken in Eagle',           cls: 'bg-amber-100 text-amber-800',     tone: 'warn' },
  gestopt:           { label: 'Gestopt — niet geboekt',     cls: 'bg-red-100 text-red-800',         tone: 'err' },
  bezig:             { label: 'Afgebroken tijdens boeken',  cls: 'bg-red-100 text-red-800',         tone: 'err' },
  wachten:           { label: 'Klaargezet, niet geboekt',   cls: 'bg-gray-200 text-gray-700',       tone: 'err' },
  overgeslagen:      { label: 'Overgeslagen (al eerder)',   cls: 'bg-gray-200 text-gray-700',       tone: 'warn' },
  handmatig:         { label: 'Niet in batch (handmatig)',  cls: 'bg-amber-100 text-amber-800',     tone: 'warn' },
  onbekend:          { label: 'Niet via Booming ingelezen', cls: 'bg-red-100 text-red-800',         tone: 'err' },
};

function Pill({ status }) {
  const s = STATUS[status] || STATUS.onbekend;
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
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

/** Leest een willekeurige Excel: zoekt de kolom met het factuurnummer. */
function leesLos(arrayBuffer) {
  let wb;
  try { wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true }); }
  catch { return { ok: false, error: 'Het bestand kon niet gelezen worden. Lever een .xlsx aan.' }; }
  for (const naam of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[naam], { header: 'A', raw: true, blankrows: false, defval: null });
    if (!grid.length) continue;
    const kop = grid[0];
    const kolommen = Object.keys(kop);
    const factKol = kolommen.find(c => /fact/i.test(String(kop[c] || '')) && /n(r|umm)/i.test(String(kop[c] || '')))
      || kolommen.find(c => /^fact/i.test(String(kop[c] || '')));
    if (!factKol) continue;
    const levKol = kolommen.find(c => /leverancier\s*nr/i.test(String(kop[c] || '').replace(/\./g, '')));
    const naamKol = kolommen.find(c => /^leverancier$/i.test(String(kop[c] || '').trim()));
    const xcgKol = kolommen.find(c => /^xcg$/i.test(String(kop[c] || '').trim()));
    const rows = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const f = r[factKol] == null ? '' : String(r[factKol]).trim();
      if (!f) continue;
      rows.push({
        excelRow: i + 1,
        factuurnummer: f,
        leverancierNr: levKol && r[levKol] != null ? String(r[levKol]).trim() : STANDAARD_VENDOR,
        leverancier: naamKol && r[naamKol] != null ? String(r[naamKol]).trim() : '',
        xcg: xcgKol && r[xcgKol] != null ? Number(String(r[xcgKol]).replace(',', '.')) : NaN,
      });
    }
    if (rows.length) return { ok: true, rows, sheetName: naam, los: true };
  }
  return { ok: false, error: 'Geen kolom "Fact.nummer" gevonden in dit bestand.' };
}

export default function BoekingscheckPage() {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  const [rows, setRows] = useState([]);
  const [readError, setReadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkFout, setCheckFout] = useState(null);
  const [uitslag, setUitslag] = useState(null);   // map dedupeKey -> { status, ... }
  const [filter, setFilter] = useState('alles');
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setFileName(null); setRows([]); setReadError(null); setUitslag(null); setCheckFout(null); setFilter('alles');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      let res = readWorkbook(e.target.result);
      if (!res.ok) res = leesLos(e.target.result);
      if (fileRef.current) fileRef.current.value = '';
      if (!res.ok) { setReadError(res.error); return; }
      setReadError(null);
      setFileName(file.name);
      const rs = res.rows.map(r => ({
        ...r,
        leverancierNr: r.leverancierNr || STANDAARD_VENDOR,
        dedupeKey: `${r.leverancierNr || STANDAARD_VENDOR}|${r.factuurnummer}`,
      }));
      setRows(rs);
      setUitslag(null);
      await controleer(rs);
    };
    reader.readAsArrayBuffer(file);
  }

  async function controleer(rs) {
    setBusy(true); setCheckFout(null);
    try {
      const supabase = createClient();
      const keys = Array.from(new Set(rs.map(r => r.dedupeKey).filter(k => k && !k.endsWith('|'))));
      const map = {};
      if (keys.length) {
        // 1. regels die in een batch hebben gezeten (nieuwste eerst)
        for (let i = 0; i < keys.length; i += 200) {
          const deel = keys.slice(i, i + 200);
          const { data, error } = await supabase
            .from('eagle_prepay_rows')
            .select('dedupe_key,rij,status,voucher,reden,invoice_amount,updated_at,eagle_prepay_batches(batch_id,bestand,created_by,created_at,entiteit_naam,voucher_date)')
            .in('dedupe_key', deel)
            .order('updated_at', { ascending: false });
          if (error) throw error;
          (data || []).forEach(r => {
            const b = r.eagle_prepay_batches || {};
            const prev = map[r.dedupe_key];
            // 'geboekt' wint altijd; anders de nieuwste vermelding
            if (prev && (prev.status === 'geboekt' || (prev.status !== 'geboekt' && r.status !== 'geboekt'))) return;
            map[r.dedupe_key] = {
              status: r.status, voucher: r.voucher, reden: r.reden, bedrag: r.invoice_amount, tijd: r.updated_at,
              batch: b.batch_id, bestand: b.bestand, door: b.created_by, ingelezen: b.created_at, entiteit: b.entiteit_naam, boekdatum: b.voucher_date,
            };
          });
        }
        // 2. regels die op de handmatig-lijst van een batch stonden (zitten in de payload)
        const { data: batches, error: e2 } = await supabase
          .from('eagle_prepay_batches')
          .select('batch_id,bestand,created_by,created_at,entiteit_naam,voucher_date,payload')
          .order('created_at', { ascending: false })
          .limit(300);
        if (e2) throw e2;
        const keySet = new Set(keys);
        (batches || []).forEach(b => {
          const hm = Array.isArray(b.payload?.handmatig) ? b.payload.handmatig : [];
          const regels = Array.isArray(b.payload?.regels) ? b.payload.regels : [];
          hm.forEach(h => {
            const vendor = (regels[0]?.vendor) || STANDAARD_VENDOR;
            const key = `${vendor}|${h.factuurnummer}`;
            if (!keySet.has(key) || map[key]) return;
            map[key] = {
              status: 'handmatig', reden: h.reden, bedrag: h.xcg, tijd: b.created_at,
              batch: b.batch_id, bestand: b.bestand, door: b.created_by, ingelezen: b.created_at, entiteit: b.entiteit_naam, boekdatum: b.voucher_date,
            };
          });
        });
      }
      setUitslag(map);
    } catch (err) {
      setCheckFout(err.message || String(err));
      setUitslag({});
    } finally {
      setBusy(false);
    }
  }

  const resultaat = useMemo(() => rows.map(r => {
    const u = uitslag ? uitslag[r.dedupeKey] : null;
    return { ...r, check: u ? u.status : 'onbekend', info: u || null };
  }), [rows, uitslag]);

  const tel = (st) => resultaat.filter(r => r.check === st).length;
  const nGeboekt = tel('geboekt');
  const nOnbekend = tel('onbekend');
  const nAndere = resultaat.length - nGeboekt - nOnbekend;

  const shown = resultaat.filter(r => {
    if (filter === 'geboekt') return r.check === 'geboekt';
    if (filter === 'onbekend') return r.check === 'onbekend';
    if (filter === 'andere') return r.check !== 'geboekt' && r.check !== 'onbekend';
    return true;
  });

  function sheets() {
    const alle = resultaat.map(r => ({
      'Rij Excel': r.excelRow, 'Leverancier': r.leverancier || '', 'LeverancierNr': r.leverancierNr, 'Fact.nummer': r.factuurnummer,
      'XCG (Excel)': Number.isFinite(r.xcg) ? r.xcg : '',
      'Uitkomst': (STATUS[r.check] || STATUS.onbekend).label,
      'Voucher Eagle': r.info?.voucher || '', 'Boekdatum (Eagle)': r.info?.boekdatum || '',
      'Geboekt/ingelezen op': r.info?.tijd ? new Date(r.info.tijd).toLocaleString('nl-NL') : '',
      'Batch': r.info?.batch || '', 'Bestand': r.info?.bestand || '', 'Door': r.info?.door || '', 'Entiteit': r.info?.entiteit || '',
      'Toelichting': r.info?.reden || '',
    }));
    return [
      { name: 'Alle regels', rows: alle },
      { name: 'Niet geboekt', rows: alle.filter(a => a.Uitkomst !== STATUS.geboekt.label) },
    ];
  }

  return (
    <div className="p-6 max-w-[1180px]">
      <div className="flex items-start gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">Finance · Automatisering</p>
          <h1 className="text-[24px] font-bold text-[#1B3A5C] mt-1">Boekingscheck</h1>
          <p className="text-[13px] text-gray-500 mt-1 max-w-[66ch]">
            Upload een lijst met vooruitbetalingen en zie per regel of hij via Booming in Eagle geboekt is, met vouchernummer,
            datum en batch. Wat buiten Booming om is geboekt, staat hier niet in.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />Preview
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
          className={`rounded-xl border-2 border-dashed p-5 flex items-center gap-4 flex-wrap transition-colors ${dragOver ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-300 bg-gray-50'}`}>
          <div className="flex-1 min-w-[240px]">
            <strong className="block text-[14px] text-[#1B3A5C]">{rows.length ? 'Bestand geladen' : 'Sleep de Excel hierheen'}</strong>
            <p className="text-[12.5px] text-gray-500 mt-0.5">
              {rows.length ? `${fileName} · ${rows.length} regels` : 'De gewone aanbetalingslijst, of elke Excel met een kolom "Fact.nummer" (en liefst "LeverancierNR.").'}
            </p>
          </div>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:brightness-110">
            {rows.length ? 'Ander bestand' : 'Bestand kiezen'}
          </button>
          {rows.length > 0 && (
            <button type="button" onClick={reset}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-[13px] font-semibold hover:bg-red-50">Leegmaken</button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </div>
        {readError && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-[13px] text-red-800 whitespace-pre-line">{readError}</div>}
        {checkFout && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-[13px] text-red-800">Controle mislukt: {checkFout}</div>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <Tile k="Regels" v={rows.length || '—'} s={fileName ? 'in het bestand' : 'geen bestand'} />
        <Tile k="Geboekt via Booming" v={rows.length ? nGeboekt : '—'} s="met vouchernummer" tone={nGeboekt ? 'ok' : null} />
        <Tile k="Wel gezien, niet geboekt" v={rows.length ? nAndere : '—'} s="geweigerd, gestopt of handmatig" tone={nAndere ? 'warn' : null} />
        <Tile k="Niet via Booming" v={rows.length ? nOnbekend : '—'} s="nooit ingelezen" tone={nOnbekend ? 'err' : null} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          {[['alles', 'Alle regels', resultaat.length], ['geboekt', 'Geboekt', nGeboekt], ['andere', 'Gezien, niet geboekt', nAndere], ['onbekend', 'Niet via Booming', nOnbekend]].map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-[12.5px] border transition-all ${filter === k ? 'bg-[#1B3A5C] border-[#1B3A5C] text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {label} ({n})
            </button>
          ))}
          {busy && <span className="text-[12px] text-gray-400">Controleren…</span>}
          {rows.length > 0 && uitslag && (
            <div className="ml-auto">
              <ExcelExportButton
                filename={`boekingscheck_${(fileName || 'lijst').replace(/\.xlsx$/i, '')}`}
                reportTitle={`Boekingscheck — ${fileName}`}
                sheets={sheets}
                label="⬇ Excel"
              />
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13.5px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Rij', 'Leverancier', 'Fact.nummer', 'XCG', 'Uitkomst', 'Voucher', 'Boekdatum', 'Wanneer', 'Batch / bestand', 'Door', 'Toelichting'].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-gray-400 whitespace-nowrap ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr><td colSpan={11} className="px-5 py-10 text-center text-gray-400 text-[13.5px]">Nog geen bestand ingelezen.</td></tr>
              )}
              {rows.length > 0 && !shown.length && (
                <tr><td colSpan={11} className="px-5 py-8 text-center text-gray-400 text-[13.5px]">Geen regels in deze selectie.</td></tr>
              )}
              {shown.map(r => (
                <tr key={r.excelRow} className={`border-b border-gray-100 ${r.check === 'onbekend' ? 'bg-red-50' : r.check !== 'geboekt' ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2 font-mono text-[12px] text-gray-400">{r.excelRow}</td>
                  <td className="px-3 py-2">{r.leverancier || <span className="text-gray-400 font-mono text-[12px]">{r.leverancierNr}</span>}</td>
                  <td className="px-3 py-2 font-mono text-[12.5px]">{r.factuurnummer}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number.isFinite(r.xcg) && r.xcg > 0 ? nlAmount(r.xcg) : '—'}</td>
                  <td className="px-3 py-2"><Pill status={r.check} /></td>
                  <td className="px-3 py-2 font-mono text-[12.5px] text-[#1B3A5C]">{r.info?.voucher || ''}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.info?.boekdatum || ''}</td>
                  <td className="px-3 py-2 text-[12px] text-gray-600 whitespace-nowrap">{r.info?.tijd ? new Date(r.info.tijd).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
                  <td className="px-3 py-2 text-[12px] text-gray-600 max-w-[220px]">
                    {r.info?.batch && <div className="font-mono text-[11px]">{r.info.batch}</div>}
                    {r.info?.bestand && <div className="truncate" title={r.info.bestand}>{r.info.bestand}</div>}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-gray-600">{(r.info?.door || '').split('@')[0]}</td>
                  <td className="px-3 py-2 text-[12px] text-gray-600 max-w-[300px]"><div className="line-clamp-2" title={r.info?.reden || ''}>{r.info?.reden || ''}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
