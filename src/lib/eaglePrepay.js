/* ============================================================
   BESTAND: eaglePrepay.js
   KOPIEER NAAR: src/lib/eaglePrepay.js
   (nieuw bestand)

   DOEL: de Excel met vooruitbetalingen (Keukendepot) inlezen,
   controleren en omzetten naar records die de Eagle Bridge
   één op één in "New A/P Transactions" invoert.

   Spelregels die hier zijn vastgelegd:
     - Er wordt ALTIJD het XCG-bedrag geboekt, nooit het Euro-bedrag.
     - Entiteit is het achtervoegsel van het grootboeknummer:
         000 = Curaçao, 700 = Bonaire.
       Scherm 1  -> AP Account   2000-{entiteit}
       Add distr -> Distribution 2099-{entiteit}
     - Voucher date en invoice date zijn ALTIJD de laatste dag van
       de vorige maand. De betaaldatum uit de Excel wordt hiervoor
       niet gebruikt. Maximaal 50 dagen terug, anders loopt Eagle
       tegen de 60-dagenblokkade aan.
     - De koers die in het bestand het vaakst voorkomt, geldt als
       norm. Elke regel die daarvan afwijkt moet bevestigd worden.
     - Dubbele factuurnummers en dubbele bedragen moeten bevestigd
       worden (kan kloppen, maar niet stilzwijgend).
     - Voucher Ref is max 30 tekens. Boven EUR 9999 wordt op hele
       euro's afgerond, anders past de tekst niet.
   ============================================================ */

import * as XLSX from 'xlsx';

/* ---------------------------------------------------------------- config */

export const ENTITEITEN = [
  { code: '000', naam: 'Curaçao' },
  { code: '700', naam: 'Bonaire' },
];

export const PREPAY_CONFIG = {
  sheetName: 'Lijst',
  trxType: 'C',
  apAccountMain: '2000',
  distributionAccountMain: '2099',
  distributionAccountLabel: 'CLEARING ACCOUNT PAYMENTS',
  termsCode: '5',
  termsCodeLabel: 'PREPAY 30%',
  voucherRefMaxLength: 30,
  voucherRefRoundAboveEur: 9999,
  // 'spatie' -> VOORUITBET NOBILIA EUR 16.4
  // 'aaneen' -> VOORUITBET NOBILIA EUR16.40
  voucherRefStijl: 'spatie',
  // Eagle blokkeert boven de 60 dagen; 50 houdt marge.
  maxDagenTerug: 50,
  headers: {
    A: 'Betaaldatum',
    B: 'Leverancier',
    C: 'LeverancierNR.',
    D: 'Fact.nummer',
    E: 'Euro',
    F: 'XCG',
    I: 'Omschrijving',
  },
};

/* --------------------------------------------------------------- datums */

/** Laatste dag van de maand vóór de referentiedatum (UTC). */
export function lastDayPrevMonth(ref = new Date()) {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 0));
}

export function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s) {
  const p = String(s).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}

