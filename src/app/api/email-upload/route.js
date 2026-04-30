/* ============================================================
   BESTAND: route_email_v15.js
   KOPIEER NAAR: src/app/api/email-upload/route.js
   (vervangt de huidige route.js)
   WIJZIGING v15:
   - detectFileType + processBuying gebruiken nu de echte header-rij
     uit de Excel sheet i.p.v. Object.keys(json[0]). Reden: SheetJS
     skipt lege cellen en als rij 1 een lege QOH heeft, ontbreekt
     'Quantity on Hand' in de eerste rij van de json — waardoor
     detectFileType de file niet als 'buying' herkende.
   WIJZIGING v14:
   - processBuying: store_number mapping CUR→1, BON→B
   WIJZIGING v10:
   - processInventory filtert nu lege rijen en 'GRAND SUMMARIES' weg
   - Niet-numerieke dept codes (FA/FC/FE/FF/XX) samengevoegd tot 'OTHER'
   WIJZIGING v9:
   - processInventory gebruikt nu weer NOW kolom als "vandaag"
   WIJZIGING v7:
   - processBuying roept nu processNosSnapshot aan na succesvolle insert
   - Nieuwe functie processNosSnapshot: schrijft per (BUM × regio × datum)
     hoeveel NOS items in_stock / refilling / uncovered zijn naar
     nos_coverage_snapshots tabel (voor trendgrafiek Stock Risk Alert)
   WIJZIGING v6:
   - processNegativeInventory schrijft nu naar de ECHTE kolomnamen
     van negative_inventory: qty_on_hand, inv_value (i.p.v. qoh/cost)
   - Vult ook class_code, class_name, store_short_name,
     avg_cost_per_unit, report_date
   - Oorzaak bug: alle inserts faalden silently omdat kolomnamen
     niet matchten → tabel bleef leeg → Detail-tab leeg
   WIJZIGING v5:
   - processNegativeInventory schrijft nu ook BUM (Department Group) weg
   - Upsert naar negative_inventory_first_seen tabel
   WIJZIGING v4:
   - detectFileType herkent nu "Quantity on Hand"
   - Niet-numerieke dept codes samenvoegen tot 'OTHER'
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

  // Buying data: has "Item Number" + "Quantity on Hand" + "Sales Units" + "Department Group"
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('sales units'); }) &&
      cols.some(function(c) { return c.includes('department group'); })) {
    return 'buying';
  }

  // Negative inventory: has "Item Number" + "Quantity on Hand" + "Inventory Value"
  // (distinguishable from buying by absence of 'sales units')
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand') || c.includes('qty') || c.includes('qoh'); }) &&
      !cols.some(function(c) { return c.includes('sales units'); }) &&
      !cols.some(function(c) { return c.includes('net sales'); })) {
    return 'negative_inventory';
  }

  // Ticket/traffic data: has "Transaction Time" + "Net Sales" + "Date" (individual receipts)
  if (cols.some(function(c) { return c.includes('transaction time') || c.includes('transaction'); }) &&
      cols.some(function(c) { return c.includes('net sales'); }) &&
      cols.some(function(c) { return c.includes('date'); })) {
    return 'tickets';
  }

  // Sales data: has "net sales" + "date" + "bum" (aggregated department data)
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

    // Filter out FB and FC rows (financial charges + gift certificates)
    var dept = String(row[findCol(keys, ['department code', 'dept_code'])] || '');
    if (dept === 'FB' || dept === 'FC') return null;

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
  var currentYear = today.getFullYear();

  // Load static budgets from department_budgets table (replaces Compass Budget column)
  // Build lookup map: 'storenum|deptcode' → budget_amount
  var budgetMap = {};
  var bRes = await supabase
    .from('department_budgets')
    .select('store_number, dept_code, budget_amount')
    .eq('year', currentYear);
  if (bRes.error) {
    console.error('Budget load error: ' + bRes.error.message);
  } else if (bRes.data) {
    bRes.data.forEach(function(b) {
      budgetMap[b.store_number + '|' + b.dept_code] = parseFloat(b.budget_amount) || 0;
    });
    console.log('Loaded ' + Object.keys(budgetMap).length + ' department budgets for year ' + currentYear);
  }

  // Find date columns: NOW (=today), -1 MONTH, -2 MONTHS, etc.
  // NOTE: 'Actual' kolom (indien aanwezig) wordt GENEGEERD.
  // 'NOW' is volgens Compass de waarheid voor de huidige stand.
  var nowCol = null;
  var dateColumns = [];
  keys.forEach(function(k) {
    var kl = k.toLowerCase().trim();
    if (kl === 'now') {
      nowCol = k;
    } else if (kl === 'actual') {
      // SKIP - Actual wordt genegeerd
    } else {
      // Match patterns like "-1 MONTH", "-2 MONTHS", "- 3 MONTHS"
      var match = kl.match(/^-\s*(\d+)\s*months?$/);
      if (match) {
        dateColumns.push({ col: k, monthsBack: parseInt(match[1]) });
      }
    }
  });

  // If NOW exists, treat it as monthsBack=0 (today)
  if (nowCol) {
    dateColumns.push({ col: nowCol, monthsBack: 0 });
  }

  // Sort by monthsBack ascending (today first)
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
    var rawDeptCode = String(row[findCol(keys, ['department code'])] || '').trim();
    var rawDeptName = String(row[findCol(keys, ['department name'])] || '').trim();
    var bum = String(row[findCol(keys, ['department group'])] || '').trim();
    // Budget komt nu uit department_budgets tabel, niet uit Compass
    // (Compass Budget-kolom wordt genegeerd omdat die soms incompleet is)

    // Skip empty rows and 'GRAND SUMMARIES' totaal-rij uit Compass
    if (!rawDeptCode) return;
    if (storeRaw === 'GRAND SUMMARIES' || storeRaw === '') return;
    if (store !== '1' && store !== 'B') return;

    // Niet-numerieke dept codes (FA/FC/FE/FF/XX) samenvoegen tot 'OTHER'
    var isNumeric = /^\d+$/.test(rawDeptCode);
    var deptCode = isNumeric ? rawDeptCode : 'OTHER';
    var deptName = isNumeric ? rawDeptName : 'Other (niet-numerieke categorieën)';

    // Lookup budget uit department_budgets map
    var budget = budgetMap[store + '|' + deptCode] || 0;

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

  // Aggregate OTHER rijen per (store_number, dept_code, inventory_date) — anders
  // krijgen we 5 'OTHER' rijen per maand i.p.v. 1
  var aggregated = {};
  rows.forEach(function(r) {
    var key = r.store_number + '|' + r.dept_code + '|' + r.inventory_date;
    if (!aggregated[key]) {
      aggregated[key] = {
        store_number: r.store_number,
        dept_code: r.dept_code,
        dept_name: r.dept_name,
        bum: r.bum,
        budget: 0,
        inventory_value: 0,
        inventory_date: r.inventory_date,
      };
    }
    aggregated[key].inventory_value += r.inventory_value;
    // Budget alleen 1x optellen per (store, dept) — pak 'm uit eerste rij die 'm levert
    if (aggregated[key].budget === 0) aggregated[key].budget = r.budget;
  });
  rows = Object.values(aggregated);

  console.log('Inventory rows to insert: ' + rows.length);

  // Full replace: delete all existing rows (UUID-safe filter)
  var delResult = await supabase.from('inventory_data').delete({ count: 'exact' }).not('id', 'is', null);
  if (delResult.error) {
    console.error('Delete error: ' + delResult.error.message);
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
  var today = new Date().toISOString().split('T')[0];

  var rows = json.map(function(row) {
    var rawDept = String(row[findCol(keys, ['department code', 'dept_code', 'dept'])] || '').trim();
    var rawDeptName = String(row[findCol(keys, ['department name', 'dept_name'])] || '');

    // Non-numeric dept codes (FE, FF, XX, etc) bucket into 'OTHER'
    var isNumeric = /^\d+$/.test(rawDept);
    var deptCode = isNumeric ? rawDept : 'OTHER';
    var deptName = isNumeric ? rawDeptName : 'Other (niet-numerieke categorieën)';

    return {
      store_number: String(row[findCol(keys, ['store number', 'store'])] || ''),
      store_short_name: String(row[findCol(keys, ['store short', 'short name'])] || ''),
      dept_code: deptCode,
      dept_name: deptName,
      bum: String(row[findCol(keys, ['department group', 'bum'])] || ''),
      class_code: String(row[findCol(keys, ['class code'])] || ''),
      class_name: String(row[findCol(keys, ['class name'])] || ''),
      item_number: String(row[findCol(keys, ['item number', 'item'])] || ''),
      item_description: String(row[findCol(keys, ['item description', 'description', 'desc'])] || ''),
      qty_on_hand: parseFloat(row[findCol(keys, ['quantity on hand', 'qty', 'qoh'])] || 0),
      inv_value: parseFloat(row[findCol(keys, ['inventory value', 'inv value'])] || 0),
      avg_cost_per_unit: parseFloat(row[findCol(keys, ['average cost', 'avg cost'])] || 0),
      report_date: today,
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

  // ── FIRST-SEEN tracking: per item_number (not per store)
  var negRows = rows.filter(function(r) { return r.qty_on_hand < 0; });
  var uniqueItems = [...new Set(negRows.map(function(r) { return r.item_number; }))].filter(Boolean);

  console.log('Unique negative items to track: ' + uniqueItems.length);

  if (uniqueItems.length > 0) {
    var existingMap = {};
    var chunkSize = 500;
    for (var c = 0; c < uniqueItems.length; c += chunkSize) {
      var chunk = uniqueItems.slice(c, c + chunkSize);
      var fs = await supabase
        .from('negative_inventory_first_seen')
        .select('item_number, first_seen_date, last_seen_date')
        .in('item_number', chunk);
      if (fs.error) {
        console.error('First-seen load error: ' + fs.error.message);
        continue;
      }
      (fs.data || []).forEach(function(r) {
        existingMap[r.item_number] = r;
      });
    }

    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var yesterdayStr = yesterday.toISOString().split('T')[0];

    var upsertRows = uniqueItems.map(function(itemNum) {
      var existing = existingMap[itemNum];
      if (!existing) {
        return { item_number: itemNum, first_seen_date: today, last_seen_date: today };
      }
      if (existing.last_seen_date < yesterdayStr) {
        return { item_number: itemNum, first_seen_date: today, last_seen_date: today };
      }
      return { item_number: itemNum, first_seen_date: existing.first_seen_date, last_seen_date: today };
    });

    var fsUpserted = 0;
    for (var u = 0; u < upsertRows.length; u += 500) {
      var batch = upsertRows.slice(u, u + 500);
      var up = await supabase
        .from('negative_inventory_first_seen')
        .upsert(batch, { onConflict: 'item_number' });
      if (up.error) {
        console.error('First-seen upsert error: ' + up.error.message);
        continue;
      }
      fsUpserted += batch.length;
    }
    console.log('Upserted ' + fsUpserted + ' first_seen rows');
  }

  // ── SNAPSHOT: aggregate per (region, department)
  var snapAgg = {};

  negRows.forEach(function(r) {
    var sn = String(r.store_number).trim().toUpperCase();
    if (!sn) return;
    var region = (sn === 'A' || sn === 'B') ? 'Bonaire' : 'Curacao';

    var key = region + '|' + r.dept_code;
    if (!snapAgg[key]) {
      snapAgg[key] = {
        snapshot_date: today,
        region: region,
        department_code: r.dept_code,
        department_name: r.dept_name,
        items_count: 0,
        total_negative_value: 0,
        total_negative_qty: 0,
      };
    }
    snapAgg[key].items_count += 1;
    snapAgg[key].total_negative_value += (r.inv_value || 0);
    snapAgg[key].total_negative_qty += (r.qty_on_hand || 0);
  });

  var snapRows = Object.values(snapAgg).map(function(s) {
    return {
      snapshot_date: s.snapshot_date,
      region: s.region,
      department_code: s.department_code,
      department_name: s.department_name,
      items_count: s.items_count,
      total_negative_value: Math.round(s.total_negative_value * 100) / 100,
      total_negative_qty: Math.round(s.total_negative_qty * 100) / 100,
    };
  });

  console.log('Snapshot rows: ' + snapRows.length + ' (date=' + today + ')');

  if (snapRows.length > 0) {
    var delSnap = await supabase
      .from('negative_inventory_snapshots')
      .delete({ count: 'exact' })
      .eq('snapshot_date', today);
    if (delSnap.error) {
      console.error('Snapshot delete error: ' + delSnap.error.message);
    } else {
      console.log('Deleted ' + (delSnap.count || 0) + ' existing snapshot rows for ' + today);
    }

    var snapIns = await supabase.from('negative_inventory_snapshots').insert(snapRows);
    if (snapIns.error) {
      console.error('Snapshot insert error: ' + snapIns.error.message);
    } else {
      console.log('Inserted ' + snapRows.length + ' snapshot rows');
    }
  }

  return { table: 'negative_inventory', rows_imported: totalInserted, snapshot_rows: snapRows.length };
}

/* ── Process TICKET data (aggregate to traffic_data) ── */
async function processTickets(json) {
  var keys = Object.keys(json[0] || {});

  // Aggregate: per store per date → tickets (count) + total_sales (sum)
  var agg = {};
  json.forEach(function(row) {
    var store = String(row[findCol(keys, ['store number', 'store'])] || '').trim();
    var dateVal = row[findCol(keys, ['date'])];

    // Parse date
    if (dateVal instanceof Date) {
      dateVal = dateVal.toISOString().split('T')[0];
    } else if (typeof dateVal === 'number') {
      dateVal = new Date((dateVal - 25569) * 86400000).toISOString().split('T')[0];
    } else if (typeof dateVal === 'string') {
      var d = new Date(dateVal);
      if (!isNaN(d.getTime())) dateVal = d.toISOString().split('T')[0];
    }

    var sales = parseFloat(row[findCol(keys, ['net sales'])] || 0);
    if (!store || !dateVal) return;

    // Map store: digit stores = Curacao (1), letter stores = Bonaire (B)
    var storeKey = /^\d+$/.test(store) ? '1' : 'B';
    var key = storeKey + '|' + dateVal;

    if (!agg[key]) agg[key] = { store_number: storeKey, date: dateVal, tickets: 0, total_sales: 0 };
    agg[key].tickets++;
    agg[key].total_sales += sales;
  });

  var rows = Object.values(agg);
  console.log('Ticket aggregation: ' + rows.length + ' store/date combinations');
  rows.forEach(function(r) {
    console.log('  ' + r.store_number + ' ' + r.date + ': ' + r.tickets + ' tickets, ' + r.total_sales.toFixed(2) + ' sales');
  });

  // Smart replace: delete existing traffic_data for these dates, then insert
  // Only update tickets and total_sales, preserve visitors if they exist
  var uniqueDates = [...new Set(rows.map(function(r) { return r.date; }))];
  console.log('Dates: ' + uniqueDates.join(', '));

  for (var di = 0; di < uniqueDates.length; di++) {
    var dt = uniqueDates[di];

    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      if (row.date !== dt) continue;

      // Check if a row already exists (might have visitor data)
      var existing = await supabase.from('traffic_data')
        .select('*')
        .eq('store_number', row.store_number)
        .eq('date', row.date)
        .maybeSingle();

      if (existing.data) {
        // Update existing row: keep visitors, update tickets + sales
        var upd = await supabase.from('traffic_data')
          .update({ tickets: row.tickets, total_sales: row.total_sales })
          .eq('store_number', row.store_number)
          .eq('date', row.date);
        if (upd.error) console.error('Update error: ' + upd.error.message);
      } else {
        // Insert new row
        var ins = await supabase.from('traffic_data')
          .insert({
            store_number: row.store_number,
            date: row.date,
            tickets: row.tickets,
            total_sales: row.total_sales,
            visitors: 0,
            visitors_keuken: 0,
            visitors_multimart: 0,
          });
        if (ins.error) console.error('Insert error: ' + ins.error.message);
      }
    }
  }

  return { table: 'traffic_data', rows_imported: rows.length };
}

