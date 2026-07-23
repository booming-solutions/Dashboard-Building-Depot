/* ============================================================
   BESTAND: poImport.js
   KOPIEER NAAR: src/lib/poImport.js   (NIEUW)

   DOEL: de twee Compass-rapporten voor openstaande PO's verwerken
   die per mail binnenkomen:

     1. "AI Open PO Order details"  -> po_open_headers  (per PO)
        Kolommen: Vendor Code, Vendor Name, Group items, Store Number,
        PO Header, Creation Date, Date Expected, P.O. Status,
        Buyers ID, Total Cost Dollars, Year Month

     2. "AI Open PO SKU detail"     -> po_deliveries    (per artikel)
        Kolommen: Item Number, Item Description, Department Code,
        Department Name, PO Header, Date Expected, P.O. Status,
        Purchase Quantity On Order, Average Cost, Order Inventory

   Beide zijn een MOMENTOPNAME van alle open PO's: strategie is
   TRUNCATE + INSERT. PO's schuiven dagelijks van datum, nieuwe komen
   erbij, geleverde verdwijnen.

   LET OP 1 — po_deliveries werd gevoed door een ouder rapport met de
   kolommen "PO Detail" en "QOO Rounded Quantity". Dat rapport komt niet
   meer binnen; dit bestand neemt het over. De oude processPoDeliveries
   in route.js blijft staan voor het geval het oude rapport terugkeert.

   LET OP 2 — valuta van "Total Cost Dollars" is niet bevestigd. De
   waarde wordt onbewerkt opgeslagen in total_cost, zonder omrekening.
   Ga er in rapportages niet blind vanuit dat dit XCG is.

   LET OP 3 — P.O. Status wordt NIET gefilterd; alle regels gaan erin.
   De voorkomende statussen worden geteld en gelogd, zodat zichtbaar
   wordt wat er in het bestand zit. Wil je later filteren, dan kan dat
   op basis van die telling.
   ============================================================ */

const CHUNK = 1000;

/* ── Detectie ── */
export function isPoHeaderFile(columns, filename) {
  const fname = String(filename || '').toLowerCase();
  if (fname.includes('open po order details')) return true;

  const cols = (columns || []).map((c) => String(c || '').toLowerCase());
  const has = (p) => cols.some((c) => c.includes(p));
  // Kop-bestand: heeft Buyers ID / Total Cost en GEEN Item Number
  return has('po header') && !has('item number')
      && (has('buyers id') || has('total cost'));
}

export function isPoSkuFile(columns, filename) {
  const fname = String(filename || '').toLowerCase();
  if (fname.includes('open po sku')) return true;

  const cols = (columns || []).map((c) => String(c || '').toLowerCase());
  const has = (p) => cols.some((c) => c.includes(p));
  // SKU-bestand: PO Header + Item Number + hoeveelheid op order
  return has('po header') && has('item number')
      && (has('purchase quantity on order') || has('quantity on order'));
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
  let m = base.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);             // ISO
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = base.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);         // Compass US M/D/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(base);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// Jaar-sanity: voorkomt dat een PO-nummer per ongeluk als jaartal landt
// (zie de v23-bug met date_expected = 17381-01-01).
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

async function replaceAll(supabase, table, rows, filename) {
  const del = await supabase.from(table).delete({ count: 'exact' }).not('id', 'is', null);
  if (del.error) throw new Error(table + ' leegmaken mislukt: ' + del.error.message);
  console.log(table + ': ' + (del.count || 0) + ' oude regels verwijderd');

  const stamp = new Date().toISOString();
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
      .map((r) => ({ ...r, source_file: filename, loaded_at: stamp }));
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(table + ' insert mislukt bij rij ' + i + ': ' + error.message);
    inserted += chunk.length;
  }
  return inserted;
}

