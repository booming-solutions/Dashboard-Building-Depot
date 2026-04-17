/* ============================================================
   BESTAND: route_email_v2.js
   KOPIEER NAAR: src/app/api/email-upload/route.js
   (vervangt de huidige route.js)
   ============================================================ */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// Service role for deletes (RLS bypass)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const maxDuration = 60;

/* ── Helper: find column by partial name match ── */
function findCol(keys, patterns) {
  return keys.find(function(k) {
    var kl = k.toLowerCase();
    return patterns.some(function(p) { return kl.includes(p); });
  });
}

/* ── Detect file type based on column headers ── */
function detectFileType(columns) {
  var cols = columns.map(function(c) { return c.toLowerCase(); });

  // Inventory file: has "Store Group" + "Department Code" + "Budget" + "NOW"
  if (cols.some(function(c) { return c.includes('store group'); }) &&
      cols.some(function(c) { return c.includes('department code'); }) &&
      cols.some(function(c) { return c === 'now' || c.includes('month'); })) {
    return 'inventory';
  }

  // Negative inventory: has columns like "qty on hand" or "qoh" with negative values context
  if (cols.some(function(c) { return c.includes('qty') || c.includes('qoh'); }) &&
      cols.some(function(c) { return c.includes('item'); }) &&
      !cols.some(function(c) { return c.includes('net sales'); })) {
    return 'negative_inventory';
  }

  // Sales data: has "net sales" or "bum" + "date"
  if (cols.some(function(c) { return c.includes('net sales') || c.includes('net_sales'); }) &&
      cols.some(function(c) { return c.includes('date'); })) {
    return 'sales';
  }

  return 'unknown';
}

