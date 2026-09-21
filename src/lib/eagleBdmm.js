/* ============================================================
   BESTAND: eagleBdmm.js
   KOPIEER NAAR: src/lib/eagleBdmm.js   (NIEUW)

   DOEL: het Exact-uittreksel van BDMM Trading B.V. ("Kaart | Relatie",
   één tabblad per entiteit) inlezen, controleren en omzetten naar
   Booming-batches die in Eagle "New A/P Transactions" worden geboekt.

   Spelregels (afgesproken 21-9-2026):
     - Elke entiteit heeft een eigen leveranciersnummer voor BDMM:
         BDT (Building Depot Trading, Curaçao)  4811  entiteit 000
         BDB (Building Depot Bonaire)           4815  entiteit 700
         MMC (Multimart)                        4814  entiteit 600
         RCC (Repair Center Curaçao)            4816  entiteit 400
     - Debet-regel  = factuur       -> Trx Type R
       Credit-regel = creditnota    -> Trx Type C
     - Bedragen in het bestand zijn EUR; geboekt wordt in XCG:
       XCG = EUR × koers (standaard 2,00; per batch aanpasbaar).
     - AP-rekening 2000-{entiteit}, distributie 2999-{entiteit}.
     - Terms Code 1 (per invoice).
     - Voucher date = invoice date = boekdatum: standaard de laatste dag
       van de vorige maand, aanpasbaar tot maximaal 50 dagen terug
       (daarboven blokkeert Eagle). Due/Disc date = boekdatum.
     - Vendor Ref No = kolom "Onze ref." uit het uittreksel.
     - Voucher Ref = "VOORUITBET BDMM EUR <bedrag>" (max 30 tekens; boven
       EUR 99.999,99 in hele euro's).
     - Dubbele factuurnummers en eerder via Booming geboekte nummers gaan
       niet stilzwijgend mee (bevestigen resp. handmatig-lijst).
   ============================================================ */

import * as XLSX from 'xlsx';
import { toISODate, parseISODate, eagleDate, money } from '@/lib/eaglePrepay';

/* ---------------------------------------------------------------- config */

export const BDMM_CONFIG = {
  soort: 'bdmm',
  leverancierNaam: 'BDMM',
  apAccountMain: '2000',
  distributionAccountMain: '2999',
  termsCode: '1',
  termsCodeLabel: 'PER INVOICE',
  koersStandaard: 2.0,
  voucherRefPrefix: 'VOORUITBET BDMM EUR',
  voucherRefMaxLength: 30,
  maxDagenTerug: 50,
  kolommen: { nr: 'A', per: 'B', datum: 'C', bkst: 'D', onzeRef: 'E', uwRef: 'F', omschrijving: 'G', debet: 'H', credit: 'I', grootboek: 'J' },
};

export const BDMM_ENTITEITEN = [
  { code: '000', naam: 'Curaçao (BDT)',        kort: 'BDT', vendor: '4811', tabbladen: ['BDT'] },
  { code: '700', naam: 'Bonaire (BDB)',        kort: 'BDB', vendor: '4815', tabbladen: ['BDB', 'BDP'] },
  { code: '600', naam: 'Multimart (MMC)',      kort: 'MMC', vendor: '4814', tabbladen: ['MMC', 'MM'] },
  { code: '400', naam: 'Repair Center (RCC)',  kort: 'RCC', vendor: '4816', tabbladen: ['RCC', 'RC'] },
];

export function entiteitVoorTabblad(naam) {
  const n = String(naam || '').trim().toUpperCase();
  return BDMM_ENTITEITEN.find(e => e.tabbladen.includes(n)) || null;
}

