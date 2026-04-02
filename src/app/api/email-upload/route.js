/* ============================================================
   BESTAND: route.js
   KOPIEER NAAR: src/app/api/email-upload/route.js
   ============================================================ */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const maxDuration = 60;

/* ── Detect file type based on columns ── */
function detectFileType(keys) {
  var hasInventory = keys.some(function(k) { return k.toLowerCase().includes('inventory at average cost'); });
  var hasBudget = keys.some(function(k) { return k.toLowerCase().includes('budget'); });
  var hasNetSales = keys.some(function(k) { return k.toLowerCase().includes('net sales') || k.toLowerCase().includes('net_sales'); });
  var hasGrossMargin = keys.some(function(k) { return k.toLowerCase().includes('gross margin'); });
  var hasQOH = keys.some(function(k) { return k.toLowerCase().includes('quantity on hand'); });
  var hasItemNumber = keys.some(function(k) { return k.toLowerCase().includes('item number'); });
  var hasSalesUnits = keys.some(function(k) { return k.toLowerCase().includes('sales units'); });

  if (hasInventory && hasBudget) return 'inventory';
  if (hasQOH && hasItemNumber && hasSalesUnits) return 'buying';
  if (hasNetSales || hasGrossMargin) return 'sales';
  return 'unknown';
}