/* ── Process BUYING data (per BUM, full replace) ── */
async function processBuying(json) {
  // Verzamel ALLE keys die in ANY rij voorkomen (niet alleen rij 1)
  // Reden: SheetJS skipt lege cellen, dus rij 1 kan kolommen missen
  var keysSet = {};
  for (var ki = 0; ki < json.length; ki++) {
    var rk = Object.keys(json[ki]);
    for (var kj = 0; kj < rk.length; kj++) keysSet[rk[kj]] = true;
  }
  var keys = Object.keys(keysSet);

  // Detect BUM from data
  var bumCol = findCol(keys, ['department group']);
  var allBums = {};
  json.forEach(function(row) { var b = String(row[bumCol] || '').trim().toUpperCase(); if (b) allBums[b] = true; });
  var bumList = Object.keys(allBums);
  if (!bumList.length) throw new Error('No BUM (Department Group) found in buying data');
  console.log('BUM(s) in file: ' + bumList.join(', '));

  // Find the 12 sales columns (they contain "Sales Units")
  var salesCols = keys.filter(function(k) { return k.toLowerCase().includes('sales units') && !k.toLowerCase().includes('total') && !k.toLowerCase().includes('period'); });
  // Sort them: first col = most recent (m01), last = oldest (m12)
  // They come from Compass in order: newest first
  console.log('Sales columns found: ' + salesCols.length);

  // Map rows to buying_data format, filtering dead stock
  var rows = [];
  var skippedDead = 0;
  var skippedSummary = 0;
  json.forEach(function(row) {
    // Skip totaal-rijen ('Sum = X') die Compass onderaan toevoegt
    // Deze hebben geen Item Number en bevatten string-waardes als 'Sum = 12345'
    var itemNum = String(row[findCol(keys, ['item number'])] || '').trim();
    if (!itemNum) {
      skippedSummary++;
      return;
    }

    var qoh = parseFloat(row[findCol(keys, ['quantity on hand'])] || 0);

    // Sanity check: als qoh NaN is na parseFloat, skip de rij (defensief)
    if (Number.isNaN(qoh)) {
      skippedSummary++;
      return;
    }

    // Check dead stock: QOH=0 AND no sales in first 6 months (most recent)
    var recentSales = 0;
    for (var si = 0; si < Math.min(6, salesCols.length); si++) {
      recentSales += parseFloat(row[salesCols[si]] || 0);
    }
    if (qoh === 0 && recentSales === 0) {
      skippedDead++;
      return; // Skip dead stock
    }

    // Build sales_m01..sales_m12
    var salesObj = {};
    for (var i = 0; i < Math.min(12, salesCols.length); i++) {
      salesObj['sales_m' + String(i + 1).padStart(2, '0')] = parseFloat(row[salesCols[i]] || 0);
    }
    // Fill remaining if less than 12 sales columns
    for (var j = salesCols.length; j < 12; j++) {
      salesObj['sales_m' + String(j + 1).padStart(2, '0')] = 0;
    }

    // Store mapping uit Compass 'Store Group' kolom: CUR → '1', BON → 'B'
    // (consistent met inventory_data store_number formaat)
    var rawStore = String(row[findCol(keys, ['store group', 'store number', 'store'])] || '').trim().toUpperCase();
    var storeNum = rawStore === 'CUR' ? '1' : rawStore === 'BON' ? 'B' : rawStore;

    var r = {
      store_number: storeNum,
      dept_code: String(row[findCol(keys, ['department code'])] || ''),
      dept_name: String(row[findCol(keys, ['department name'])] || ''),
      class_code: String(row[findCol(keys, ['class code'])] || ''),
      class_name: String(row[findCol(keys, ['class name'])] || ''),
      item_number: String(row[findCol(keys, ['item number'])] || ''),
      item_description: String(row[findCol(keys, ['item description'])] || ''),
      nos: String(row[findCol(keys, ['nos'])] || ''),
      min_lead_time: parseFloat(row[findCol(keys, ['min lead'])] || 0),
      max_lead_time: parseFloat(row[findCol(keys, ['max lead'])] || 0),
      qoh: qoh,
      qty_committed: parseFloat(row[findCol(keys, ['quantity committed'])] || 0),
      qty_available: parseFloat(row[findCol(keys, ['quantity available'])] || 0),
      qty_on_order: parseFloat(row[findCol(keys, ['quantity on order'])] || 0),
      vendor_code: String(row[findCol(keys, ['vendor code'])] || ''),
      vendor_name: String(row[findCol(keys, ['vendor name'])] || ''),
      replacement_cost: parseFloat(row[findCol(keys, ['replacement cost'])] || 0),
      inv_value_at_cost: parseFloat(row[findCol(keys, ['inventory value', 'inv value'])] || 0),
      bum: String(row[bumCol] || '').trim().toUpperCase(),
      upload_date: new Date().toISOString().split('T')[0],
    };
    Object.assign(r, salesObj);
    rows.push(r);
  });

  console.log('Active rows: ' + rows.length + ', dead stock skipped: ' + skippedDead + ', summary/empty rows skipped: ' + skippedSummary);

  // Delete existing data for this BUM (full replace per BUM)
  for (var bi = 0; bi < bumList.length; bi++) {
    var bum = bumList[bi];
    var delResult = await supabase.from('buying_data').delete({ count: 'exact' }).eq('bum', bum);
    if (delResult.error) {
      console.error('Delete error for BUM ' + bum + ': ' + delResult.error.message);
    } else {
      console.log('Deleted ' + (delResult.count || 0) + ' existing rows for BUM ' + bum);
    }
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await supabase.from('buying_data').insert(batch);
    if (res.error) {
      console.error('Buying batch error at ' + i + ': ' + res.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  // ── NOS coverage snapshot (per BUM × regio × today)
  try {
    await processNosSnapshot();
  } catch (snapErr) {
    console.error('NOS snapshot error: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
  }

  return { table: 'buying_data', rows_imported: totalInserted, bums: bumList };
}

/* ── NOS coverage snapshot ──
   Roept buying_data op nadat nieuwe data is geïnsert.
   Aggregeert per (item, bum, regio): qoh + qoo. Categoriseert als
   in_stock / refilling / uncovered. Telt per BUM × regio. Plus 'Total' regio
   per BUM (item-niveau som over Cur+Bon).
   Schrijft naar nos_coverage_snapshots (full replace voor vandaag). */
async function processNosSnapshot() {
  var today = new Date().toISOString().split('T')[0];
  console.log('NOS snapshot: building for ' + today);

  // Load all NOS rows from buying_data (page through 1000-row limit)
  var all = [];
  var from = 0;
  var step = 1000;
  while (true) {
    var r = await supabase
      .from('buying_data')
      .select('item_number, store_number, bum, qoh, qty_on_order, nos, sales_m01, sales_m02, sales_m03, sales_m04, sales_m05, sales_m06, sales_m07, sales_m08, sales_m09, sales_m10, sales_m11, sales_m12')
      .eq('nos', 'N')
      .range(from, from + step - 1);
    if (r.error) {
      console.error('NOS snapshot load error: ' + r.error.message);
      return;
    }
    if (!r.data || !r.data.length) break;
    all = all.concat(r.data);
    if (r.data.length < step) break;
    from += step;
  }
  console.log('NOS snapshot: loaded ' + all.length + ' NOS rows');

  // Aggregate per (item, bum, region)
  // region: numeric store -> Curacao, anders Bonaire
  var agg = {};
  all.forEach(function(rec) {
    var bum = String(rec.bum || '').toUpperCase();
    if (!bum) return;
    var sn = String(rec.store_number || '');
    var region = /^\d+$/.test(sn) ? 'Curacao' : 'Bonaire';
    var key = bum + '|' + region + '|' + rec.item_number;
    if (!agg[key]) {
      agg[key] = {
        bum: bum,
        region: region,
        item_number: rec.item_number,
        qoh: 0,
        qoo: 0,
        sales_total: 0,
      };
    }
    agg[key].qoh += parseFloat(rec.qoh) || 0;
    agg[key].qoo += parseFloat(rec.qty_on_order) || 0;
    for (var i = 1; i <= 12; i++) {
      var k = 'sales_m' + (i < 10 ? '0' + i : '' + i);
      agg[key].sales_total += parseFloat(rec[k]) || 0;
    }
  });

  // Filter to items with sales history (consistent with Stock Risk page)
  var aggArr = Object.values(agg).filter(function(x) { return x.sales_total > 0; });

  // Per BUM × region counts
  var perGroup = {};      // key = bum|region
  var perBumItems = {};   // key = bum|item -> { qoh, qoo } (combined Cur+Bon)

  aggArr.forEach(function(x) {
    var gKey = x.bum + '|' + x.region;
    if (!perGroup[gKey]) {
      perGroup[gKey] = { bum: x.bum, region: x.region, total: 0, in_stock: 0, refilling: 0, uncovered: 0 };
    }
    perGroup[gKey].total += 1;
    if (x.qoh > 0) perGroup[gKey].in_stock += 1;
    else if (x.qoh + x.qoo > 0) perGroup[gKey].refilling += 1;
    else perGroup[gKey].uncovered += 1;

    // Combine for Total per BUM at item level
    var iKey = x.bum + '|' + x.item_number;
    if (!perBumItems[iKey]) perBumItems[iKey] = { bum: x.bum, qoh: 0, qoo: 0 };
    perBumItems[iKey].qoh += x.qoh;
    perBumItems[iKey].qoo += x.qoo;
  });

  // Per BUM × Total
  var perBumTotal = {};
  Object.values(perBumItems).forEach(function(x) {
    var key = x.bum;
    if (!perBumTotal[key]) {
      perBumTotal[key] = { bum: x.bum, region: 'Total', total: 0, in_stock: 0, refilling: 0, uncovered: 0 };
    }
    perBumTotal[key].total += 1;
    if (x.qoh > 0) perBumTotal[key].in_stock += 1;
    else if (x.qoh + x.qoo > 0) perBumTotal[key].refilling += 1;
    else perBumTotal[key].uncovered += 1;
  });

  // Build snapshot rows
  var snapRows = [];
  Object.values(perGroup).forEach(function(g) {
    snapRows.push({
      snapshot_date: today,
      bum: g.bum,
      region: g.region,
      total_nos_items: g.total,
      in_stock: g.in_stock,
      refilling: g.refilling,
      uncovered: g.uncovered,
    });
  });
  Object.values(perBumTotal).forEach(function(g) {
    snapRows.push({
      snapshot_date: today,
      bum: g.bum,
      region: g.region,
      total_nos_items: g.total,
      in_stock: g.in_stock,
      refilling: g.refilling,
      uncovered: g.uncovered,
    });
  });

  console.log('NOS snapshot: ' + snapRows.length + ' rows ready');

  if (snapRows.length === 0) {
    console.log('NOS snapshot: no rows to insert');
    return;
  }

  // Delete today's existing snapshot first (idempotent on re-run)
  var del = await supabase
    .from('nos_coverage_snapshots')
    .delete({ count: 'exact' })
    .eq('snapshot_date', today);
  if (del.error) {
    console.error('NOS snapshot delete error: ' + del.error.message);
  } else {
    console.log('NOS snapshot: deleted ' + (del.count || 0) + ' existing rows for ' + today);
  }

  // Insert
  var ins = await supabase.from('nos_coverage_snapshots').insert(snapRows);
  if (ins.error) {
    console.error('NOS snapshot insert error: ' + ins.error.message);
  } else {
    console.log('NOS snapshot: inserted ' + snapRows.length + ' rows');
  }
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

    // Auto-detect file type — gebruik de ECHTE header-rij uit de sheet,
    // niet Object.keys(json[0]). SheetJS skipt lege cellen, dus als rij 1
    // ergens leeg is, mist die kolom in het object.
    var headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0 });
    var columns = (headerRows[0] || []).map(function(c) { return String(c || '').trim(); }).filter(function(c) { return c.length > 0; });

    // Fallback als header-extractie niet werkt
    if (!columns.length) {
      columns = Object.keys(json[0]);
    }

    var fileType = detectFileType(columns);
    console.log('Detected file type: ' + fileType);
    console.log('Columns: ' + columns.join(', '));

    var result;
    var batchId = crypto.randomUUID();

    if (fileType === 'inventory') {
      result = await processInventory(json);
    } else if (fileType === 'tickets') {
      result = await processTickets(json);
    } else if (fileType === 'buying') {
      result = await processBuying(json);
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
