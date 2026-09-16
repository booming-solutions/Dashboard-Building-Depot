/* ============================================================
   BESTAND: rcIntradayImport.js
   KOPIEER NAAR: src/lib/rcIntradayImport.js

   v3: Return object aligned met route.js verwachting (table + rows_imported).
        Verbose logging zodat we bij failure zien wat er misgaat.
        Bij Supabase error wordt de error zichtbaar in Vercel logs.
   ============================================================ */

export function isRcIntradayFile(columns, filename) {
  var fn = String(filename || '').toLowerCase();
  var normalized = fn.replace(/\s+/g, '_');
  if (/^rc_sales_update_/i.test(normalized)) return true;

  var cols = (columns || []).map(function(c) { return String(c || '').toLowerCase(); });
  var hasShort = cols.some(function(c) { return c.includes('store short name'); });
  var hasMargin = cols.some(function(c) { return c.includes('gross margin'); });
  var hasSales = cols.some(function(c) { return c === 'sales' || c === 'sales '; });
  var hasDept = cols.some(function(c) { return c.includes('department code'); });
  return hasShort && hasMargin && hasSales && hasDept && cols.length <= 8;
}

function parseAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(v) {
  if (!v) return null;
  // SheetJS levert Date objecten (door cellDates: true)
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.getUTCFullYear() + '-' +
           String(v.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(v.getUTCDate()).padStart(2, '0');
  }
  if (typeof v === 'number') {
    var d = new Date((v - 25569) * 86400000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var mo = m[1].padStart(2, '0');
    var dd = m[2].padStart(2, '0');
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + mo + '-' + dd;
  }
  // ISO-achtige fallback
  var d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.toISOString().slice(0, 10);
  return null;
}

function normalizeDeptCode(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim();
  s = s.replace(/\.0+$/, '');
  if (/^\d$/.test(s)) return '0' + s;
  return s;
}

export async function processRcIntraday(supabase, rows, filename) {
  console.log('[RC intraday] Start processing ' + filename + ' (' + (rows || []).length + ' rows)');

  if (!Array.isArray(rows) || !rows.length) {
    console.log('[RC intraday] Empty rows, aborting');
    return { table: 'compass_ticket_intraday', rows_imported: 0 };
  }

  // Log de eerste rij zodat we altijd kunnen zien wat er binnenkwam
  console.log('[RC intraday] Sample row keys: ' + Object.keys(rows[0]).join(', '));
  console.log('[RC intraday] Sample row values: ' + JSON.stringify(rows[0]));

  var toUpsert = [];
  var skipped = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var lookup = {};
    Object.keys(r).forEach(function(k) { lookup[k.toLowerCase().trim()] = r[k]; });

    var dept_code = normalizeDeptCode(lookup['department code']);
    var dept_name = lookup['department name'] ? String(lookup['department name']).trim() : null;
    var store_number = lookup['store number'] ? String(lookup['store number']).trim() : null;
    var store_name = lookup['store short name'] ? String(lookup['store short name']).trim() : null;
    var sale_date = parseDate(lookup['date']);
    var sales = parseAmount(lookup['sales']);
    var gross_margin = parseAmount(lookup['gross margin']);

    if (!sale_date || !store_number || !dept_code) {
      console.log('[RC intraday] Skipping row ' + i + ': sale_date=' + sale_date + ', store=' + store_number + ', dept=' + dept_code);
      skipped++;
      continue;
    }

    toUpsert.push({
      sale_date: sale_date,
      store_number: store_number,
      dept_code: dept_code,
      dept_name: dept_name,
      store_name: store_name,
      sales: sales,
      gross_margin: gross_margin,
      updated_at: new Date().toISOString(),
    });
  }

  console.log('[RC intraday] Prepared ' + toUpsert.length + ' rows to upsert (skipped ' + skipped + ')');

  if (!toUpsert.length) {
    console.log('[RC intraday] No valid rows to upsert');
    return { table: 'compass_ticket_intraday', rows_imported: 0 };
  }

  console.log('[RC intraday] Upserting: ' + JSON.stringify(toUpsert));

  var res = await supabase
    .from('compass_ticket_intraday')
    .upsert(toUpsert, { onConflict: 'sale_date,store_number,dept_code' });

  if (res.error) {
    console.error('[RC intraday] UPSERT ERROR: ' + res.error.message);
    console.error('[RC intraday] UPSERT ERROR details: ' + JSON.stringify(res.error));
    throw new Error('compass_ticket_intraday upsert failed: ' + res.error.message);
  }

  console.log('[RC intraday] Upsert succeeded, ' + toUpsert.length + ' rows written');

  return {
    table: 'compass_ticket_intraday',
    rows_imported: toUpsert.length,
    skipped: skipped,
    filename: filename,
    date: toUpsert[0].sale_date,
    total_sales: toUpsert.reduce(function(s, r) { return s + r.sales; }, 0),
  };
}