/* --------------------------------------------------------------- helpers */

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function excelDatum(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : toISODate(v);
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : toISODate(d);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

export function xcgVanEur(eur, koers) {
  return Number((Number(eur) * Number(koers)).toFixed(2));
}

export function buildVoucherRefBdmm(eur) {
  const p = BDMM_CONFIG.voucherRefPrefix + ' ';
  let bedrag = Number(eur).toFixed(2);
  if ((p + bedrag).length > BDMM_CONFIG.voucherRefMaxLength) bedrag = String(Math.round(Number(eur)));
  return p + bedrag;
}

/* --------------------------------------------------------------- inlezen */

/**
 * Leest het Exact-uittreksel. Geeft { ok, error, tabbladen:[{ naam, entiteit,
 * relatie, rows:[...] }], overgeslagen:[naam] } terug.
 * Elke row: { excelRow, tabblad, nr, periode, datum(ISO), bkst, onzeRef,
 *             uwRef, omschrijving, debet, credit, eur, isCredit, grootboek }
 */
export function readWorkbookBdmm(arrayBuffer) {
  let wb;
  try {
    wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });
  } catch {
    return { ok: false, error: 'Het bestand kon niet gelezen worden. Lever een .xlsx aan.', tabbladen: [] };
  }
  const K = BDMM_CONFIG.kolommen;
  const tabbladen = [];
  const overgeslagen = [];

  wb.SheetNames.forEach(naam => {
    const ent = entiteitVoorTabblad(naam);
    if (!ent) { overgeslagen.push(naam); return; }
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[naam], { header: 'A', raw: true, blankrows: true, defval: null });

    // koprij zoeken: bevat "Onze ref" en "Debet"
    let kopIdx = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const vals = Object.values(grid[i] || {}).map(v => String(v || '').toLowerCase());
      if (vals.some(v => v.includes('onze ref')) && vals.some(v => v === 'debet')) { kopIdx = i; break; }
    }
    if (kopIdx < 0) { overgeslagen.push(`${naam} (geen koprij "Onze ref." / "Debet" gevonden)`); return; }

    // relatie-regel (informatief): "Relatie | 1568 - Repair Center Curacao B.V"
    let relatie = '';
    for (let i = 0; i < kopIdx; i++) {
      const r = grid[i] || {};
      if (String(r.A || '').trim().toLowerCase() === 'relatie') { relatie = String(r.B || '').trim(); break; }
    }

    const rows = [];
    for (let i = kopIdx + 1; i < grid.length; i++) {
      const r = grid[i] || {};
      const nr = r[K.nr];
      if (nr === null || nr === undefined || nr === '') continue;          // lege/totaalregel
      if (String(nr).trim().toLowerCase() === 'beginbalans') continue;
      if (typeof nr !== 'number' && !/^\d+$/.test(String(nr).trim())) continue;
      const debet = toNumber(r[K.debet]);
      const credit = toNumber(r[K.credit]);
      const onzeRef = r[K.onzeRef] == null ? '' : String(r[K.onzeRef]).trim();
      rows.push({
        excelRow: i + 1,
        tabblad: naam,
        nr: Number(nr),
        periode: r[K.per] == null ? null : Number(r[K.per]),
        datum: excelDatum(r[K.datum]),
        bkst: r[K.bkst] == null ? '' : String(r[K.bkst]).trim(),
        onzeRef,
        uwRef: r[K.uwRef] == null ? '' : String(r[K.uwRef]).trim(),
        omschrijving: r[K.omschrijving] == null ? '' : String(r[K.omschrijving]).trim(),
        grootboek: r[K.grootboek] == null ? '' : String(r[K.grootboek]).trim(),
        debet, credit,
        isCredit: credit > 0 && !(debet > 0),
        eur: credit > 0 && !(debet > 0) ? credit : debet,
      });
    }
    tabbladen.push({ naam, entiteit: ent, relatie, rows });
  });

  if (!tabbladen.length) {
    return {
      ok: false,
      error: 'Geen tabblad met facturen gevonden. Verwacht: tabbladen BDT, BDB, MMC en/of RCC in de Exact-indeling (Kaart | Relatie).',
      tabbladen: [], overgeslagen,
    };
  }
  return { ok: true, error: null, tabbladen, overgeslagen };
}

/* --------------------------------------------------------------- analyse */

/**
 * Verrijkt de regels van één tabblad met fouten en te bevestigen punten.
 * eerder: map dedupeKey -> info uit Booming-historie (optioneel).
 */