/* ── Process sales data (existing logic) ── */
async function processSalesData(json, filename) {
  var batchId = crypto.randomUUID();
  var parsed = json.map(function(row) {
    var keys = Object.keys(row);
    var find = function(patterns) { return keys.find(function(k) { return patterns.some(function(p) { return k.toLowerCase().includes(p); }); }); };

    var dateVal = row[find(['date'])];
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

    return {
      bum: String(row[find(['bum'])] || ''),
      sale_date: dateVal,
      store_number: String(row[find(['store'])] || ''),
      dept_code: String(row[find(['department code', 'dept_code'])] || ''),
      dept_name: String(row[find(['department name', 'dept_name'])] || ''),
      net_sales: parseFloat(row[find(['net sales', 'net_sales'])]) || 0,
      gross_margin: parseFloat(row[gmKey]) || 0,
      gm_percentage: parseFloat(row[gmPctKey]) || 0,
    };
  }).filter(function(r) { return r.bum && r.sale_date && r.dept_code; });

  // Aggregate to department level: sum net_sales and gross_margin per date+store+dept
  var aggMap = {};
  parsed.forEach(function(r) {
    var key = r.sale_date + '|' + r.store_number + '|' + r.dept_code;
    if (!aggMap[key]) {
      aggMap[key] = {
        bum: r.bum,
        sale_date: r.sale_date,
        store_number: r.store_number,
        dept_code: r.dept_code,
        dept_name: r.dept_name,
        net_sales: 0,
        gross_margin: 0,
        upload_batch: batchId,
      };
    }
    aggMap[key].net_sales += r.net_sales;
    aggMap[key].gross_margin += r.gross_margin;
  });

  var rows = Object.values(aggMap);
  // Recalculate GM% after aggregation
  rows.forEach(function(r) {
    r.net_sales = Math.round(r.net_sales * 100) / 100;
    r.gross_margin = Math.round(r.gross_margin * 100) / 100;
    r.gm_percentage = r.net_sales ? Math.round((r.gross_margin / r.net_sales) * 10000) / 100 : 0;
  });

  console.log('Sales parsed: ' + parsed.length + ' rows, aggregated to: ' + rows.length + ' dept-level rows');

  var uniqueDates = Array.from(new Set(rows.map(function(r) { return r.sale_date; }))).filter(Boolean).sort();
  console.log('Dates in file: ' + uniqueDates.length + ' unique dates, from ' + uniqueDates[0] + ' to ' + uniqueDates[uniqueDates.length - 1]);

  if (uniqueDates.length > 0) {
    var minDate = uniqueDates[0];
    var maxDate = uniqueDates[uniqueDates.length - 1];
    // Delete by range instead of .in() to avoid issues with large date lists
    var delResult = await supabase.from('sales_data').delete({ count: 'exact' }).gte('sale_date', minDate).lte('sale_date', maxDate);
    if (delResult.error) {
      console.error('Delete error: ' + delResult.error.message);
    } else {
      console.log('Deleted ' + (delResult.count || 0) + ' existing rows for range ' + minDate + ' to ' + maxDate);
    }
  }

  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var insResult = await supabase.from('sales_data').insert(batch);
    if (insResult.error) {
      console.error('Batch error at ' + i + ': ' + insResult.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  return { type: 'sales', rows_imported: totalInserted };
}

/* ── Process inventory data (new) ── */
async function processInventoryData(json, filename) {
  var keys = Object.keys(json[0] || {});

  // Find all date columns (contain "Inventory At Average Cost")
  var dateCols = keys.filter(function(k) { return k.includes('Inventory At Average Cost'); });
  console.log('Inventory date columns found: ' + dateCols.length);

  // Find other column keys
  var find = function(patterns) { return keys.find(function(k) { return patterns.some(function(p) { return k.toLowerCase().includes(p); }); }); };
  var storeKey = find(['store number', 'store_number']);
  var bumKey = find(['department group', 'bum']);
  var deptCodeKey = find(['department code', 'dept_code']);
  var deptNameKey = find(['department name', 'dept_name']);
  var budgetKey = keys.find(function(k) { return k.toLowerCase().includes('budget'); });

  // Parse date from column header: "03/28/2026\nInventory At Average Cost" → "2026-03-28"
  function parseDateFromCol(col) {
    var datePart = col.split('\n')[0].trim();
    // Try MM/DD/YYYY
    var parts = datePart.split('/');
    if (parts.length === 3) {
      return parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
    }
    return datePart;
  }

  // Map store numbers to regions: 1-9 = Curaçao ('1'), A/B = Bonaire ('B')
  function getRegion(storeNum) {
    var s = String(storeNum || '').trim();
    if (s && !isNaN(parseInt(s))) return '1';
    return 'B';
  }

  // Aggregate: sum all stores per region per dept per date
  var aggMap = {};

  json.forEach(function(row) {
    var storeNum = String(row[storeKey] || '').trim();
    var region = getRegion(storeNum);
    var deptCode = String(row[deptCodeKey] || '').replace(/\.0$/, '');
    var deptName = String(row[deptNameKey] || '');
    var bum = String(row[bumKey] || '');
    var budgetVal = parseFloat(row[budgetKey]) || 0;

    if (!deptCode || !bum) return;

    dateCols.forEach(function(col) {
      var dateStr = parseDateFromCol(col);
      var value = parseFloat(row[col]) || 0;
      var key = region + '|' + deptCode + '|' + dateStr;

      if (!aggMap[key]) {
        aggMap[key] = {
          store_number: region,
          bum: bum,
          dept_code: deptCode,
          dept_name: deptName,
          budget: region === '1' ? budgetVal : 0, // Budget only for Curaçao
          inventory_date: dateStr,
          inventory_value: 0,
        };
      }
      aggMap[key].inventory_value += value;
    });
  });

  var rows = Object.values(aggMap).map(function(r) {
    r.inventory_value = Math.round(r.inventory_value * 100) / 100;
    return r;
  });

  console.log('Inventory aggregated rows: ' + rows.length);

  // Get unique dates from new data
  var uniqueDates = Array.from(new Set(rows.map(function(r) { return r.inventory_date; }))).filter(Boolean);
  console.log('Inventory dates: ' + uniqueDates.join(', '));

  // Delete existing data for these dates (smart replace)
  if (uniqueDates.length > 0) {
    var delResult = await supabase.from('inventory_data').delete({ count: 'exact' }).in('inventory_date', uniqueDates);
    if (delResult.error) {
      console.error('Inventory delete error: ' + delResult.error.message);
    } else {
      console.log('Deleted ' + (delResult.count || 0) + ' existing inventory rows');
    }
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var insResult = await supabase.from('inventory_data').insert(batch);
    if (insResult.error) {
      console.error('Inventory batch error at ' + i + ': ' + insResult.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  return { type: 'inventory', rows_imported: totalInserted };
}

/* ── Process buying data (new) ── */
async function processBuyingData(json, filename) {
  var keys = Object.keys(json[0] || {});
  var find = function(patterns) { return keys.find(function(k) { return patterns.some(function(p) { return k.toLowerCase().includes(p); }); }); };

  // Find sales columns
  var salesCols = keys.filter(function(k) { return k.includes('Sales Units') && !k.includes('Total'); });
  console.log('Buying: ' + salesCols.length + ' sales columns found');

  var rows = json.map(function(row) {
    var sales = salesCols.map(function(c) { return parseFloat(row[c]) || 0; });
    // Pad to 12 if needed
    while (sales.length < 12) sales.push(0);

    return {
      store_number: String(row[find(['store number', 'store_number'])] || ''),
      dept_code: String(row[find(['department code', 'dept_code'])] || '').replace(/\.0$/, ''),
      dept_name: String(row[find(['department name', 'dept_name'])] || ''),
      class_code: String(row[find(['class code', 'class_code'])] || ''),
      class_name: String(row[find(['class name', 'class_name'])] || ''),
      item_number: String(row[find(['item number', 'item_number'])] || ''),
      item_description: String(row[find(['item desc', 'item_desc'])] || ''),
      nos: String(row[find(['nos'])] || ''),
      min_lead_time: parseFloat(row[find(['min lead', 'min_lead'])]) || 0,
      max_lead_time: parseFloat(row[find(['max lead', 'max_lead'])]) || 0,
      qoh: parseFloat(row[find(['quantity on hand', 'qoh'])]) || 0,
      qty_committed: parseFloat(row[find(['quantity committed', 'qty_committed'])]) || 0,
      qty_available: parseFloat(row[find(['quantity available', 'qty_available'])]) || 0,
      qty_on_order: parseFloat(row[find(['quantity on order', 'qty_on_order'])]) || 0,
      sales_m01: sales[0], sales_m02: sales[1], sales_m03: sales[2], sales_m04: sales[3],
      sales_m05: sales[4], sales_m06: sales[5], sales_m07: sales[6], sales_m08: sales[7],
      sales_m09: sales[8], sales_m10: sales[9], sales_m11: sales[10], sales_m12: sales[11],
      vendor_code: String(row[find(['vendor code'])] || ''),
      vendor_name: String(row[find(['vendor name'])] || ''),
      replacement_cost: parseFloat(row[find(['replacement cost', 'replacement_cost'])]) || 0,
      inv_value_at_cost: parseFloat(row[find(['inventory value', 'inv_value'])]) || 0,
    };
  }).filter(function(r) { return r.item_number && r.store_number; });

  console.log('Buying valid rows: ' + rows.length);

  // Get unique dept codes - delete all existing data for these depts
  var deptCodes = Array.from(new Set(rows.map(function(r) { return r.dept_code; }))).filter(Boolean);
  console.log('Buying dept codes: ' + deptCodes.join(', '));

  if (deptCodes.length > 0) {
    var delResult = await supabase.from('buying_data').delete({ count: 'exact' }).in('dept_code', deptCodes);
    if (delResult.error) console.error('Buying delete error: ' + delResult.error.message);
    else console.log('Deleted ' + (delResult.count || 0) + ' existing buying rows for depts: ' + deptCodes.join(', '));
  }

  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var insResult = await supabase.from('buying_data').insert(batch);
    if (insResult.error) { console.error('Buying batch error at ' + i + ': ' + insResult.error.message); continue; }
    totalInserted += batch.length;
  }

  return { type: 'buying', rows_imported: totalInserted };
}

/* ── Main POST handler ── */
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

    console.log('Parsed ' + json.length + ' rows from ' + filename);

    if (!json.length) {
      return Response.json({ error: 'No data rows found' }, { status: 400 });
    }

    // Detect file type
    var allKeys = Object.keys(json[0]);
    var fileType = detectFileType(allKeys);
    console.log('Detected file type: ' + fileType);

    var result;
    if (fileType === 'inventory') {
      result = await processInventoryData(json, filename);
    } else if (fileType === 'buying') {
      result = await processBuyingData(json, filename);
    } else if (fileType === 'sales') {
      result = await processSalesData(json, filename);
    } else {
      console.log('Unknown file type. Columns: ' + allKeys.join(', '));
      return Response.json({ error: 'Unknown file format - not sales or inventory' }, { status: 400 });
    }

    // Log the upload
    await supabase.from('upload_log').insert({
      filename: '[email] [' + result.type + '] ' + filename,
      rows_imported: result.rows_imported,
      status: result.rows_imported > 0 ? 'success' : 'failed',
    }).catch(function(e) { console.error('Log error:', e); });

    console.log('Imported ' + result.rows_imported + ' ' + result.type + ' rows from ' + filename);
    return Response.json({ success: true, type: result.type, rows_imported: result.rows_imported });

  } catch (err) {
    console.error('Email upload error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
