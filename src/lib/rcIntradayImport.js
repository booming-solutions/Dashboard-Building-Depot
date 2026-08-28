/* ============================================================
   BESTAND: rcIntradayImport.js
   KOPIEER NAAR: src/lib/rcIntradayImport.js

   v2: filename patroon tolerant voor onderscheid tussen underscore/spatie
   Compass filename kan zijn:
     - RC_sales_update_08-27-26.csv (originele naam)
     - RC sales update_08-27-26.csv (na email transport)
   ============================================================ */

// Filename patroon: matcht zowel onderstrepen als spaties
export function isRcIntradayFile(columns, filename) {
  var fn = String(filename || '').toLowerCase();
  // Normaliseer spaties naar onderstrepen voor de check
  var normalized = fn.replace(/\s+/g, '_');
  if (/^rc_sales_update_/i.test(normalized)) return true;

  // Fallback op kolom-signatuur
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
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  var mo = m[1].padStart(2, '0');
  var d = m[2].padStart(2, '0');
  var y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + mo + '-' + d;
}

function normalizeDeptCode(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).trim();
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