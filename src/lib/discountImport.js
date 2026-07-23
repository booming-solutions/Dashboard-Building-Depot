/* ============================================================
   BESTAND: discountImport.js
   KOPIEER NAAR: src/lib/discountImport.js   (NIEUW)

   DOEL: het Compass-rapport "Discounts" dat dagelijks per mail
   binnenkomt verwerken naar public.discount_data (Kortingen-rapport).

   Kolommen in het bestand:
     Customer Number, Customer Name, Invoice Number, Journal Number,
     Date, Sales less discount, Trade discount in ANG, Discount in %,
     Clerk, Salesperson Number, Salesperson Name, Store

   Strategie: DELETE-THEN-INSERT per sale_date (zoals processSales).
   Dit is een DAGBESTAND, geen momentopname — truncaten zou de hele
   historie en daarmee de trendgrafieken wissen.

   LET OP 1 — territory, dept_code en dept_name zitten NIET in dit
   bestand. Bestaande rijen hebben ze wel (uit een eerdere, rijkere
   export). Nieuwe rijen krijgen null. Rapportonderdelen die per
   afdeling groeperen tonen voor nieuwe data dus geen dept.

   LET OP 2 — is_cash wordt afgeleid: klantnummer begint met '*' of
   klantnaam bevat 'CASH CUSTOMER'. Dat komt overeen met de bestaande
   data; controleer bij twijfel een dag na de eerste automatische run.

   LET OP 3 — "Trade discount in ANG" suggereert guldens, maar er
   zitten ook Bonaire-regels (store B) in, die in USD administreren.
   Bedragen worden onbewerkt opgeslagen, zonder omrekening.
   ============================================================ */

const BATCH = 500;

/* ── Detectie ── */
export function isDiscountFile(columns, filename) {
  const fname = String(filename || '').toLowerCase();
  if (fname.startsWith('discount')) return true;

  const cols = (columns || []).map((c) => String(c || '').toLowerCase());
  const has = (p) => cols.some((c) => c.includes(p));
  // Uniek voor dit bestand: trade discount + journal number
  return has('trade discount') && has('journal number');
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

function allKeys(json) {
  // SheetJS slaat lege cellen over, dus rij 1 alleen is niet betrouwbaar
  const set = {};
  for (const row of json) for (const k of Object.keys(row)) set[k] = true;
  return Object.keys(set);
}

function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return v.getUTCFullYear() + '-'
      + String(v.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(v.getUTCDate()).padStart(2, '0');
  }
  if (typeof v === 'number' && isFinite(v)) {              // Excel-serienummer
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
  m = base.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/);          // M/D/YY
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(base);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// Jaar-sanity: vangt een journaalnummer af dat per ongeluk als datum landt
function safeDate(v) {
  const iso = toISO(v);
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  return (y >= 2020 && y <= 2035) ? iso : null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function txt(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

/* ── Verwerking ── */
export async function processDiscounts(supabase, json, filename) {
  const keys = allKeys(json);
  const ix = {
    cnum:     pick(keys, 'Customer Number', 'customer number'),
    cname:    pick(keys, 'Customer Name', 'customer name'),
    inv:      pick(keys, 'Invoice Number', 'invoice number'),
    journal:  pick(keys, 'Journal Number', 'journal number'),
    date:     pick(keys, 'Date'),
    sales:    pick(keys, 'Sales less discount', 'sales less'),
    disc:     pick(keys, 'Trade discount in ANG', 'trade discount'),
    pct:      pick(keys, 'Discount in %', 'discount in'),
    clerk:    pick(keys, 'Clerk'),
    spname:   pick(keys, 'Salesperson Name', 'salesperson name'),
    store:    pick(keys, 'Store'),
  };

  const missing = ['date', 'journal'].filter((k) => !ix[k]);
  if (missing.length) {
    throw new Error('discount_data: ontbrekende kolommen: ' + missing.join(', '));
  }

  const rows = [];
  const byStore = {};
  let skippedNoDate = 0;
  let skippedEmpty = 0;

  for (const row of json) {
    const saleDate = safeDate(row[ix.date]);
    if (!saleDate) { skippedNoDate++; continue; }

    const journal = ix.journal ? txt(row[ix.journal]) : null;
    const cnum = ix.cnum ? txt(row[ix.cnum]) : null;
    // Regel zonder journaalnummer én zonder klant is een totaal-/lege regel
    if (!journal && !cnum) { skippedEmpty++; continue; }

    const cname = ix.cname ? txt(row[ix.cname]) : null;
    const isCash = (cnum || '').startsWith('*')
      || (cname || '').toUpperCase().includes('CASH CUSTOMER');

    const store = ix.store ? txt(row[ix.store]) : null;
    if (store) byStore[store] = (byStore[store] || 0) + 1;

    rows.push({
      sale_date:        saleDate,
      customer_number:  cnum,
      customer_name:    cname,
      invoice_number:   ix.inv    ? txt(row[ix.inv])   : null,
      journal_number:   journal,
      sales_amount:     ix.sales  ? num(row[ix.sales]) : null,
      discount_amount:  ix.disc   ? num(row[ix.disc])  : null,
      discount_pct:     ix.pct    ? num(row[ix.pct])   : null,
      clerk:            ix.clerk  ? txt(row[ix.clerk]) : null,
      salesperson_name: ix.spname ? txt(row[ix.spname]) : null,
      store_number:     store,
      is_cash:          isCash,
      // territory / dept_code / dept_name zitten niet in dit rapport
      territory:        null,
      dept_code:        null,
      dept_name:        null,
    });
  }

  const dates = [...new Set(rows.map((r) => r.sale_date))].sort();
  console.log('discount_data: ' + rows.length + ' regels · overgeslagen: '
    + skippedNoDate + ' (geen datum), ' + skippedEmpty + ' (leeg/totaalregel)');
  console.log('discount_data: datums in bestand — ' + dates.join(', '));
  console.log('discount_data: per store — '
    + Object.entries(byStore).map(([k, v]) => k + ' ' + v).join(' · '));

  if (!rows.length) {
    console.warn('discount_data: geen bruikbare regels — bestaande data blijft staan');
    return { table: 'discount_data', rows_imported: 0 };
  }

  // Delete-then-insert per datum: een dag opnieuw aanleveren corrigeert
  // die dag, zonder de rest van de historie aan te raken.
  const del = await supabase
    .from('discount_data')
    .delete({ count: 'exact' })
    .in('sale_date', dates);
  if (del.error) {
    throw new Error('discount_data leegmaken mislukt: ' + del.error.message);
  }
  console.log('discount_data: ' + (del.count || 0) + ' bestaande regels vervangen voor deze datums');

  const stamp = new Date().toISOString();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => ({ ...r, uploaded_at: stamp }));
    const { error } = await supabase.from('discount_data').insert(chunk);
    if (error) {
      throw new Error('discount_data insert mislukt bij rij ' + i + ': ' + error.message);
    }
    inserted += chunk.length;
  }

  console.log('discount_data: ' + inserted + ' regels ingelezen uit ' + filename);
  return { table: 'discount_data', rows_imported: inserted };
}