/** Eagle-datumformaat: mm/dd/jj. */
export function eagleDate(d) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${String(d.getUTCFullYear()).slice(-2)}`;
}

export function nlDate(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Vroegst toegestane boekdatum: maxDagenTerug vóór vandaag. */
export function minBoekdatum(vandaag = new Date()) {
  const t = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate()));
  return new Date(t.getTime() - PREPAY_CONFIG.maxDagenTerug * 86400000);
}

/** Controleert de gekozen boekdatum. Geeft null terug als hij klopt. */
export function checkBoekdatum(iso, vandaag = new Date()) {
  if (!iso) return 'Kies een boekdatum.';
  const d = parseISODate(iso);
  if (isNaN(d.getTime())) return 'Ongeldige datum.';
  const vandaagUTC = new Date(Date.UTC(vandaag.getUTCFullYear(), vandaag.getUTCMonth(), vandaag.getUTCDate()));
  if (d.getTime() > vandaagUTC.getTime()) return 'De boekdatum mag niet in de toekomst liggen.';
  const dagen = daysBetween(d, vandaagUTC);
  if (dagen > PREPAY_CONFIG.maxDagenTerug) {
    return `De boekdatum ligt ${dagen} dagen terug. Maximaal ${PREPAY_CONFIG.maxDagenTerug} dagen — daarboven blokkeert Eagle de boeking.`;
  }
  return null;
}

/* --------------------------------------------------------------- getallen */

export function money(n) { return Number(n).toFixed(2); }
function trimNum(n) { return String(Number(Number(n).toFixed(2))); }
export function nlAmount(n) {
  return Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return Number(s);
}

/* ------------------------------------------------------------ voucher ref */

export function voucherRefBedrag(euro) {
  if (euro > PREPAY_CONFIG.voucherRefRoundAboveEur) return String(Math.round(euro));
  return PREPAY_CONFIG.voucherRefStijl === 'aaneen' ? Number(euro).toFixed(2) : trimNum(euro);
}

export function buildVoucherRef(leverancier, euro) {
  const naam = String(leverancier || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const sep = PREPAY_CONFIG.voucherRefStijl === 'aaneen' ? '' : ' ';
  return `VOORUITBET ${naam} EUR${sep}${voucherRefBedrag(euro || 0)}`;
}

/* ------------------------------------------------------------ inlezen */

/**
 * Leest een xlsx-buffer en geeft { ok, error, rows } terug.
 * rows zijn ruwe regels: { excelRow, betaaldatum(ISO), leverancier,
 * leverancierNr, factuurnummer, euro, xcg }.
 */
export function readWorkbook(arrayBuffer) {
  let wb;
  try {
    wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });
  } catch (e) {
    return { ok: false, error: 'Het bestand kon niet gelezen worden. Lever een .xlsx aan.', rows: [] };
  }

  const sheetName =
    wb.SheetNames.find(n => n.trim().toLowerCase() === PREPAY_CONFIG.sheetName.toLowerCase()) ||
    wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'Het bestand bevat geen tabbladen.', rows: [] };

  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 'A', raw: true, blankrows: false, defval: null,
  });
  if (!grid.length) return { ok: false, error: `Tabblad "${sheetName}" is leeg.`, rows: [] };

  const fout = [];
  Object.keys(PREPAY_CONFIG.headers).forEach(col => {
    const got = String(grid[0][col] == null ? '' : grid[0][col]).trim().toLowerCase();
    if (got !== PREPAY_CONFIG.headers[col].toLowerCase()) {
      fout.push(`kolom ${col} moet "${PREPAY_CONFIG.headers[col]}" heten`);
    }
  });
  if (fout.length) {
    return {
      ok: false,
      error: 'Het bestand heeft niet de verwachte indeling:\n- ' + fout.join('\n- ') +
             '\n\nControleer of tabblad "Lijst" en de koprij ongewijzigd zijn.',
      rows: [],
    };
  }

  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || r.A == null) continue;
    const dt = r.A instanceof Date ? r.A : new Date(Math.round((Number(r.A) - 25569) * 86400000));
    rows.push({
      excelRow: i + 1,
      betaaldatum: isNaN(dt.getTime()) ? null : toISODate(dt),
      leverancier: String(r.B || '').trim(),
      leverancierNr: String(r.C || '').trim(),
      factuurnummer: String(r.D || '').trim(),
      euro: toNumber(r.E),
      xcg: toNumber(r.F),
    });
  }
  if (!rows.length) return { ok: false, error: 'Er staan geen regels onder de koprij.', rows: [] };

  return { ok: true, error: null, rows, sheetName };
}

/* ------------------------------------------------------------ analyse */

/** Koers die in dit bestand het vaakst voorkomt. */
export function modalRate(rows) {
  const counts = {};
  rows.forEach(r => {
    if (!(r.euro > 0) || !(r.xcg > 0)) return;
    const k = (r.xcg / r.euro).toFixed(4);
    counts[k] = (counts[k] || 0) + 1;
  });
  let best = null, bestN = 0;
  Object.keys(counts).forEach(k => { if (counts[k] > bestN) { bestN = counts[k]; best = k; } });
  return { rate: best === null ? null : Number(best), count: bestN };
}

/**
 * Verrijkt de ruwe regels met fouten en te bevestigen punten.
 * Geeft { rows, modal } terug.
 */
export function analyseRows(rawRows) {
  const modal = modalRate(rawRows);

  const perFactuur = {};
  const perBedrag = {};
  rawRows.forEach(r => {
    const fk = `${r.leverancierNr}|${r.factuurnummer}`;
    (perFactuur[fk] = perFactuur[fk] || []).push(r.excelRow);
    if (r.xcg > 0) {
      const bk = Number(r.xcg).toFixed(2);
      (perBedrag[bk] = perBedrag[bk] || []).push(r.excelRow);
    }
  });

  const rows = rawRows.map(r => {
    const row = { ...r, errors: [], flags: [] };

    if (!(row.euro > 0)) row.errors.push('Euro-bedrag ontbreekt of is niet groter dan 0.');
    if (!(row.xcg > 0)) row.errors.push('XCG-bedrag ontbreekt of is niet groter dan 0.');
    if (!row.factuurnummer) row.errors.push('Fact.nummer ontbreekt.');
    if (!/^\d+$/.test(row.leverancierNr)) row.errors.push('LeverancierNR. moet numeriek zijn.');

    row.voucherRef = buildVoucherRef(row.leverancier, row.euro || 0);
    if (row.voucherRef.length > PREPAY_CONFIG.voucherRefMaxLength) {
      row.errors.push(
        `Voucher Ref is ${row.voucherRef.length} tekens (max ${PREPAY_CONFIG.voucherRefMaxLength}). ` +
        'Kort de leveranciersnaam in het bronbestand in.'
      );
    }

    row.rate = (row.euro > 0 && row.xcg > 0) ? Number((row.xcg / row.euro).toFixed(4)) : null;
    row.dedupeKey = `${row.leverancierNr}|${row.factuurnummer}`;

    if (modal.rate !== null && row.rate !== null && row.rate !== modal.rate) {
      row.rateExpected = Number((row.euro * modal.rate).toFixed(2));
      row.flags.push({
        code: 'KOERS',
        text: `Koers ${row.rate} wijkt af van ${modal.rate}, de koers die in dit bestand het vaakst ` +
              `voorkomt (${modal.count}×). Bij ${modal.rate} zou hier XCG ${nlAmount(row.rateExpected)} ` +
              `staan in plaats van XCG ${nlAmount(row.xcg)}.`,
      });
    }

    const fk = `${row.leverancierNr}|${row.factuurnummer}`;
    if (row.factuurnummer && perFactuur[fk] && perFactuur[fk].length > 1) {
      row.flags.push({
        code: 'DUBBEL FACTUUR',
        text: `Fact.nummer ${row.factuurnummer} staat ${perFactuur[fk].length}× in dit bestand ` +
              `(rij ${perFactuur[fk].join(', ')}).`,
      });
    }

    const bk = row.xcg > 0 ? Number(row.xcg).toFixed(2) : null;
    if (bk && perBedrag[bk] && perBedrag[bk].length > 1) {
      row.flags.push({
        code: 'DUBBEL BEDRAG',
        text: `XCG ${nlAmount(row.xcg)} komt ${perBedrag[bk].length}× voor (rij ${perBedrag[bk].join(', ')}). ` +
              'Kan kloppen bij gelijke keukens, maar controleer het.',
      });
    }

    return row;
  });

  return { rows, modal };
}

/* ------------------------------------------------------------ status */

/**
 * rowState per regel: { status: 'pending'|'confirmed'|'removed',
 *                       mode: 'keep'|'override', xcg: number }
 */
export function bookedXcg(row, st) {
  if (st && st.mode === 'override' && st.xcg > 0) return Number(st.xcg);
  return row.xcg;
}

export function statusOf(row, st) {
  const s = st || { status: 'pending', mode: 'keep', xcg: 0 };
  if (row.errors.length) return 'error';
  if (s.status === 'removed') return 'removed';
  if (!row.flags.length) return 'ready';
  if (s.status === 'confirmed') {
    if (s.mode === 'override' && !(s.xcg > 0)) return 'action';
    return 'confirmed';
  }
  return 'action';
}

export function inBatch(row, st) {
  const s = statusOf(row, st);
  return s === 'ready' || s === 'confirmed';
}

export function isManual(row, st) {
  const s = statusOf(row, st);
  return s === 'error' || s === 'removed';
}

/* ------------------------------------------------------------ payload */

/** Bouwt de batch die de Eagle Bridge uitvoert. */
export function buildBatch({ rows, rowState, entity, boekdatumISO, fileName, modal, batchId }) {
  const d = parseISODate(boekdatumISO);
  const datum = eagleDate(d);
  const ent = ENTITEITEN.find(e => e.code === entity);

  const regels = rows.filter(r => inBatch(r, rowState[r.excelRow])).map(r => {
    const st = rowState[r.excelRow] || {};
    const bedrag = money(bookedXcg(r, st));
    return {
      rij: r.excelRow,
      trxType: PREPAY_CONFIG.trxType,
      vendor: r.leverancierNr,
      voucherDate: datum,
      invoiceDate: datum,
      vendorRefNo: r.factuurnummer,
      apAccount: [PREPAY_CONFIG.apAccountMain, entity],
      termsCode: PREPAY_CONFIG.termsCode,
      voucherRef: r.voucherRef,
      invoiceAmount: bedrag,
      distribution: {
        account: [PREPAY_CONFIG.distributionAccountMain, entity],
        job: '',
        amount: bedrag,
      },
      bevestigd: r.flags.length > 0,
      bevestigingen: r.flags.map(f => f.code),
      bedragAangepast: st.mode === 'override',
      dedupeKey: r.dedupeKey,
    };
  });

  const handmatig = rows.filter(r => isManual(r, rowState[r.excelRow])).map(r => ({
    rij: r.excelRow,
    factuurnummer: r.factuurnummer,
    leverancier: r.leverancier,
    euro: r.euro > 0 ? money(r.euro) : null,
    xcg: r.xcg > 0 ? money(r.xcg) : null,
    reden: r.errors.length
      ? r.errors.join(' ')
      : 'Handmatig uit de batch gehaald' + (r.flags.length ? ` — ${r.flags.map(f => f.code).join(', ')}` : ''),
  }));

  return {
    batchId: batchId || null,
    bestand: fileName || null,
    entiteit: entity,
    entiteitNaam: ent ? ent.naam : null,
    voucherDate: datum,
    invoiceDate: datum,
    apRekening: `${PREPAY_CONFIG.apAccountMain}-${entity}`,
    distributieRekening: `${PREPAY_CONFIG.distributionAccountMain}-${entity}`,
    koersNorm: modal ? modal.rate : null,
    regels,
    handmatig,
  };
}