/* ── Process SALES data ── */
async function processSales(json, batchId) {
  var keys = Object.keys(json[0] || {});

  var rows = json.map(function(row) {
    var dateVal = row[findCol(keys, ['date'])];
    if (dateVal instanceof Date) {
      dateVal = dateVal.toISOString().split('T')[0];
    } else if (typeof dateVal === 'number') {
      dateVal = new Date((dateVal - 25569) * 86400000).toISOString().split('T')[0];
    } else if (typeof dateVal === 'string') {
      var d = new Date(dateVal);
      if (!isNaN(d.getTime())) dateVal = d.toISOString().split('T')[0];
    }

    var gmPctKey = keys.find(function(k) {
      return (k.toLowerCase().includes('gross margin') && k.toLowerCase().includes('%')) || k.toLowerCase() === 'gm%';
    });
    var gmKey = keys.find(function(k) {
      return k.toLowerCase().includes('gross margin') && !k.toLowerCase().includes('%');
    });

    var gmPct = parseFloat(row[gmPctKey]) || 0;
    if (Math.abs(gmPct) > 999) gmPct = Math.max(Math.min(gmPct, 999.99), -999.99);

    // Filter out FB rows
    var dept = String(row[findCol(keys, ['department code', 'dept_code'])] || '');
    if (dept === 'FB') return null;

    return {
      bum: String(row[findCol(keys, ['bum'])] || ''),
      sale_date: dateVal,
      store_number: String(row[findCol(keys, ['store'])] || ''),
      dept_code: dept,
      dept_name: String(row[findCol(keys, ['department name', 'dept_name'])] || ''),
      net_sales: parseFloat(row[findCol(keys, ['net sales', 'net_sales'])]) || 0,
      gross_margin: parseFloat(row[gmKey]) || 0,
      gm_percentage: gmPct,
      upload_batch: batchId,
    };
  }).filter(function(r) { return r && r.bum && r.sale_date && r.dept_code; });

  console.log('Valid sales rows: ' + rows.length);

  // Smart replace: delete existing rows for same dates
  var uniqueDates = [...new Set(rows.map(function(r) { return r.sale_date; }))].filter(Boolean);
  console.log('Dates in file: ' + uniqueDates.join(', '));

  if (uniqueDates.length > 0) {
    var delResult = await supabase.from('sales_data').delete({ count: 'exact' }).in('sale_date', uniqueDates);
    if (delResult.error) {
      console.error('Delete error: ' + delResult.error.message);
    } else {
      console.log('Deleted ' + (delResult.count || 0) + ' existing rows');
    }
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await supabase.from('sales_data').insert(batch);
    if (res.error) {
      console.error('Batch error at ' + i + ': ' + res.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  return { table: 'sales_data', rows_imported: totalInserted };
}

/* ── Process INVENTORY data ── */
async function processInventory(json) {
  var keys = Object.keys(json[0] || {});
  var today = new Date();

  // Find date columns: NOW, -1 MONTH, -2 MONTHS, etc.
  var dateColumns = [];
  keys.forEach(function(k) {
    var kl = k.toLowerCase().trim();
    if (kl === 'now') {
      dateColumns.push({ col: k, monthsBack: 0 });
    } else {
      // Match patterns like "-1 MONTH", "-2 MONTHS", "- 3 MONTHS"
      var match = kl.match(/^-\s*(\d+)\s*months?$/);
      if (match) {
        dateColumns.push({ col: k, monthsBack: parseInt(match[1]) });
      }
    }
  });

  // Sort by monthsBack ascending (NOW first)
  dateColumns.sort(function(a, b) { return a.monthsBack - b.monthsBack; });
  console.log('Detected ' + dateColumns.length + ' date columns: ' + dateColumns.map(function(d) { return d.col + ' (−' + d.monthsBack + 'm)'; }).join(', '));

  if (dateColumns.length === 0) {
    throw new Error('No date columns found (expected NOW, -1 MONTH, etc.)');
  }

  // Calculate actual dates
  dateColumns.forEach(function(dc) {
    var d = new Date(today.getFullYear(), today.getMonth() - dc.monthsBack, today.getDate());
    dc.date = d.toISOString().split('T')[0];
  });

  // Build inventory_data rows
  var rows = [];
  json.forEach(function(row) {
    var storeRaw = String(row[findCol(keys, ['store group'])] || '').trim().toUpperCase();
    var store = storeRaw === 'CUR' ? '1' : storeRaw === 'BON' ? 'B' : storeRaw;
    var deptCode = String(row[findCol(keys, ['department code'])] || '');
    var deptName = String(row[findCol(keys, ['department name'])] || '');
    var bum = String(row[findCol(keys, ['department group'])] || '');
    var budgetKey = findCol(keys, ['budget']);
    var budget = budgetKey ? (parseFloat(row[budgetKey]) || 0) : 0;

    // Budget only for CUR
    if (store === 'B') budget = 0;

    dateColumns.forEach(function(dc) {
      var val = parseFloat(row[dc.col]) || 0;
      rows.push({
        store_number: store,
        dept_code: deptCode,
        dept_name: deptName,
        bum: bum,
        budget: budget,
        inventory_value: val,
        inventory_date: dc.date,
      });
    });
  });

  console.log('Inventory rows to insert: ' + rows.length);

  // Full replace: TRUNCATE then INSERT
  var delResult = await supabase.from('inventory_data').delete({ count: 'exact' }).neq('id', 0);
  if (delResult.error) {
    // Try alternative: delete all
    var delResult2 = await supabase.from('inventory_data').delete({ count: 'exact' }).gte('id', 0);
    if (delResult2.error) {
      console.error('Delete error: ' + delResult2.error.message);
    } else {
      console.log('Deleted all existing inventory rows');
    }
  } else {
    console.log('Deleted ' + (delResult.count || 0) + ' existing inventory rows');
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await supabase.from('inventory_data').insert(batch);
    if (res.error) {
      console.error('Inventory batch error at ' + i + ': ' + res.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  return { table: 'inventory_data', rows_imported: totalInserted };
}

/* ── Process NEGATIVE INVENTORY data ── */
async function processNegativeInventory(json) {
  var keys = Object.keys(json[0] || {});

  var rows = json.map(function(row) {
    return {
      store_number: String(row[findCol(keys, ['store'])] || ''),
      dept_code: String(row[findCol(keys, ['department code', 'dept_code', 'dept'])] || ''),
      dept_name: String(row[findCol(keys, ['department name', 'dept_name'])] || ''),
      item_number: String(row[findCol(keys, ['item'])] || ''),
      item_description: String(row[findCol(keys, ['description', 'desc'])] || ''),
      qoh: parseFloat(row[findCol(keys, ['qty', 'qoh', 'quantity'])] || 0),
      cost: parseFloat(row[findCol(keys, ['cost', 'value'])] || 0),
    };
  }).filter(function(r) { return r.item_number && r.dept_code; });

  console.log('Negative inventory rows: ' + rows.length);

  // Full replace
  var delResult = await supabase.from('negative_inventory').delete({ count: 'exact' }).neq('id', 0);
  if (delResult.error) {
    var delResult2 = await supabase.from('negative_inventory').delete({ count: 'exact' }).gte('id', 0);
    console.log('Deleted existing negative inventory rows');
  }

  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await supabase.from('negative_inventory').insert(batch);
    if (res.error) {
      console.error('Neg inventory batch error at ' + i + ': ' + res.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  return { table: 'negative_inventory', rows_imported: totalInserted };
}

/* ══════════════════════════════════════════════
   MAIN HANDLER
   ══════════════════════════════════════════════ */
export async function POST(request) {
  try {
    var secret = request.headers.get('X-Worker-Secret');
    if (secret !== process.env.WORKER_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    var body = await request.json();
    var filename = body.filename;
    var data = body.data;
    var sender = body.sender;

    if (!data || !filename) {
      return Response.json({ error: 'Missing data or filename' }, { status: 400 });
    }

    console.log('Processing email attachment: ' + filename + ' from ' + sender);

    // Decode base64 to binary
    var binaryString = atob(data);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Parse Excel
    var workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    var json = XLSX.utils.sheet_to_json(sheet);

    if (!json.length) {
      return Response.json({ error: 'Empty file' }, { status: 400 });
    }

    console.log('Parsed ' + json.length + ' rows from ' + filename);

    // Auto-detect file type
    var columns = Object.keys(json[0]);
    var fileType = detectFileType(columns);
    console.log('Detected file type: ' + fileType);
    console.log('Columns: ' + columns.join(', '));

    var result;
    var batchId = crypto.randomUUID();

    if (fileType === 'inventory') {
      result = await processInventory(json);
    } else if (fileType === 'negative_inventory') {
      result = await processNegativeInventory(json);
    } else if (fileType === 'sales') {
      result = await processSales(json, batchId);
    } else {
      console.error('Unknown file type. Columns: ' + columns.join(', '));
      return Response.json({ 
        error: 'Onbekend bestandstype. Kolommen: ' + columns.slice(0, 5).join(', '),
        columns: columns 
      }, { status: 400 });
    }

    // Log the upload
    try {
      await supabase.from('upload_log').insert({
        filename: '[email] ' + filename,
        rows_imported: result.rows_imported,
        status: result.rows_imported > 0 ? 'success' : 'failed',
      });
    } catch (logErr) {
      console.error('Upload log error:', logErr);
    }

    console.log('✅ ' + result.table + ': imported ' + result.rows_imported + ' rows from ' + filename);
    return Response.json({ 
      success: true, 
      table: result.table,
      rows_imported: result.rows_imported 
    });

  } catch (err) {
    console.error('Email upload error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
