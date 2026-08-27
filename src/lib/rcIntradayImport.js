/* ============================================================
   BESTAND: rcIntradayImport.js
   KOPIEER NAAR: src/lib/rcIntradayImport.js

   Parser voor het Compass 30-min rapport "RC sales tracker".
   Filename: RC_sales_update_MM-DD-YY.csv
   Subject:  Epicor Compass Query AI - RC sales tracker

   Bevat één dagsnapshot voor dept 26 store 1:
     Department Code, Department Name, Store Number, Store Short Name,
     Date, Sales, Gross Margin

   Bedragen met komma-duizendtal (bv "4,214.11"). Datum MM/DD/YYYY.

   Strategie: UPSERT op (sale_date, store_number, dept_code) in tabel
   compass_ticket_intraday. De trigger op die tabel roept vervolgens
   automatisch de red-cube-sales-alert edge function aan.
   ============================================================ */

// Filename patroon: RC_sales_update_08-27-26.csv
export function isRcIntradayFile(columns, filename) {
  var fn = String(filename || '').toLowerCase();
  if (/^rc_sales_update_/i.test(fn)) return true;

  // Fallback op kolom-signatuur (voor het geval Compass naam wijzigt):
  // Compact: exact 7 kolommen inclusief "Store Short Name" + "Gross Margin"
  var cols = (columns || []).map(function(c) { return String(c || '').toLowerCase(); });
  var hasShort = cols.some(function(c) { return c.includes('store short name'); });
  var hasMargin = cols.some(function(c) { return c.includes('gross margin'); });
  var hasSales = cols.some(function(c) { return c === 'sales' || c === 'sales '; });
  var hasDept = cols.some(function(c) { return c.includes('department code'); });
  return hasShort && hasMargin && hasSales && hasDept && cols.length <= 8;
}

// Parse "4,214.11" → 4214.11. Leeg → 0.
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Parse MM/DD/YYYY → YYYY-MM-DD
function parseDate(v) {
  if (!v) return null;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  var mo = m[1].padStart(2, '0');
  var d = m[2].padStart(2, '0');
  var y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + mo + '-' + d;
}

// Cast dept_code met leading zero voor 1-digit (consistent met sales_data conventie)
function normalizeDeptCode(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim();
  // Verwijder eventuele ".0" van Excel/CSV float parsing
  s = s.replace(/\.0+$/, '');
  if (/^\d$/.test(s)) return '0' + s;
  return s;
}

export async function processRcIntraday(supabase, rows, filename) {
  if (!Array.isArray(rows) || !rows.length) {
    return { inserted: 0, skipped: 0, errors: ['no rows'] };
  }

  var toUpsert = [];
  var skipped = 0;
  var errors = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // Kolomnamen kunnen variëren in casing — normaliseer via lookup
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

  if (!toUpsert.length) {
    return { inserted: 0, skipped: skipped, errors: ['no valid rows to upsert'] };
  }

  var res = await supabase
    .from('compass_ticket_intraday')
    .upsert(toUpsert, { onConflict: 'sale_date,store_number,dept_code' });

  if (res.error) {
    return { inserted: 0, skipped: skipped, errors: [res.error.message] };
  }

  return {
    inserted: toUpsert.length,
    skipped: skipped,
    filename: filename,
    date: toUpsert[0].sale_date,
    total_sales: toUpsert.reduce(function(s, r) { return s + r.sales; }, 0),
  };
}
