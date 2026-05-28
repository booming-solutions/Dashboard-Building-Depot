/* ============================================================
   BESTAND: route.js (Dyflexis Actuals import API)
   KOPIEER NAAR: src/app/api/import/dyflexis-actuals/route.js
   (nieuwe folder aanmaken)

   DOEL: CSV-import van Dyflexis "Realized hours" weekrapport
   - Ontvangt {filename, data (base64 of plaintext), week, year, secret}
   - Parseert CSV naar actual-records (één per medewerker per week)
   - Mapt afdelingen naar BU's (zelfde mapping als planning + extra archived/Kantoor)
   - Per-medewerker overrides voor archived afdelingen
   - Bonaire/Multimart/Repair Center genegeerd
   - Vervangt bestaande actual-rijen voor zelfde year+week
   ============================================================ */
import { createClient } from '@supabase/supabase-js';

const WORKER_SECRET = 'bs-compass-2026-secret';
export const maxDuration = 60;

// Afdeling pattern → BU mapping (volgorde belangrijk)
const AFDELING_PATTERNS = [
  ['BU Building Materials', 'BU Building Materials'],
  ['BU Living', 'BU Living'],
  ['BU Hardware', 'BU Hardware'],
  ['BU Sanitair/Keuken', 'BU Sanitair/Keuken'],
  ['BU Appliance/Houseware', 'BU Appliance/Houseware'],
  ['Smart Finance', 'Smart Finance'],
  ['Logistiek', 'Logistiek'],
  ['Drive Thru', 'Logistiek'],
  ['B2B', 'BU Building Materials'],
  ['Store Support Schoonmaak', 'Store Support'],
  ['Store support', 'Store Support'],
  ['Facilitair', 'Store Support'],
  ['Kantoor > Administratie', 'BU Kantoor'],
  ['Kantoor > HR', 'BU Kantoor'],
  ['Kantoor > IT', 'BU Kantoor'],
  ['Kantoor > Inventory Controller', 'BU Kantoor'],
  ['Zeelandia > IT', 'BU Kantoor'],
  ['Zeelandia > Inventory Controller', 'BU Kantoor'],
  ['Zeelandia > Marketing', 'BU Kantoor'],
  ['Hardware (archived)', 'BU Hardware'],
  ['Verf (archived)', 'BU Hardware'],
  ['Bruin en Witgoed en Premium (archived)', 'BU Appliance/Houseware'],
  ['Household Beneden (archived)', 'BU Appliance/Houseware'],
  ['Household Boven A (archived)', 'BU Living'],
  ['Household Boven B (archived)', 'BU Living'],
  ['Keuken Depot (archived)', 'BU Sanitair/Keuken'],
  ['Host (archived)', 'Store Support'],
];

// Per-employee overrides voor archived/diverse afdelingen
// Mensen in: Inkoop (archived), Merchandise (archived), Parttimers (archived),
//            Store Management (archived) krijgen forced BU op basis van naam
const EMPLOYEE_OVERRIDES = {
  // Expliciete keuzes Jeroen
  'John van den Berg': 'Logistiek',
  'John Candelaria': 'BU Hardware',
  'Enoc Merkies': 'BU Sanitair/Keuken',
  'Roberto Badaracco': 'BU Living',
  'Ricardo Pierre': 'Logistiek',
  'Zuneida Alvarez': 'Store Support',
  'Curtney Cicilia': 'Logistiek',
  'Eliana Dangond Pabon': 'BU Hardware',
  'Eliana  Dangond Pabon': 'BU Hardware',
  'Jamira Webster': 'BU Sanitair/Keuken',
  'Jonathan de Wolff': 'BU Kantoor',
  'Niasotis Dandare Ellis': 'BU Building Materials',
  'Lativa Pieters': 'Logistiek',
  'Lativa  Pieters': 'Logistiek',
  'Omar Requena': 'BU Kantoor',
  // Auto-derived uit huidige (week 12+) BU's
  'Daniel Louman': 'BU Appliance/Houseware',
  'Dianne Meyer - Walle': 'BU Living',
  'Dianni Colon': 'BU Living',
  'Gijs Verkuijl': 'BU Living',
  'Ingerson Carmela': 'BU Living',
  'Ivo Proveniers': 'BU Sanitair/Keuken',
  'Jair Mattheeuw': 'BU Living',
  'Jhonny Garves': 'BU Hardware',
  'Keith Taylor': 'BU Hardware',
  'Kevin Djotaroeno': 'BU Appliance/Houseware',
  'Michelangelo Lourens': 'BU Appliance/Houseware',
  'Nareelis Jakoba': 'BU Living',
  'Noudimar Dorothea': 'BU Hardware',
  'Qiyazir Lake': 'BU Living',
  'Raymi-Engelo Regina': 'BU Hardware',
  'Rishantely Jantje': 'BU Hardware',
  'Tercy Stewart': 'BU Hardware',
  'Tyshawn  Angela': 'BU Hardware',
};

