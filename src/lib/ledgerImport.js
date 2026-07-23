/* ============================================================
   BESTAND: ledgerImport.js
   KOPIEER NAAR: src/lib/ledgerImport.js   (NIEUW)

   DOEL: het Compass-rapport "AI Open and Paid Items last 12M"
   dat per mail binnenkomt verwerken naar public.invoice_ledger.
   Zelfde parselogica als de handmatige uploadpagina
   (src/app/dashboard/finance/ledger-upload/page.js), maar
   server-side en met wegschrijven naar ledger_load_log.

   Regels:
   - entiteit uit laatste 3 cijfers van Account Number:
       000=BDT, 400=RCC, 600=MMC, 700=BDB, 888=BDMS. Anders overslaan.
   - alleen regels met factuurdatum >= MIN_DATE.
   - UPSERT op (entity, voucher_number, invoice_number). Geen delete:
     regels die buiten het 12-maands venster vallen blijven staan.
   - first_seen_at wordt NIET meegestuurd, zodat de database-default
     alleen bij een echte insert vult en bij updates blijft staan.
   ============================================================ */

const ENTITY_MAP = { 0: 'BDT', 400: 'RCC', 600: 'MMC', 700: 'BDB', 888: 'BDMS' };
const MIN_DATE = '2025-01-01';
const BATCH = 500;

/* ── Detectie ── */
export function isInvoiceLedgerFile(columns, filename) {
  const fname = String(filename || '').toLowerCase();
  // Naam-detectie is het betrouwbaarst (zie v24-les met de AI Voorraden-files)
  if (fname.includes('open and paid')) return true;

  const cols = (columns || []).map((c) => String(c || '').toLowerCase());
  const has = (p) => cols.some((c) => c.includes(p));
  return has('invoice number header') && has('fully paid')
      && has('voucher number') && has('account number');
}

/* ── Helpers ── */
function pick(keys, exact, ...partials) {
  const hit = keys.find((k) => k.trim().toLowerCase() === exact.toLowerCase());
  if (hit) return hit;
  for (const p of partials) {
    const k2 = keys.find((k) => k.trim().toLowerCase().includes(p.toLowerCase()));
    if (k2) return k2;
  }
  return null;
}

function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  // SheetJS levert Date-objecten door cellDates:true — UTC gebruiken om
  // dagverschuiving door tijdzone te voorkomen.
  if (v instanceof Date && !isNaN(v)) {
    return v.getUTCFullYear() + '-'
      + String(v.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(v.getUTCDate()).padStart(2, '0');
  }
  if (typeof v === 'number' && isFinite(v)) {         // Excel-serienummer
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const base = s.split(' ')[0].split('T')[0];
  let m = base.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);              // ISO
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = base.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);          // Compass US M/D/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(base);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function voucherStr(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? String(n) : String(v).trim();
}

const PAID_FLAGS = new Set(['X', 'Y', 'YES', 'TRUE', '1']);

