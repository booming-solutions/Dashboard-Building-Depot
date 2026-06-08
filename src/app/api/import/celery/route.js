/* ============================================================
   BESTAND: celery-route.js
   KOPIEER NAAR: src/app/api/import/celery/route.js
   VERSIE: v1

   DOEL: Parse C4 Loonjournaalpost OF C16 Werknemerslijst CSV
   uit Celery en sla op in respectievelijk:
   - payroll_journal (C4)
   - employee_snapshots (C16)
   
   Auto-detect: type wordt bepaald op basis van eerste header-rij.
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================================
// Mapping Celery afdeling → nieuwe BU-structuur
// ============================================================
const CELERY_BU_MAP = {
  // Nieuwe BU-codes met "Business Unit" voorvoegsel
  'TRANS19 - Appliances & living': 'BU Appliance/Houseware',
  'TRANS21 - Business Unit Living': 'BU Living',
  'TRANS22 - Business Unit Hardware': 'BU Hardware',
  'TRANS24 - Business Unit Sanitair': 'BU Sanitair/Keuken',
  'TRANS18 - Business Unit Kitchen, Sanitair & Flooring': 'BU Sanitair/Keuken',
  'TRANS25 - Business Unit Support': 'Store Support',
  // Oude winkel-afdelingen
  'HH - Winkel HH': 'BU Appliance/Houseware',
  'HH 1ste - Winkel HH 1STE': 'BU Living',
  'HW - Winkel HW': 'BU Hardware',
  // Buitendienst = Building Materials accountmanagers
  'BD - Buitendienst': 'BU Building Materials',
  // Store Support afdelingen
  'CS - Customer Services': 'Store Support',
  'Store Sup - Store Support': 'Store Support',
  'BW - Bewaking': 'Store Support',
  'KASSA - kassa': 'Store Support',
  'SCH - Schoonmaak': 'Store Support',
  // Logistiek
  'DT - Drive Thru': 'Logistiek',
  'TM ZEE - Transit en Magazijn Zeelandia': 'Logistiek',
  'TRANS10 - Magazijn Brievengat': 'Logistiek',
  // Kantoor
  'FIN ADM - Financieel Administratie': 'BU Kantoor',
  'HR - Human Resource': 'BU Kantoor',
  'INK - Inkoop': 'BU Kantoor',
  'MAR - Marketing': 'BU Kantoor',
  'TRANS16 - IT': 'BU Kantoor',
};

// Per-medewerker overrides (uitzonderingen) - personeelsnummer als string
const EMPLOYEE_BU_OVERRIDES = {
  // Rudelly Mauricia (Buyer, zit in TRANS19 maar werkt voor kantoor)
  // We zoeken op personeelsnummer - die moet je in C16 opzoeken
  // Voor nu: identifier via volledige naam
};
const EMPLOYEE_NAME_BU_OVERRIDES = {
  'rudelly mauricia': 'BU Kantoor',  // Buyer, valt onder kantoor
};

function mapBU(afdelingRaw) {
  return CELERY_BU_MAP[afdelingRaw] || null;
}

// Skip dummy/proforma medewerkers
function isSkipDepartment(afdelingRaw) {
  return afdelingRaw === 'TRANS17 - Proforma';
}

// ============================================================
// Categorisering van looncodes
// ============================================================
function categorize(omschrijving) {
  if (!omschrijving) return 'overig';
  const o = omschrijving.toLowerCase();
  if (o.includes('bruto salaris')) return 'bruto';
  if (o.includes('overuren') || o.includes('overwerk')) return 'overwerk';
  if (o.includes('vakantiegeld') || o.includes('vakantiedag')) return 'vakantiegeld';
  if (o.includes('pensioen')) return 'pensioen';
  if (o.includes('aov') || o.includes('aww') || o.includes('avbz') || o.includes('bvz') ||
      o.includes('svb') || o.includes('loonbelasting') || o.includes('werkgeverspremie') ||
      o.includes('premie')) return 'sociale_premies';
  if (o.includes('toeslag') || o.includes('toelage') || o.includes('vergoeding') ||
      o.includes('representatie')) return 'toeslagen';
  if (o.includes('ziekengeld') || o.includes('ziekte')) return 'ziekengeld';
  if (o.includes('voorschot') || o.includes('lening')) return 'voorschotten';
  return 'overig';
}

// ============================================================
// CSV parser (handelt quoted strings, commas in fields, etc.)
// ============================================================
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        fields.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    rows.push(fields);
  }
  return rows;
}

// Convert numeric strings (Dutch format) to numbers
function num(s) {
  if (s === null || s === undefined || s === '') return 0;
  if (typeof s === 'number') return s;
  // Dutch format: "1.234,56" or "1234,56"
  const cleaned = String(s).replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Parse Dutch period text from C4 header: "van 1 mei 2026 t/m 31 mei 2026"
function parsePeriodHeader(text) {
  if (!text) return null;
  const monthMap = {
    'januari': 1, 'februari': 2, 'maart': 3, 'april': 4, 'mei': 5, 'juni': 6,
    'juli': 7, 'augustus': 8, 'september': 9, 'oktober': 10, 'november': 11, 'december': 12,
  };
  const m = text.toLowerCase().match(/van\s+\d+\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const month = monthMap[m[1]];
  const year = parseInt(m[2]);
  if (!month || !year) return null;
  return { year, month };
}

// Parse Dutch date "DD/MM/YYYY" to ISO YYYY-MM-DD
function parseDate(s) {
  if (!s || s === '') return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }
  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return null;
}

// ============================================================
// Detect file type: C4 or C16
// ============================================================
function detectType(rows) {
  if (rows.length < 2) return null;
  const header = rows[1];
  if (!header) return null;
  const hStr = header.join('|').toLowerCase();
  if (hStr.includes('looncode') && hStr.includes('debet') && hStr.includes('credit')) return 'c4';
  if (hStr.includes('personeelsnummer') && hStr.includes('deeltijdpercentage')) return 'c16';
  // Older C4 format with 'Code', 'Subcode'
  if (hStr.includes('code') && hStr.includes('subcode') && hStr.includes('debet')) return 'c4_old';
  return null;
}

// ============================================================
// Parse C4 (nieuwe format met Hoofdafdeling)
// ============================================================
function parseC4(rows, filename) {
  // Rij 0: company + periode "van X t/m Y"
  // Rij 1: kolom-headers
  // Rij 2+: data
  const headerLine = rows[0]?.join(' ') || '';
  const period = parsePeriodHeader(headerLine);
  if (!period) throw new Error(`Kan periode niet detecteren uit header: ${headerLine}`);

  const headers = rows[1].map(h => h.trim());
  const idx = {
    looncode: headers.indexOf('Looncode'),
    omschrijving: headers.indexOf('Omschrijving'),
    uren: headers.indexOf('Uren'),
    valuta: headers.indexOf('Valuta'),
    debet: headers.indexOf('Debet'),
    credit: headers.indexOf('Credit'),
    hoofdafdeling: headers.indexOf('Hoofdafdeling'),
    afdeling: headers.indexOf('Afdeling'),
  };
  // Fallback voor oude format (Code/Subcode i.p.v. Looncode)
  if (idx.looncode < 0) idx.looncode = headers.indexOf('Code');

  const records = [];
  let skipped = 0;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 5) continue;
    const omsch = r[idx.omschrijving]?.trim();
    if (!omsch || omsch === 'Totalen' || omsch === '') { skipped++; continue; }

    const looncode = r[idx.looncode]?.trim() || '';
    const hoofd = idx.hoofdafdeling >= 0 ? r[idx.hoofdafdeling]?.trim() : '';
    if (!hoofd) { skipped++; continue; }
    if (isSkipDepartment(hoofd)) { skipped++; continue; }

    const bu = mapBU(hoofd);
    if (!bu) { skipped++; console.warn(`Onbekende afdeling: ${hoofd}`); continue; }

    const debet = num(r[idx.debet]);
    const credit = num(r[idx.credit]);
    const uren = idx.uren >= 0 ? num(r[idx.uren]) : 0;
    // Bedrag = debet - credit (kostenposten staan in debet, mutaties in credit zijn negatief)
    const bedrag = debet - credit;
    if (bedrag === 0 && uren === 0) { skipped++; continue; }

    records.push({
      period_year: period.year,
      period_month: period.month,
      looncode,
      omschrijving: omsch,
      uren: uren || null,
      valuta: idx.valuta >= 0 ? (r[idx.valuta]?.trim() || 'XCG') : 'XCG',
      debet,
      credit,
      bedrag,
      hoofdafdeling: hoofd,
      sub_afdeling: idx.afdeling >= 0 ? (r[idx.afdeling]?.trim() || null) : null,
      bu,
      categorie: categorize(omsch),
      source_file: filename || `c4_${period.year}_${period.month}.csv`,
    });
  }
  return { type: 'c4', period, records, skipped };
}

// ============================================================
// Parse C16 (Werknemerslijst)
// ============================================================
function parseC16(rows, filename, snapshotDate) {
  // Rij 0: company info
  // Rij 1: kolom-headers (72 kolommen)
  // Rij 2+: data
  const headers = rows[1].map(h => h.trim());
  const idx = {};
  ['Personeelsnummer','Voornaam','Tussenvoegsel','Achternaam','Geslacht',
   'Geboortedatum','Functie','Afdeling','Datum in dienst','Uit dienst',
   'Werknemeraccount','Betaalschema','Salaris','Standaard werkweek',
   'Uren per dag','Deeltijdpercentage'].forEach(k => {
    idx[k] = headers.indexOf(k);
  });

  if (idx['Personeelsnummer'] < 0) throw new Error('C16 mist Personeelsnummer kolom');

  const records = [];
  let skipped = 0;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 10) continue;
    const pnr = r[idx['Personeelsnummer']]?.trim();
    if (!pnr || pnr === '') { skipped++; continue; }

    const afdeling = r[idx['Afdeling']]?.trim() || '';
    if (!afdeling) { skipped++; continue; }
    if (isSkipDepartment(afdeling)) { skipped++; continue; }

    const voornaam = r[idx['Voornaam']]?.trim() || '';
    const tussen = r[idx['Tussenvoegsel']]?.trim() || '';
    const achter = r[idx['Achternaam']]?.trim() || '';
    const volledigeNaam = [voornaam, tussen, achter].filter(s => s && s !== 'nan').join(' ');

    // Determine BU - with name-based overrides first
    const nameKey = volledigeNaam.toLowerCase().replace(/\s+/g, ' ').trim();
    let bu = EMPLOYEE_NAME_BU_OVERRIDES[nameKey] || mapBU(afdeling);
    if (!bu) { skipped++; console.warn(`Onbekende afdeling: ${afdeling} (${volledigeNaam})`); continue; }

    const dtPct = num(r[idx['Deeltijdpercentage']]) || 100;
    const fte = dtPct / 100;

    records.push({
      snapshot_date: snapshotDate,
      personeelsnummer: pnr,
      voornaam,
      tussenvoegsel: tussen || null,
      achternaam: achter,
      volledige_naam: volledigeNaam,
      geslacht: r[idx['Geslacht']]?.trim() || null,
      geboortedatum: parseDate(r[idx['Geboortedatum']]),
      functie: r[idx['Functie']]?.trim() || null,
      afdeling_raw: afdeling,
      bu,
      in_dienst: parseDate(r[idx['Datum in dienst']]),
      uit_dienst: parseDate(r[idx['Uit dienst']]),
      status: r[idx['Werknemeraccount']]?.trim() || null,
      betaalschema: r[idx['Betaalschema']]?.trim() || null,
      salaris: idx['Salaris'] >= 0 ? num(r[idx['Salaris']]) : null,
      dt_pct: dtPct,
      fte,
      std_werkweek: idx['Standaard werkweek'] >= 0 ? num(r[idx['Standaard werkweek']]) : null,
      uren_pd: idx['Uren per dag'] >= 0 ? num(r[idx['Uren per dag']]) : null,
      source_file: filename || `c16_${snapshotDate}.csv`,
    });
  }
  return { type: 'c16', records, skipped, snapshot_date: snapshotDate };
}

// ============================================================
// POST handler
// ============================================================
export async function POST(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Supabase config missing' }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const snapshotDateOverride = formData.get('snapshot_date'); // optional, voor C16

    if (!file) {
      return new Response(JSON.stringify({ error: 'Geen bestand ontvangen' }), { status: 400 });
    }

    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 3) {
      return new Response(JSON.stringify({ error: 'CSV is leeg of onvolledig' }), { status: 400 });
    }

    const type = detectType(rows);
    if (!type) {
      return new Response(JSON.stringify({
        error: 'Bestandstype niet herkend. Verwacht C4 Loonjournaalpost of C16 Werknemerslijst CSV uit Celery.',
        firstHeader: rows[1]?.slice(0, 8),
      }), { status: 400 });
    }

    if (type === 'c4' || type === 'c4_old') {
      const result = parseC4(rows, file.name);
      // Verwijder bestaande data voor deze periode
      const { error: delErr } = await supabase
        .from('payroll_journal')
        .delete()
        .eq('period_year', result.period.year)
        .eq('period_month', result.period.month);
      if (delErr) console.error('Delete error:', delErr);

      // Insert in batches
      const BATCH = 500;
      let inserted = 0;
      for (let i = 0; i < result.records.length; i += BATCH) {
        const batch = result.records.slice(i, i + BATCH);
        const { error } = await supabase.from('payroll_journal').insert(batch);
        if (error) {
          return new Response(JSON.stringify({
            error: 'Insert error',
            details: error.message,
            inserted_before_error: inserted,
          }), { status: 500 });
        }
        inserted += batch.length;
      }

      return new Response(JSON.stringify({
        success: true,
        type: 'c4',
        period: `${result.period.year}-${String(result.period.month).padStart(2,'0')}`,
        records: result.records.length,
        inserted,
        skipped: result.skipped,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (type === 'c16') {
      // Bepaal snapshot_date: gebruik override of einde huidige maand
      let snapDate = snapshotDateOverride;
      if (!snapDate) {
        // Default: einde van de laatste maand (gisteren als peildatum)
        const today = new Date();
        const lastDayLastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
        snapDate = lastDayLastMonth.toISOString().substring(0, 10);
      }

      const result = parseC16(rows, file.name, snapDate);

      // Verwijder bestaande snapshot voor deze datum
      const { error: delErr } = await supabase
        .from('employee_snapshots')
        .delete()
        .eq('snapshot_date', snapDate);
      if (delErr) console.error('Delete error:', delErr);

      const BATCH = 500;
      let inserted = 0;
      for (let i = 0; i < result.records.length; i += BATCH) {
        const batch = result.records.slice(i, i + BATCH);
        const { error } = await supabase.from('employee_snapshots').insert(batch);
        if (error) {
          return new Response(JSON.stringify({
            error: 'Insert error',
            details: error.message,
            inserted_before_error: inserted,
          }), { status: 500 });
        }
        inserted += batch.length;
      }

      return new Response(JSON.stringify({
        success: true,
        type: 'c16',
        snapshot_date: snapDate,
        records: result.records.length,
        inserted,
        skipped: result.skipped,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

  } catch (err) {
    console.error('Celery import error:', err);
    return new Response(JSON.stringify({
      error: 'Parse error',
      details: err.message,
      stack: err.stack?.split('\n').slice(0, 5).join('\n'),
    }), { status: 500 });
  }
}