const IGNORE_LOCATIONS = ['Bonaire', 'Multimart', 'Repair Center'];
const PER_EMPLOYEE_DEPTS = [
  'Inkoop (archived)', 'Merchandise (archived)',
  'Parttimers', 'Store Management (archived)'
];

function mapBU(empName, dept, location) {
  if (location && IGNORE_LOCATIONS.some(ig => location.includes(ig))) return null;
  if (!dept) return null;
  if (IGNORE_LOCATIONS.some(ig => dept.includes(ig))) return null;
  // Per-employee override-afdelingen
  if (PER_EMPLOYEE_DEPTS.some(p => dept.includes(p))) {
    return EMPLOYEE_OVERRIDES[empName] || null;
  }
  // Pattern matching
  for (const [pat, bu] of AFDELING_PATTERNS) {
    if (dept.includes(pat)) return bu;
  }
  return null;
}

// Extract sub-afdeling: laatste deel na ">"
function extractSubAfdeling(dept) {
  if (!dept) return null;
  const parts = dept.split('>').map(s => s.trim());
  return parts[parts.length - 1] || null;
}

// CSV parser: ondersteunt quoted velden met komma's
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(text) {
  // Strip BOM en CR
  text = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = text.split('\n');
  // Eerste 2 rijen zijn group-headers, rij 3 is de echte header
  if (lines.length < 4) return [];
  const header = parseCSVLine(lines[2]);
  const records = [];
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    if (fields.length < header.length) continue;
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = fields[j];
    }
    records.push(row);
  }
  return records;
}

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export async function POST(request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body = await request.json();
    const { filename, data: base64, csv: csvText, week, year, sender, secret } = body;

    if (secret !== WORKER_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    if (!week || !year) {
      return new Response(JSON.stringify({ error: 'week and year required' }), { status: 400 });
    }

    console.log(`Dyflexis-actuals import: filename=${filename}, week=${week}, year=${year}`);

    // Decode CSV (base64 of plain)
    let text = csvText;
    if (!text && base64) {
      text = Buffer.from(base64, 'base64').toString('utf-8');
    }
    if (!text) {
      return new Response(JSON.stringify({ error: 'No CSV data provided' }), { status: 400 });
    }

    const csvRecords = parseCSV(text);
    console.log(`Dyflexis-actuals: ${csvRecords.length} CSV rows`);

    // Filter: alleen rijen met Employee ingevuld, skip 'Totals' samenvattingsregel
    const empRecords = csvRecords.filter(r =>
      r.Employee && r.Employee.trim() !== '' && r.Employee.trim() !== 'Totals'
    );
    console.log(`Dyflexis-actuals: ${empRecords.length} employee rows`);

    // GROEPEER per medewerker — een medewerker heeft vaak MEERDERE rijen:
    //  - werk-rij(en) met dept ingevuld (Hours worked)
    //  - een rij met lege dept met verlof/ziekte/TVT
    // We sommeren ALLE uren-kolommen en pakken de eerste niet-lege dept als BU-bron.
    const byEmployee = new Map();
    for (const r of empRecords) {
      const empName = (r.Employee || '').trim();
      if (!byEmployee.has(empName)) {
        byEmployee.set(empName, { rows: [], dept: null, location: null, empNumber: null });
      }
      const g = byEmployee.get(empName);
      g.rows.push(r);
      const dept = (r.Departments || '').trim();
      if (dept && dept !== 'nan' && !g.dept) {
        g.dept = dept;
        g.location = (r.Location || '').trim();
      }
      if (!g.empNumber && (r['Employee number'] || '').trim()) {
        g.empNumber = (r['Employee number'] || '').trim();
      }
    }
    console.log(`Dyflexis-actuals: ${byEmployee.size} unieke medewerkers`);

    const records = [];
    let ignored = 0;
    let noDept = 0;

    for (const [empName, g] of byEmployee) {
      // Bepaal BU. Als geen dept-rij: probeer override (mensen volledig op verlof die week)
      let dept = g.dept;
      let location = g.location;
      let bu = null;
      if (dept) {
        bu = mapBU(empName, dept, location);
      } else {
        // Geen werk-rij — alleen verlof/ziek. Probeer override op naam.
        bu = EMPLOYEE_OVERRIDES[empName] || null;
        dept = '(alleen verlof/ziek)';
      }
      if (!bu) {
        if (!g.dept) noDept++;
        else ignored++;
        continue;
      }

      const subAfd = g.dept ? extractSubAfdeling(g.dept) : null;

      // Sommeer over ALLE rijen van deze medewerker
      let hours_worked = 0, total_hours = 0, leaveTotal = 0, sickTotal = 0;
      let overtimePaid = 0, overtimeTvt = 0, overtimeExtra = 0, tvtOpname = 0, noShow = 0, totalCost = 0;
      let sickPctMax = 0;
      for (const r of g.rows) {
        hours_worked += num(r['Hours worked']);
        total_hours += num(r['Total hours']);
        leaveTotal += num(r['Holiday hours']) + num(r['Paid leave']) +
          num(r['Maternity leave']) + num(r['Special leave']) +
          num(r['Unpaid leave']) + num(r['Public holiday']);
        sickTotal += num(r['Ziekte loonderving 80%']) + num(r['Ziekte zonder loonderving']) +
          num(r['Ziekte Bedrijfsongeval 100%']);
        overtimePaid += num(r['Overwerk 150% Uitb']) + num(r['Overuren uitbetalen']);
        overtimeTvt += num(r['Overwerk 150% TVT']) + num(r['Overwerk 200% TVT']) + num(r['Overwerk 100% TVT']);
        overtimeExtra += num(r['Roostervrije dag 200%']);
        tvtOpname += num(r['TVT Opname']);
        noShow += num(r['No Show']);
        totalCost += num(r['Total cost']);
        const sp = num(r['Sick percentage']);
        if (sp > sickPctMax) sickPctMax = sp;
      }
      const overtimeTotal = overtimePaid + overtimeTvt + overtimeExtra;
      // Ziekte % zelf berekenen indien total_hours > 0 (betrouwbaarder dan CSV-kolom over meerdere rijen)
      const sickPct = total_hours > 0 ? (sickTotal / total_hours * 100) : sickPctMax;

      records.push({
        bu,
        afdeling_raw: g.dept || null,
        sub_afdeling: subAfd,
        period_year: parseInt(year),
        period_week: parseInt(week),
        day_of_week: null,
        day_date: null,
        employee_name: empName,
        employee_number: g.empNumber || null,
        is_open: false,
        is_actual: true,
        contract_type: null,
        contract_hours: null,
        start_time: null,
        end_time: null,
        bruto_hours: null,
        netto_hours: null,
        opmerking: null,
        hours_worked: Math.round(hours_worked * 100) / 100,
        total_hours: Math.round(total_hours * 100) / 100,
        leave_total: Math.round(leaveTotal * 100) / 100,
        sick_total: Math.round(sickTotal * 100) / 100,
        overtime_total: Math.round(overtimeTotal * 100) / 100,
        overtime_paid: Math.round(overtimePaid * 100) / 100,
        overtime_tvt: Math.round(overtimeTvt * 100) / 100,
        tvt_opname: Math.round(tvtOpname * 100) / 100,
        no_show: Math.round(noShow * 100) / 100,
        total_cost: Math.round(totalCost * 100) / 100,
        sick_percentage: Math.round(sickPct * 100) / 100,
        source_file: filename || `actuals_wk${week}_${year}.csv`,
      });
    }

    console.log(`Dyflexis-actuals: ${records.length} mapped, ${ignored} ignored (BU), ${noDept} skipped (geen dept+geen override)`);
    const skippedNan = noDept;

    if (records.length === 0) {
      return new Response(JSON.stringify({
        error: 'No valid records',
        ignored, skipped_empty: skippedNan,
      }), { status: 400 });
    }

    // Delete bestaande actual-rijen voor deze week
    const { error: delErr, count: deleted } = await supabase
      .from('urenplanning_dyflexis')
      .delete({ count: 'exact' })
      .eq('is_actual', true)
      .eq('period_year', parseInt(year))
      .eq('period_week', parseInt(week));
    if (delErr) {
      console.error('Delete error:', delErr.message);
    }

    // Insert in batches
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('urenplanning_dyflexis')
        .insert(batch);
      if (error) {
        console.error('Insert error:', error.message);
        return new Response(JSON.stringify({
          error: 'Insert failed',
          message: error.message,
          inserted_so_far: inserted,
        }), { status: 500 });
      }
      inserted += batch.length;
    }

    // Samenvatting per BU
    const summary = {};
    records.forEach(r => {
      if (!summary[r.bu]) summary[r.bu] = {
        employees: 0, hours_worked: 0, leave: 0, sick: 0, overtime: 0,
      };
      summary[r.bu].employees++;
      summary[r.bu].hours_worked += r.hours_worked;
      summary[r.bu].leave += r.leave_total;
      summary[r.bu].sick += r.sick_total;
      summary[r.bu].overtime += r.overtime_total;
    });
    Object.keys(summary).forEach(bu => {
      summary[bu].hours_worked = Math.round(summary[bu].hours_worked * 10) / 10;
      summary[bu].leave = Math.round(summary[bu].leave * 10) / 10;
      summary[bu].sick = Math.round(summary[bu].sick * 10) / 10;
      summary[bu].overtime = Math.round(summary[bu].overtime * 10) / 10;
    });

    return new Response(JSON.stringify({
      ok: true, week, year, filename,
      records_total: csvRecords.length,
      records_inserted: inserted,
      records_ignored: ignored,
      records_skipped_empty: skippedNan,
      old_rows_deleted: deleted || 0,
      summary_per_bu: summary,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (err) {
    console.error('Dyflexis-actuals error:', err.message, err.stack);
    return new Response(JSON.stringify({
      error: 'Server error', message: err.message,
    }), { status: 500 });
  }
}

export async function GET() {
  return new Response(JSON.stringify({
    info: 'Dyflexis Actuals import endpoint',
    method: 'POST',
    expected_body: '{ filename, csv (or data base64), week, year, secret }',
  }), { headers: { 'content-type': 'application/json' } });
}