/* ── 1. PO-koppen ── */
export async function processPoHeaders(supabase, json, filename) {
  const keys = allKeys(json);
  const ix = {
    po:       pick(keys, 'PO Header', 'po header', 'po number'),
    vcode:    pick(keys, 'Vendor Code', 'vendor code'),
    vname:    pick(keys, 'Vendor Name', 'vendor name'),
    group:    pick(keys, 'Group items', 'group item'),
    store:    pick(keys, 'Store Number', 'store number', 'store'),
    created:  pick(keys, 'Creation Date', 'creation date'),
    expected: pick(keys, 'Date Expected', 'date expected'),
    status:   pick(keys, 'P.O. Status', 'p.o. status', 'po status', 'status'),
    buyer:    pick(keys, 'Buyers ID', 'buyers id', 'buyer'),
    cost:     pick(keys, 'Total Cost Dollars', 'total cost'),
    ym:       pick(keys, 'Year Month', 'year month'),
  };

  if (!ix.po) throw new Error('po_open_headers: kolom "PO Header" ontbreekt');

  const rows = [];
  const statuses = {};
  let skipped = 0;

  for (const row of json) {
    const po = txt(row[ix.po]);
    if (!po) { skipped++; continue; }          // lege regels / Grand Summaries

    const st = ix.status ? txt(row[ix.status]) : null;
    if (st) statuses[st] = (statuses[st] || 0) + 1;

    rows.push({
      po_number:     po,
      vendor_code:   ix.vcode    ? txt(row[ix.vcode])       : null,
      vendor_name:   ix.vname    ? txt(row[ix.vname])       : null,
      group_items:   ix.group    ? txt(row[ix.group])       : null,
      store_number:  ix.store    ? txt(row[ix.store])       : null,
      creation_date: ix.created  ? safeDate(row[ix.created]) : null,
      date_expected: ix.expected ? safeDate(row[ix.expected]) : null,
      po_status:     st,
      buyers_id:     ix.buyer    ? txt(row[ix.buyer])       : null,
      total_cost:    ix.cost     ? num(row[ix.cost])        : null,
      year_month:    ix.ym       ? txt(row[ix.ym])          : null,
    });
  }

  const uniquePos = new Set(rows.map((r) => r.po_number)).size;
  console.log('po_open_headers: ' + rows.length + ' regels · ' + uniquePos
    + ' unieke PO\'s · overgeslagen ' + skipped);
  console.log('po_open_headers: statussen — '
    + Object.entries(statuses).map(([k, v]) => k + ' ' + v).join(' · '));

  if (!rows.length) {
    console.warn('po_open_headers: geen bruikbare regels — bestaande data blijft staan');
    return { table: 'po_open_headers', rows_imported: 0 };
  }

  const inserted = await replaceAll(supabase, 'po_open_headers', rows, filename);
  console.log('po_open_headers: ' + inserted + ' regels ingelezen');
  return { table: 'po_open_headers', rows_imported: inserted };
}

/* ── 2. PO-regels per artikel ── */
export async function processPoSkus(supabase, json, filename) {
  const keys = allKeys(json);
  const ix = {
    po:       pick(keys, 'PO Header', 'po header', 'po detail', 'po number'),
    item:     pick(keys, 'Item Number', 'item number'),
    desc:     pick(keys, 'Item Description', 'item description', 'description'),
    dept:     pick(keys, 'Department Code', 'department code'),
    deptName: pick(keys, 'Department Name', 'department name'),
    expected: pick(keys, 'Date Expected', 'date expected'),
    status:   pick(keys, 'P.O. Status', 'p.o. status', 'po status'),
    qty:      pick(keys, 'Purchase Quantity On Order', 'quantity on order', 'qoo rounded quantity'),
    cost:     pick(keys, 'Average Cost', 'average cost', 'avg cost'),
    inv:      pick(keys, 'Order Inventory', 'order inventory'),
  };

  const missing = ['po', 'item', 'expected', 'qty'].filter((k) => !ix[k]);
  if (missing.length) {
    throw new Error('po_deliveries: ontbrekende kolommen: ' + missing.join(', '));
  }

  const rows = [];
  const statuses = {};
  let skippedNoKey = 0;
  let skippedNoQty = 0;
  let skippedNoDate = 0;

  for (const row of json) {
    const po = txt(row[ix.po]);
    const item = txt(row[ix.item]);
    if (!po || !item) { skippedNoKey++; continue; }

    const qty = num(row[ix.qty]);
    if (qty === null || qty <= 0) { skippedNoQty++; continue; }

    const expected = safeDate(row[ix.expected]);
    if (!expected) { skippedNoDate++; continue; }

    const st = ix.status ? txt(row[ix.status]) : null;
    if (st) statuses[st] = (statuses[st] || 0) + 1;

    rows.push({
      po_number:        po,
      item_number:      item,
      item_description: ix.desc     ? (txt(row[ix.desc]) || '') : '',
      date_expected:    expected,
      qty_expected:     qty,
      dept_code:        ix.dept     ? txt(row[ix.dept])     : null,
      dept_name:        ix.deptName ? txt(row[ix.deptName]) : null,
      po_status:        st,
      avg_cost:         ix.cost     ? num(row[ix.cost])     : null,
      order_inventory:  ix.inv      ? num(row[ix.inv])      : null,
    });
  }

  const uniquePos = new Set(rows.map((r) => r.po_number)).size;
  console.log('po_deliveries: ' + rows.length + ' regels · ' + uniquePos + ' PO\'s · overgeslagen: '
    + skippedNoKey + ' (geen PO/item), ' + skippedNoQty + ' (qty <= 0), '
    + skippedNoDate + ' (ongeldige datum)');
  console.log('po_deliveries: statussen — '
    + Object.entries(statuses).map(([k, v]) => k + ' ' + v).join(' · '));

  if (!rows.length) {
    console.warn('po_deliveries: geen bruikbare regels — bestaande data blijft staan');
    return { table: 'po_deliveries', rows_imported: 0 };
  }

  const inserted = await replaceAll(supabase, 'po_deliveries', rows, filename);
  console.log('po_deliveries: ' + inserted + ' regels ingelezen');
  return { table: 'po_deliveries', rows_imported: inserted };
}