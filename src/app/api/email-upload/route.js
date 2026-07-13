/* ============================================================
   BESTAND: route_email_v24.js
   KOPIEER NAAR: src/app/api/email-upload/route.js
   (vervangt de huidige route.js)

   CRITICAL BUGFIX v24:
   - Compass exports voor Daniel, John, Gijs (nieuw naamgevingsformaat
     "AI Voorraden <Naam> <REGIO>") werden niet herkend als buying_data
     omdat ze geen "Department Group" kolom hebben.
     Gevolg: sinds ~mei 2026 alleen Henk en Pascal (Ivo) worden ververst;
     Daniel/John/Gijs data was verouderd.
   - Fix 1: detectFileType herkent nu ook buying files zonder "Department
     Group" (alternatieve signatuur: Store Group + Sales Units + Item Number
     + Quantity on Hand + geen "now"/"month" kolom)
   - Fix 2: processBuying accepteert nu filename en leidt BUM daaruit af
     als "Department Group" kolom ontbreekt.
     Mapping: pascal/ivo → PASCAL, henk → HENK, john → JOHN,
              daniel → DANIEL, gijs → GIJS

   WIJZIGING v23:
   - processBuying leest nu de kolom "MFG Part #" en slaat op
     in nieuwe buying_data.mfg_part_number kolom
   - SQL vereist (vooraf draaien):
       ALTER TABLE buying_data ADD COLUMN mfg_part_number text;
   - Detectie tolerant voor varianten: "MFG Part #", "MFG#",
     "Manufacturer Part", etc.
   - BUGFIX processPoDeliveries: dateKey pattern matchte per ongeluk
     op de "PO Detail" kolom omdat 'eta' substring is van 'detail'.
     Pattern 'eta' verwijderd; alleen specifieke patterns als
     'date expected' / 'expected date' / 'eta date' worden geaccepteerd.
     Gevolg eerder: PO-nummer (bv. 17381) werd als jaartal opgeslagen
     (date_expected = 17381-01-01) → "1/1" in UI.
   - Extra: jaar-sanity-check 2020-2035 in processPoDeliveries.
     Rijen met out-of-range jaar worden geskipt + gelogd.
   WIJZIGING v22:
   - processNosSnapshot schrijft naast nos_coverage_snapshots óók
     naar nieuwe tabel nos_coverage_snapshots_dept (per dept_code)
   - Vereist nieuwe Supabase tabel (SQL elders aangeleverd)
   - buying_data SELECT uitgebreid met dept_code, dept_name
   - Per (bum, region, dept_code) wordt in/refilling/uncovered geteld
   - Ook 'Total' rij per (bum, dept_code) als rollup CUR+BON
   WIJZIGING v21:
   - Nieuw file type 'po_deliveries' toegevoegd
     * Detectie via kolommen: PO Detail + Item Number + Date Expected
     * processPoDeliveries: TRUNCATE + INSERT in chunks van 1000
     * Vult tabel po_deliveries (gebruikt door Stock Risk Alert)
   - po_deliveries detectie staat VOOR negative_inventory en
     price_changes om early-match te voorkomen
   WIJZIGING v20:
   - BUGFIX: 6 plekken in de code gebruikten nog 'supabase' (zonder
     getSupabase()) terwijl v19 die globale variabele had verwijderd.
     Gevolg: processInventory crashte met "ReferenceError: supabase
     is not defined" sinds 11 mei → geen nieuwe inventory data meer.
     Ook processNegativeInventory (first_seen reads + upsert + snapshot
     delete) en processNosSnapshot waren stiekem stuk.
   - Alle bare 'supabase' calls vervangen door getSupabase().
   WIJZIGING v19:
   - Build fix: Supabase client wordt nu lazy gemaakt via getSupabase()
     ipv top-level. Voorkomt 'supabaseKey is required' error tijdens
     Vercel build die optreedt na het sensitive markeren van env vars.
   - dynamic = 'force-dynamic' en runtime = 'nodejs' toegevoegd
   - Functionaliteit identiek aan v18.
   WIJZIGING v18:
   - Nieuwe file type 'price_changes' toegevoegd:
     * Detectie via 'Date Of Last Sale' kolom (uniek voor deze file)
     * processPriceChanges schrijft naar price_snapshots tabel
     * Gebruikt vandaag als snapshot_date
     * Delete-then-insert per (regio × snapshot_date)
   WIJZIGING v17:
   - processBuying schrijft 'regio' kolom (CUR/BON) i.p.v. mapping naar store_number
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
// Lazy initialization: create client only when needed (not at module load)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  // Alt buying data (nieuwere "AI Voorraden" exports, sinds ~mei 2026):
  // heeft geen "Department Group" kolom meer, maar wel dezelfde structuur.
  // Signatuur: Item Number + Quantity on Hand + Sales Units + Store Group (i.p.v. Department Group)
  // BUM moet dan uit filename komen (gebeurt in processBuying).
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('sales units'); }) &&
      cols.some(function(c) { return c.includes('store group'); }) &&
      !cols.some(function(c) { return c === 'now' || c.includes('month'); })) {
    return 'buying';
  }

  // PO Deliveries: has "PO Detail" + "Item Number" + "Date Expected" + "QOO Rounded Quantity"
  // Moet voor negative_inventory en price_changes worden geprobeerd om early match te voorkomen
  if (cols.some(function(c) { return c.includes('po detail') || c.includes('po number'); }) &&
      cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('date expected') || c.includes('eta'); })) {
    return 'po_deliveries';
  }

  // Price changes: has "Item Number" + "Quantity on Hand" + "Store Group" + "Date Of Last Sale"
  // Moet voor negative_inventory worden geprobeerd want anders matcht dat eerst
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('store group'); }) &&
      cols.some(function(c) { return c.includes('date of last sale') || c.includes('last sale'); })) {
    return 'price_changes';
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
    var delResult = await getSupabase().from('sales_data').delete({ count: 'exact' }).in('sale_date', uniqueDates);
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
    var res = await getSupabase().from('sales_data').insert(batch);
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
  var bRes = await getSupabase()
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
  var delResult = await getSupabase().from('inventory_data').delete({ count: 'exact' }).not('id', 'is', null);
  if (delResult.error) {
    console.error('Delete error: ' + delResult.error.message);
  } else {
    console.log('Deleted ' + (delResult.count || 0) + ' existing inventory rows');
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await getSupabase().from('inventory_data').insert(batch);
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
  var delResult = await getSupabase().from('negative_inventory').delete({ count: 'exact' }).neq('id', 0);
  if (delResult.error) {
    var delResult2 = await getSupabase().from('negative_inventory').delete({ count: 'exact' }).gte('id', 0);
    console.log('Deleted existing negative inventory rows');
  }

  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await getSupabase().from('negative_inventory').insert(batch);
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
      var fs = await getSupabase()
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
      var up = await getSupabase()
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
    var delSnap = await getSupabase()
      .from('negative_inventory_snapshots')
      .delete({ count: 'exact' })
      .eq('snapshot_date', today);
    if (delSnap.error) {
      console.error('Snapshot delete error: ' + delSnap.error.message);
    } else {
      console.log('Deleted ' + (delSnap.count || 0) + ' existing snapshot rows for ' + today);
    }

    var snapIns = await getSupabase().from('negative_inventory_snapshots').insert(snapRows);
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
      var existing = await getSupabase().from('traffic_data')
        .select('*')
        .eq('store_number', row.store_number)
        .eq('date', row.date)
        .maybeSingle();

      if (existing.data) {
        // Update existing row: keep visitors, update tickets + sales
        var upd = await getSupabase().from('traffic_data')
          .update({ tickets: row.tickets, total_sales: row.total_sales })
          .eq('store_number', row.store_number)
          .eq('date', row.date);
        if (upd.error) console.error('Update error: ' + upd.error.message);
      } else {
        // Insert new row
        var ins = await getSupabase().from('traffic_data')
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
async function processBuying(json, filename) {
  // Verzamel ALLE keys die in ANY rij voorkomen (niet alleen rij 1)
  // Reden: SheetJS skipt lege cellen, dus rij 1 kan kolommen missen
  var keysSet = {};
  for (var ki = 0; ki < json.length; ki++) {
    var rk = Object.keys(json[ki]);
    for (var kj = 0; kj < rk.length; kj++) keysSet[rk[kj]] = true;
  }
  var keys = Object.keys(keysSet);

  // BUM detectie:
  // 1. Probeer eerst de "Department Group" kolom (oude Compass exports)
  // 2. Fallback: leid BUM af uit filename (nieuwere "AI Voorraden ..." exports)
  var bumCol = findCol(keys, ['department group']);
  var allBums = {};
  if (bumCol) {
    json.forEach(function(row) { var b = String(row[bumCol] || '').trim().toUpperCase(); if (b) allBums[b] = true; });
  }
  var bumList = Object.keys(allBums);

  // Fallback: filename-based BUM detectie
  // Mapping op basis van keywords in filename. "Ivo" = Pascal (custom naam).
  var bumFromFilename = null;
  if (!bumList.length && filename) {
    var lower = String(filename).toLowerCase();
    var fnameMap = [
      ['pascal', 'PASCAL'],
      ['ivo', 'PASCAL'],       // Ivo = Pascal
      ['henk', 'HENK'],
      ['john', 'JOHN'],
      ['daniel', 'DANIEL'],
      ['gijs', 'GIJS'],
    ];
    for (var fi = 0; fi < fnameMap.length; fi++) {
      if (lower.indexOf(fnameMap[fi][0]) !== -1) {
        bumFromFilename = fnameMap[fi][1];
        break;
      }
    }
    if (bumFromFilename) {
      bumList = [bumFromFilename];
      console.log('BUM derived from filename: ' + bumFromFilename + ' (filename=' + filename + ')');
    }
  }

  if (!bumList.length) throw new Error('No BUM (Department Group) found in buying data — and could not derive from filename: ' + (filename || 'unknown'));
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

    // Regio mapping uit Compass 'Store Group' kolom: CUR/BON
    // store_number blijft leeg bij buying imports (Compass export is
    // geaggregeerd, niet per fysieke store). Filtering in dashboard
    // gebeurt op regio.
    var rawStore = String(row[findCol(keys, ['store group', 'store number', 'store'])] || '').trim().toUpperCase();
    var regio = rawStore === 'CUR' || rawStore === 'BON' ? rawStore : null;

    var r = {
      store_number: '',
      regio: regio,
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
      // v23: MFG Part # is het artikelnummer van de fabrikant (verschilt van onze SKU).
      // Gebruikt in Stock Risk voor inkoop.
      mfg_part_number: String(row[findCol(keys, ['mfg part', 'manufacturer part', 'mfg#', 'mfg part #'])] || '').trim(),
      replacement_cost: parseFloat(row[findCol(keys, ['replacement cost'])] || 0),
      inv_value_at_cost: parseFloat(row[findCol(keys, ['inventory value', 'inv value'])] || 0),
      bum: bumCol ? String(row[bumCol] || '').trim().toUpperCase() : (bumFromFilename || ''),
      upload_date: new Date().toISOString().split('T')[0],
    };
    Object.assign(r, salesObj);
    rows.push(r);
  });

  console.log('Active rows: ' + rows.length + ', dead stock skipped: ' + skippedDead + ', summary/empty rows skipped: ' + skippedSummary);

  // Determine unique (BUM, regio) combinations in the new file
  // Then delete only those combinations — niet per BUM, niet per store_number.
  // Hierdoor blijven andere regio's intact bij CUR-only of BON-only uploads.
  var bumRegioCombos = {};
  rows.forEach(function(r) {
    var key = r.bum + '||' + r.regio;
    bumRegioCombos[key] = { bum: r.bum, regio: r.regio };
  });
  var combos = Object.values(bumRegioCombos);

  for (var ci = 0; ci < combos.length; ci++) {
    var c = combos[ci];
    var delResult = await getSupabase().from('buying_data')
      .delete({ count: 'exact' })
      .eq('bum', c.bum)
      .eq('regio', c.regio);
    if (delResult.error) {
      console.error('Delete error for ' + c.bum + '/' + c.regio + ': ' + delResult.error.message);
    } else {
      console.log('Deleted ' + (delResult.count || 0) + ' existing rows for ' + c.bum + ' / regio ' + c.regio);
    }
  }

  // Insert in batches
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await getSupabase().from('buying_data').insert(batch);
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
    var r = await getSupabase()
      .from('buying_data')
      .select('item_number, store_number, bum, dept_code, dept_name, qoh, qty_on_order, nos, sales_m01, sales_m02, sales_m03, sales_m04, sales_m05, sales_m06, sales_m07, sales_m08, sales_m09, sales_m10, sales_m11, sales_m12')
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

  // Aggregate per (item, bum, region) — voor item-level counts (origineel)
  // En per (item, bum, region, dept_code) — voor dept-level snapshots (nieuw)
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
        dept_code: String(rec.dept_code || '').trim(),
        dept_name: String(rec.dept_name || '').trim(),
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
  // NEW v22: dept-level aggregations
  var perGroupDept = {};         // key = bum|region|dept_code -> counts
  var perBumDeptItems = {};      // key = bum|dept_code|item -> { qoh, qoo } (combined Cur+Bon)
  var deptNames = {};            // key = dept_code -> dept_name (laatste niet-lege wint)

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

    // Dept-level: alleen meedoen als dept_code aanwezig is
    if (x.dept_code) {
      if (x.dept_name) deptNames[x.dept_code] = x.dept_name;

      var gdKey = x.bum + '|' + x.region + '|' + x.dept_code;
      if (!perGroupDept[gdKey]) {
        perGroupDept[gdKey] = {
          bum: x.bum, region: x.region, dept_code: x.dept_code,
          total: 0, in_stock: 0, refilling: 0, uncovered: 0,
        };
      }
      perGroupDept[gdKey].total += 1;
      if (x.qoh > 0) perGroupDept[gdKey].in_stock += 1;
      else if (x.qoh + x.qoo > 0) perGroupDept[gdKey].refilling += 1;
      else perGroupDept[gdKey].uncovered += 1;

      // Voor Total per BUM × dept (item-level combined Cur+Bon)
      var idKey = x.bum + '|' + x.dept_code + '|' + x.item_number;
      if (!perBumDeptItems[idKey]) {
        perBumDeptItems[idKey] = { bum: x.bum, dept_code: x.dept_code, qoh: 0, qoo: 0 };
      }
      perBumDeptItems[idKey].qoh += x.qoh;
      perBumDeptItems[idKey].qoo += x.qoo;
    }
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

  // NEW v22: Per BUM × dept × Total
  var perBumDeptTotal = {};
  Object.values(perBumDeptItems).forEach(function(x) {
    var key = x.bum + '|' + x.dept_code;
    if (!perBumDeptTotal[key]) {
      perBumDeptTotal[key] = {
        bum: x.bum, region: 'Total', dept_code: x.dept_code,
        total: 0, in_stock: 0, refilling: 0, uncovered: 0,
      };
    }
    perBumDeptTotal[key].total += 1;
    if (x.qoh > 0) perBumDeptTotal[key].in_stock += 1;
    else if (x.qoh + x.qoo > 0) perBumDeptTotal[key].refilling += 1;
    else perBumDeptTotal[key].uncovered += 1;
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
  var del = await getSupabase()
    .from('nos_coverage_snapshots')
    .delete({ count: 'exact' })
    .eq('snapshot_date', today);
  if (del.error) {
    console.error('NOS snapshot delete error: ' + del.error.message);
  } else {
    console.log('NOS snapshot: deleted ' + (del.count || 0) + ' existing rows for ' + today);
  }

  // Insert
  var ins = await getSupabase().from('nos_coverage_snapshots').insert(snapRows);
  if (ins.error) {
    console.error('NOS snapshot insert error: ' + ins.error.message);
  } else {
    console.log('NOS snapshot: inserted ' + snapRows.length + ' rows');
  }

  // NEW v22: Schrijf óók dept-level snapshot naar nos_coverage_snapshots_dept
  var deptRows = [];
  Object.values(perGroupDept).forEach(function(g) {
    deptRows.push({
      snapshot_date: today,
      bum: g.bum,
      region: g.region,
      dept_code: g.dept_code,
      dept_name: deptNames[g.dept_code] || '',
      total_nos_items: g.total,
      in_stock: g.in_stock,
      refilling: g.refilling,
      uncovered: g.uncovered,
    });
  });
  Object.values(perBumDeptTotal).forEach(function(g) {
    deptRows.push({
      snapshot_date: today,
      bum: g.bum,
      region: g.region, // 'Total'
      dept_code: g.dept_code,
      dept_name: deptNames[g.dept_code] || '',
      total_nos_items: g.total,
      in_stock: g.in_stock,
      refilling: g.refilling,
      uncovered: g.uncovered,
    });
  });

  console.log('NOS dept snapshot: ' + deptRows.length + ' rows ready');

  if (deptRows.length > 0) {
    var delDept = await getSupabase()
      .from('nos_coverage_snapshots_dept')
      .delete({ count: 'exact' })
      .eq('snapshot_date', today);
    if (delDept.error) {
      console.error('NOS dept snapshot delete error: ' + delDept.error.message);
    } else {
      console.log('NOS dept snapshot: deleted ' + (delDept.count || 0) + ' existing rows for ' + today);
    }
    var insDept = await getSupabase().from('nos_coverage_snapshots_dept').insert(deptRows);
    if (insDept.error) {
      console.error('NOS dept snapshot insert error: ' + insDept.error.message);
    } else {
      console.log('NOS dept snapshot: inserted ' + deptRows.length + ' rows');
    }
  }
}

/* ── Process PRICE CHANGES data ──
   Schrijft naar price_snapshots tabel, met snapshot_date = vandaag.
   Verwijdert eerst bestaande rijen voor (regio × snapshot_date) en insert
   daarna de nieuwe rijen. Items waar qoh <= 0 of inv_value <= 0 worden geskipt
   (kunnen geen prijs voor berekenen). Duplicate items binnen één regio worden
   geaggregeerd (qoh + inv_value gesomd) zodat de unique constraint niet faalt.
*/
async function processPriceChanges(json) {
  // Verzamel alle keys uit alle rijen (SheetJS skipt lege cellen in rij 1)
  var keysSet = {};
  for (var ki = 0; ki < json.length; ki++) {
    var rk = Object.keys(json[ki]);
    for (var kj = 0; kj < rk.length; kj++) keysSet[rk[kj]] = true;
  }
  var keys = Object.keys(keysSet);

  // Snapshot datum = vandaag
  var today = new Date().toISOString().slice(0, 10);
  console.log('Price snapshot for ' + today);

  // Eerst aggregeren per (item × regio): qoh en inv_value sommen voor duplicates
  var aggMap = {};
  var skippedNoQoh = 0;
  var skippedNoItem = 0;
  var skippedNoRegio = 0;

  json.forEach(function(row) {
    var itemNum = String(row[findCol(keys, ['item number'])] || '').trim();
    if (!itemNum) {
      skippedNoItem++;
      return;
    }

    var rawStore = String(row[findCol(keys, ['store group'])] || '').trim().toUpperCase();
    var regio = (rawStore === 'CUR' || rawStore === 'BON') ? rawStore : null;
    if (!regio) {
      skippedNoRegio++;
      return;
    }

    var qoh = parseFloat(row[findCol(keys, ['quantity on hand'])] || 0);
    var invValue = parseFloat(row[findCol(keys, ['inventory value', 'inv value'])] || 0);

    var key = itemNum + '|' + regio;
    if (!aggMap[key]) {
      // Pad dept_code with leading zero if numeric
      var deptCode = String(row[findCol(keys, ['department code'])] || '').trim();
      if (/^\d+$/.test(deptCode) && deptCode.length === 1) deptCode = '0' + deptCode;

      var nos = String(row[findCol(keys, ['code d2', 'nos'])] || '').trim();
      if (nos.toLowerCase() === 'nan') nos = '';

      aggMap[key] = {
        item_number: itemNum,
        item_description: String(row[findCol(keys, ['item description'])] || '').slice(0, 200),
        dept_code: deptCode,
        dept_name: String(row[findCol(keys, ['department name'])] || '').slice(0, 100),
        bum: '',
        nos: nos,
        regio: regio,
        snapshot_date: today,
        qoh: 0,
        inv_value: 0,
      };
    }
    aggMap[key].qoh += qoh;
    aggMap[key].inv_value += invValue;
  });

  // Bereken unit_price = inv_value / qoh, skip als qoh of inv_value <= 0
  var rows = [];
  Object.values(aggMap).forEach(function(rec) {
    if (rec.qoh <= 0 || rec.inv_value <= 0) {
      skippedNoQoh++;
      return;
    }
    var price = rec.inv_value / rec.qoh;
    if (price <= 0) {
      skippedNoQoh++;
      return;
    }
    rec.unit_price = Math.round(price * 10000) / 10000;
    rows.push(rec);
  });

  console.log('Price changes: ' + rows.length + ' valid items, skipped: ' +
              skippedNoQoh + ' (qoh/value <= 0), ' +
              skippedNoItem + ' (no item number), ' +
              skippedNoRegio + ' (no regio)');

  // Bepaal welke regio's er in de file zitten
  var regiosInFile = {};
  rows.forEach(function(r) { regiosInFile[r.regio] = true; });

  // Verwijder bestaande snapshots voor vandaag × elke regio in de file
  for (var regio in regiosInFile) {
    var delResult = await getSupabase().from('price_snapshots')
      .delete({ count: 'exact' })
      .eq('regio', regio)
      .eq('snapshot_date', today);
    if (delResult.error) {
      console.error('Price snapshot delete error for ' + regio + ': ' + delResult.error.message);
    } else {
      console.log('Price snapshot: deleted ' + (delResult.count || 0) + ' existing rows for ' + regio + ' / ' + today);
    }
  }

  // Insert in batches van 500
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var res = await getSupabase().from('price_snapshots').insert(batch);
    if (res.error) {
      console.error('Price snapshot batch error at ' + i + ': ' + res.error.message);
      continue;
    }
    totalInserted += batch.length;
  }

  console.log('Price snapshots: imported ' + totalInserted + ' rows for ' + today);

  return { table: 'price_snapshots', rows_imported: totalInserted, regios: Object.keys(regiosInFile), snapshot_date: today };
}