export function analyseRowsBdmm(rawRows, vendor, koers, eerder = {}) {
  const perRef = {};
  rawRows.forEach(r => { if (r.onzeRef) (perRef[r.onzeRef] = perRef[r.onzeRef] || []).push(r.excelRow); });

  return rawRows.map(r => {
    const row = { ...r, errors: [], flags: [] };
    row.dedupeKey = `${vendor}|${row.onzeRef}`;
    row.xcg = xcgVanEur(row.eur, koers);
    row.trxType = row.isCredit ? 'C' : 'R';
    row.voucherRef = buildVoucherRefBdmm(row.eur);

    if (!row.onzeRef) row.errors.push('Kolom "Onze ref." is leeg — geen factuurnummer.');
    if (!(row.eur > 0)) row.errors.push('Geen bedrag (Debet en Credit zijn beide 0).');
    if (r.debet > 0 && r.credit > 0) row.errors.push('Regel heeft zowel een Debet- als een Credit-bedrag.');
    if (row.voucherRef.length > BDMM_CONFIG.voucherRefMaxLength) row.errors.push(`Voucher Ref is langer dan ${BDMM_CONFIG.voucherRefMaxLength} tekens.`);

    const e = eerder[row.dedupeKey];
    if (e) {
      const wanneer = e.tijd ? new Date(e.tijd).toLocaleDateString('nl-NL') : 'eerder';
      const wat = e.status === 'geboekt'
        ? `is op ${wanneer} al via Booming in Eagle geboekt${e.voucher ? ` (voucher ${e.voucher})` : ''}`
        : e.status === 'geweigerd'
          ? `is op ${wanneer} door Eagle geweigerd: ${e.reden || 'factuurnummer al in gebruik'}`
          : e.status === 'bezig'
            ? (e.tijd && Date.now() - new Date(e.tijd).getTime() > 15 * 60 * 1000
                ? `is bij een eerdere poging (${wanneer}) afgebroken tijdens het boeken — controleer in Eagle`
                : 'wordt op dit moment door een andere batch geboekt')
            : `is op ${wanneer} in Eagle blijven staan om handmatig af te maken`;
      row.errors.push(`EERDER GEBOEKT: factuur ${row.onzeRef} ${wat} — batch ${e.batch_id || '?'}${e.door ? `, door ${e.door}` : ''}. Beoordeel zelf en boek zo nodig handmatig.`);
    }

    if (row.onzeRef && perRef[row.onzeRef] && perRef[row.onzeRef].length > 1) {
      row.flags.push({ code: 'DUBBEL FACTUUR', text: `Factuurnummer ${row.onzeRef} staat ${perRef[row.onzeRef].length}× op dit tabblad (rij ${perRef[row.onzeRef].join(', ')}).` });
    }
    if (row.isCredit) {
      row.flags.push({ code: 'CREDIT', text: `Creditnota van EUR ${money(row.eur)} — wordt geboekt als Trx Type C (in plaats van R).` });
    }
    if (row.bkst && row.onzeRef && row.bkst !== row.onzeRef) {
      row.flags.push({ code: 'REF WIJKT AF', text: `Bkst.nr. (${row.bkst}) en Onze ref. (${row.onzeRef}) verschillen; Onze ref. wordt als factuurnummer gebruikt.` });
    }
    return row;
  });
}

/* ---------------------------------------------------------------- status */

export function statusOfBdmm(row, st) {
  const s = st || { status: 'pending' };
  if (row.errors.length) return 'error';
  if (s.status === 'removed') return 'removed';
  if (!row.flags.length) return 'ready';
  return s.status === 'confirmed' ? 'confirmed' : 'action';
}
export function inBatchBdmm(row, st) { const s = statusOfBdmm(row, st); return s === 'ready' || s === 'confirmed'; }
export function isManualBdmm(row, st) { const s = statusOfBdmm(row, st); return s === 'error' || s === 'removed'; }

/* ---------------------------------------------------------------- payload */

export function buildBatchBdmm({ rows, rowState, entiteit, boekdatumISO, koers, fileName, tabblad, batchId }) {
  const datum = eagleDate(parseISODate(boekdatumISO));
  const ent = BDMM_ENTITEITEN.find(e => e.code === entiteit);
  const regels = rows.filter(r => inBatchBdmm(r, rowState[r.excelRow])).map(r => {
    const bedrag = money(r.xcg);
    return {
      rij: r.excelRow,
      trxType: r.trxType,
      vendor: ent.vendor,
      voucherDate: datum,
      invoiceDate: datum,
      vendorRefNo: r.onzeRef,
      apAccount: [BDMM_CONFIG.apAccountMain, entiteit],
      termsCode: BDMM_CONFIG.termsCode,
      voucherRef: r.voucherRef,
      invoiceAmount: bedrag,
      distribution: { account: [BDMM_CONFIG.distributionAccountMain, entiteit], job: '', amount: bedrag },
      eur: money(r.eur),
      koers,
      omschrijving: r.omschrijving,
      factuurdatum: r.datum,
      bevestigd: r.flags.length > 0,
      bevestigingen: r.flags.map(f => f.code),
      bedragAangepast: false,
      dedupeKey: r.dedupeKey,
    };
  });
  const handmatig = rows.filter(r => isManualBdmm(r, rowState[r.excelRow])).map(r => ({
    rij: r.excelRow,
    factuurnummer: r.onzeRef,
    leverancier: `BDMM (${ent.vendor})`,
    euro: money(r.eur),
    xcg: money(r.xcg),
    reden: r.errors.length ? r.errors.join(' ') : 'Handmatig uit de batch gehaald' + (r.flags.length ? ` — ${r.flags.map(f => f.code).join(', ')}` : ''),
  }));
  return {
    batchId: batchId || null,
    soort: BDMM_CONFIG.soort,
    bestand: fileName ? `${fileName} › ${tabblad}` : tabblad,
    entiteit,
    entiteitNaam: ent.naam,
    voucherDate: datum,
    invoiceDate: datum,
    apRekening: `${BDMM_CONFIG.apAccountMain}-${entiteit}`,
    distributieRekening: `${BDMM_CONFIG.distributionAccountMain}-${entiteit}`,
    koersNorm: koers,
    regels,
    handmatig,
  };
}