/* ── Verwerking ── */
export async function processInvoiceLedger(supabase, json, filename) {
  // Alle kolomnamen verzamelen over alle rijen: SheetJS slaat lege cellen over,
  // dus rij 1 alleen is niet betrouwbaar.
  const keysSet = {};
  for (const row of json) for (const k of Object.keys(row)) keysSet[k] = true;
  const keys = Object.keys(keysSet);

  const ix = {
    vcode:    pick(keys, 'Vendor Code', 'vendor code'),
    vname:    pick(keys, 'Vendor Name', 'vendor name'),
    date:     pick(keys, 'Date'),
    value:    pick(keys, 'Value'),
    inv:      pick(keys, 'Invoice Number Header', 'invoice number'),
    paid:     pick(keys, 'Fully Paid'),
    bal:      pick(keys, 'Balance'),
    paidDate: pick(keys, 'Fully Paid Date', 'fully paid date'),
    po:       pick(keys, 'PO Number', 'po number'),
    acct:     pick(keys, 'Account Number', 'account number'),
    voucher:  pick(keys, 'Voucher Number', 'voucher number'),
    measure:  pick(keys, 'Measure'),
  };

  const required = ['vcode', 'date', 'value', 'inv', 'acct', 'voucher'];
  const missing = required.filter((k) => !ix[k]);
  if (missing.length) {
    throw new Error('invoice_ledger: ontbrekende kolommen: ' + missing.join(', '));
  }

  const parsed = [];
  const byEntity = {};
  const measures = {};
  let skipped = 0;

  for (const row of json) {
    const vcode = String(row[ix.vcode] ?? '').trim();
    if (!/^\d+$/.test(vcode)) { skipped++; continue; }        // Grand Summaries / lege rijen

    const acct = parseFloat(row[ix.acct]);
    if (isNaN(acct)) { skipped++; continue; }
    const entity = ENTITY_MAP[Math.trunc(acct) % 1000];
    if (!entity) { skipped++; continue; }                     // onbekende entiteit

    const invDate = toISO(row[ix.date]);
    if (!invDate || invDate < MIN_DATE) { skipped++; continue; }

    if (ix.measure) {
      const mv = String(row[ix.measure] ?? '').trim();
      if (mv) measures[mv] = (measures[mv] || 0) + 1;
    }

    const paidRaw = String(row[ix.paid] ?? '').trim().toUpperCase();

    parsed.push({
      entity,
      vendor_code: vcode,
      vendor_name: String(row[ix.vname] ?? '').trim() || null,
      invoice_number: String(row[ix.inv] ?? '').trim(),
      voucher_number: voucherStr(row[ix.voucher]) ?? '',
      invoice_date: invDate,
      amount: num(row[ix.value]),
      balance: num(row[ix.bal]),
      fully_paid: PAID_FLAGS.has(paidRaw),
      paid_date: toISO(row[ix.paidDate]),
      po_number: String(row[ix.po] ?? '').trim() || null,
      account_number: String(Math.trunc(acct)),
    });
    byEntity[entity] = (byEntity[entity] || 0) + 1;
  }

  // Dedupe binnen het bestand: twee rijen met dezelfde conflict-sleutel laten
  // PostgreSQL struikelen ("cannot affect row a second time"). Laatste wint.
  const dedup = new Map();
  for (const r of parsed) {
    dedup.set(`${r.entity}|${r.voucher_number}|${r.invoice_number}`, r);
  }
  const rows = [...dedup.values()];
  const dupes = parsed.length - rows.length;

  console.log('invoice_ledger: ' + rows.length + ' regels na filter (overgeslagen: '
    + skipped + ', duplicaten samengevoegd: ' + dupes + ')');
  console.log('invoice_ledger: per entiteit — '
    + Object.entries(byEntity).map(([k, v]) => k + ' ' + v).join(' · '));
  const measureList = Object.keys(measures);
  if (measureList.length > 1) {
    console.warn('invoice_ledger: LET OP, meerdere Measure-waarden in dit bestand: '
      + measureList.join(', ') + ' — controleer of Value het bedrag is.');
  }

  if (!rows.length) {
    await logRun(supabase, {
      source_file: filename, rows_in_file: json.length,
      rows_before: null, rows_after: null, rows_new: 0, rows_stale: 0,
      status: 'leeg', message: 'Geen bruikbare regels na filter (overgeslagen: ' + skipped + ')',
    });
    return { table: 'invoice_ledger', rows_imported: 0 };
  }

  // Stand vooraf
  const beforeRes = await supabase
    .from('invoice_ledger').select('id', { count: 'exact', head: true });
  const rowsBefore = beforeRes.count ?? null;

  // Upsert in batches
  const stamp = new Date().toISOString();
  let upserted = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
      .map((x) => ({ ...x, source_file: filename, loaded_at: stamp }));
    const { error } = await supabase
      .from('invoice_ledger')
      .upsert(chunk, { onConflict: 'entity,voucher_number,invoice_number' });
    if (error) {
      console.error('invoice_ledger batch ' + (i / BATCH + 1) + ': ' + error.message);
      errors.push('batch ' + (i / BATCH + 1) + ': ' + error.message);
      continue;
    }
    upserted += chunk.length;
  }

  // Stand achteraf + hoeveel regels niet meer in de export zaten
  const afterRes = await supabase
    .from('invoice_ledger').select('id', { count: 'exact', head: true });
  const rowsAfter = afterRes.count ?? null;

  const staleRes = await supabase
    .from('invoice_ledger').select('id', { count: 'exact', head: true })
    .lt('loaded_at', stamp);
  const rowsStale = staleRes.count ?? null;

  const rowsNew = (rowsBefore !== null && rowsAfter !== null) ? rowsAfter - rowsBefore : null;

  await logRun(supabase, {
    source_file: filename,
    rows_in_file: rows.length,
    rows_before: rowsBefore,
    rows_after: rowsAfter,
    rows_new: rowsNew,
    rows_stale: rowsStale,
    status: errors.length ? 'deels mislukt' : 'ok',
    message: [
      'entiteiten: ' + Object.entries(byEntity).map(([k, v]) => k + ' ' + v).join(' · '),
      'overgeslagen: ' + skipped,
      dupes ? 'duplicaten: ' + dupes : null,
      measureList.length > 1 ? 'measures: ' + measureList.join(', ') : null,
      errors.length ? 'fouten: ' + errors.join(' | ') : null,
    ].filter(Boolean).join(' — '),
  });

  console.log('invoice_ledger: ' + upserted + ' verwerkt · nieuw ' + rowsNew
    + ' · niet meer in export ' + rowsStale);

  return { table: 'invoice_ledger', rows_imported: upserted };
}

/* ── Runlog: mag nooit de import laten falen ── */
async function logRun(supabase, payload) {
  try {
    await supabase.from('ledger_load_log').insert(payload);
  } catch (e) {
    console.error('ledger_load_log wegschrijven mislukt:', e);
  }
}