/* ══════════════════════════════════════════════
   PROCESS PO DELIVERIES
   - Snapshot van alle openstaande PO's (Purchase Orders)
   - Strategy: TRUNCATE + INSERT (PO's verschuiven dagelijks van datum, sommige
     komen vroeger/later aan, nieuwe PO's worden aangemaakt, oude verdwijnen)
   - Verwachte kolommen: PO Detail, Item Number, Item Description, Date Expected, QOO Rounded Quantity
   ══════════════════════════════════════════════ */
async function processPoDeliveries(json) {
  // Verzamel alle keys uit alle rijen
  var keysSet = {};
  for (var ki = 0; ki < json.length; ki++) {
    var rk = Object.keys(json[ki]);
    for (var kj = 0; kj < rk.length; kj++) keysSet[rk[kj]] = true;
  }
  var keys = Object.keys(keysSet);

  var poKey = findCol(keys, ['po detail', 'po number']);
  var itemKey = findCol(keys, ['item number']);
  var descKey = findCol(keys, ['item description', 'description']);
  var dateKey = findCol(keys, ['date expected', 'expected date', 'eta date', 'estimated arrival']);
  var qtyKey = findCol(keys, ['qoo rounded quantity', 'quantity', 'qoo', 'qty']);

  if (!poKey || !itemKey || !dateKey || !qtyKey) {
    console.error('PO deliveries: missing required columns. Found: ' + JSON.stringify({ poKey: poKey, itemKey: itemKey, dateKey: dateKey, qtyKey: qtyKey }));
    return { table: 'po_deliveries', rows_imported: 0 };
  }

  // Bouw rows
  var rows = [];
  var skipped = 0;
  for (var i = 0; i < json.length; i++) {
    var row = json[i];
    var po = String(row[poKey] || '').trim();
    var item = String(row[itemKey] || '').trim();
    var dateVal = row[dateKey];
    var qty = parseFloat(row[qtyKey]) || 0;

    if (!po || !item || !dateVal || qty <= 0) {
      skipped++;
      continue;
    }

    // Date parsing: SheetJS levert Date objecten (door cellDates: true)
    var dateStr = '';
    if (dateVal instanceof Date) {
      // YYYY-MM-DD format, gebruik UTC om timezone-issues te voorkomen
      dateStr = dateVal.getUTCFullYear() + '-' +
                String(dateVal.getUTCMonth() + 1).padStart(2, '0') + '-' +
                String(dateVal.getUTCDate()).padStart(2, '0');
    } else {
      // Fallback: parse string
      var d = new Date(dateVal);
      if (isNaN(d.getTime())) {
        skipped++;
        continue;
      }
      dateStr = d.getUTCFullYear() + '-' +
                String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
                String(d.getUTCDate()).padStart(2, '0');
    }

    // Sanity check: jaartal moet in een redelijke range liggen.
    // Voorkomt corrupte data zoals jaar=17381 (PO-nummer per ongeluk als datum gelezen).
    var yearNum = parseInt(dateStr.substring(0, 4), 10);
    if (yearNum < 2020 || yearNum > 2035) {
      console.warn('PO deliveries: skipping row with invalid date year ' + yearNum + ' (po=' + po + ', item=' + item + ', raw=' + JSON.stringify(dateVal) + ')');
      skipped++;
      continue;
    }

    rows.push({
      po_number: po,
      item_number: item,
      item_description: descKey ? String(row[descKey] || '').trim() : '',
      date_expected: dateStr,
      qty_expected: qty,
    });
  }

  console.log('PO deliveries: ' + rows.length + ' valid rows, ' + skipped + ' skipped');

  if (rows.length === 0) {
    return { table: 'po_deliveries', rows_imported: 0 };
  }

  // TRUNCATE: oude data wegvegen want PO's zijn een complete momentopname
  var delResult = await getSupabase().from('po_deliveries').delete({ count: 'exact' }).not('id', 'is', null);
  if (delResult.error) {
    console.error('PO deliveries delete error: ' + delResult.error.message);
    throw new Error('PO deliveries delete failed: ' + delResult.error.message);
  }
  console.log('PO deliveries: deleted ' + (delResult.count || 0) + ' existing rows');

  // Insert in chunks van 1000 (Supabase limit)
  var totalInserted = 0;
  var chunkSize = 1000;
  for (var c = 0; c < rows.length; c += chunkSize) {
    var chunk = rows.slice(c, c + chunkSize);
    var res = await getSupabase().from('po_deliveries').insert(chunk);
    if (res.error) {
      console.error('PO deliveries insert error at chunk ' + c + ': ' + res.error.message);
      throw new Error('PO deliveries insert failed: ' + res.error.message);
    }
    totalInserted += chunk.length;
  }

  console.log('PO deliveries: imported ' + totalInserted + ' rows');

  return { table: 'po_deliveries', rows_imported: totalInserted };
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
      result = await processBuying(json, filename);
    } else if (fileType === 'negative_inventory') {
      result = await processNegativeInventory(json);
    } else if (fileType === 'sales') {
      result = await processSales(json, batchId);
    } else if (fileType === 'price_changes') {
      result = await processPriceChanges(json);
    } else if (fileType === 'po_deliveries') {
      result = await processPoDeliveries(json);
    } else {
      console.error('Unknown file type. Columns: ' + columns.join(', '));
      return Response.json({ 
        error: 'Onbekend bestandstype. Kolommen: ' + columns.slice(0, 5).join(', '),
        columns: columns 
      }, { status: 400 });
    }

    // Log the upload
    try {
      await getSupabase().from('upload_log').insert({
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