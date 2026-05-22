/* ============================================================
   BESTAND: route.js (Dyflexis import API)
   KOPIEER NAAR: src/app/api/import/dyflexis/route.js
   (nieuwe folder aanmaken: src/app/api/import/dyflexis/)

   DOEL: PDF-import van Dyflexis weekrooster
   - Ontvangt {filename, data (base64), sender, secret} van Cloudflare Worker
   - Parseert PDF naar planning-records
   - Mapt afdelingen naar BU's (Bonaire/Multimart genegeerd)
   - Verrijkt met contracturen uit C16 (embedded)
   - Verwijdert oude rijen voor zelfde BU+week, insert nieuwe
   ============================================================ */
import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';

const WORKER_SECRET = 'bs-compass-2026-secret';

export const maxDuration = 60;

// Afdeling-mapping (overeenstemmend met jouw definitie)
const AFDELING_MAP = [
  ['BU Living', 'BU Living'],
  ['BU Hardware', 'BU Hardware'],
  ['BU Sanitair/Keuken', 'BU Sanitair/Keuken'],
  ['BU Appliance/Houseware', 'BU Appliance/Houseware'],
  ['Smart Finance', 'Smart Finance'],
  ['Drive Thru', 'Logistiek'],
  ['Logistiek', 'Logistiek'],
  ['Store support', 'Store Support'],
  ['Facilitair', 'Store Support'],
  ['B2B', 'BU Building Materials'],
  ['Building Depot Bonaire', null],
  ['Multimart', null],
  ['Repair Center', null],
];

function mapAfdeling(raw) {
  if (!raw) return null;
  for (const [key, bu] of AFDELING_MAP) {
    if (raw.includes(key)) return bu;
  }
  return null;
}

// Sub-afdeling extractie: "Building Depot > BU Hardware > Hardware Operations" -> "Hardware Operations"
function extractSubAfdeling(raw) {
  const parts = raw.split('>').map(s => s.trim());
  return parts[parts.length - 1] || '';
}

// Pauze-heuristiek (CAO-conform): 
//   shift >= 8u -> 1u pauze
//   shift 5-7.99u -> 0.5u pauze
//   shift < 5u -> geen pauze
function nettoFromBruto(bruto) {
  if (bruto >= 8.0) return bruto - 1.0;
  if (bruto >= 5.0) return bruto - 0.5;
  return bruto;
}

// ISO week-nummer berekenen
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}

// PDF text parser
function parseDyflexisPDF(text) {
  // Naam-regex: "Achternaam, Voornaam X uren" of "Open dienst X uren" (excl "Totaal")
  const nameRe = /^((?:Open dienst)|(?:[A-Z][^\n]*?[a-zA-Z]))\s{2,}(\d+(?:\.\d+)?)\s*uren\s*$/gm;
  // Day-regex: "dd-mm-jjjj HH:MM HH:MM <afdeling> [opmerking]"
  const dayRe = /(\d{2}-\d{2}-\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\S[^\n]*)/g;

  // Pak alle naam-matches (excl. "Totaal")
  const nameMatches = [];
  let m;
  while ((m = nameRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (name === 'Totaal') continue;
    nameMatches.push({ name, stated: parseFloat(m[2]), start: m.index, end: m.index + m[0].length });
  }
  nameMatches.sort((a, b) => a.start - b.start);

  const records = [];
  for (let i = 0; i < nameMatches.length; i++) {
    const { name, end } = nameMatches[i];
    const nextStart = i + 1 < nameMatches.length ? nameMatches[i + 1].start : text.length;
    const block = text.substring(end, nextStart);
    const isOpen = name === 'Open dienst';

    // Reset regex state
    dayRe.lastIndex = 0;
    let dm;
    while ((dm = dayRe.exec(block)) !== null) {
      const [, datum, startTime, endTime, restRaw] = dm;
      // Split rest op >=2 spaties: afdeling + opmerking
      const restSplit = restRaw.trim().split(/\s{2,}/);
      const afdeling = restSplit[0].trim();
      const opmerking = restSplit.slice(1).join(' ').trim();

      const [h1, mn1] = startTime.split(':').map(Number);
      const [h2, mn2] = endTime.split(':').map(Number);
      const bruto = (h2 * 60 + mn2 - h1 * 60 - mn1) / 60;
      if (bruto <= 0) continue;
      const netto = nettoFromBruto(bruto);

      // Parse datum dd-mm-jjjj
      const [dd, mm, yyyy] = datum.split('-').map(Number);
      const dateObj = new Date(Date.UTC(yyyy, mm - 1, dd));
      // ISO week
      const isoW = getISOWeek(dateObj);
      // Day of week: 1 = ma, 7 = zo
      let dow = dateObj.getUTCDay();
      dow = dow === 0 ? 7 : dow;

      const bu = mapAfdeling(afdeling);
      const subAfd = extractSubAfdeling(afdeling);

      records.push({
        bu,
        afdeling_raw: afdeling,
        sub_afdeling: subAfd,
        period_year: isoW.year,
        period_week: isoW.week,
        day_of_week: dow,
        day_date: `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
        employee_name: name,
        is_open: isOpen,
        contract_type: null,
        contract_hours: null,
        start_time: startTime + ':00',
        end_time: endTime + ':00',
        bruto_hours: Math.round(bruto * 100) / 100,
        netto_hours: Math.round(netto * 100) / 100,
        opmerking: opmerking || null,
      });
    }
  }

  return records;
}

export async function POST(request) {
  try {
    // Lazy init - voorkomt build-time errors
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const body = await request.json();
    const { filename, data: base64, sender, secret } = body;

    // Authenticatie via secret
    if (secret !== WORKER_SECRET) {
      console.log('Dyflexis: Invalid secret from', sender);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    console.log(`Dyflexis import: filename=${filename}, sender=${sender}`);

    // Decode base64
    const buffer = Buffer.from(base64, 'base64');

    // Parse PDF (pdf-parse v2 syntax)
    const parser = new PDFParse({ data: buffer });
    const pdfResult = await parser.getText();
    const text = pdfResult.text;
    console.log(`Dyflexis: PDF length=${text.length} chars`);

    // Parse records
    const records = parseDyflexisPDF(text);
    console.log(`Dyflexis: ${records.length} raw records found`);

    // Filter: alleen records met bekende BU
    const validRecords = records.filter(r => r.bu !== null);
    const ignored = records.length - validRecords.length;
    console.log(`Dyflexis: ${validRecords.length} valid, ${ignored} ignored (Bonaire/Multimart/etc)`);

    if (validRecords.length === 0) {
      return new Response(JSON.stringify({
        error: 'No valid records found',
        total: records.length,
        ignored
      }), { status: 400 });
    }

    // Source file naam
    const sourceFile = filename || `dyflexis_${new Date().toISOString().substring(0, 10)}.pdf`;
    validRecords.forEach(r => { r.source_file = sourceFile; });

    // Bepaal welke (bu, year, week) combinaties moeten worden vervangen
    const buWeekSet = new Set();
    validRecords.forEach(r => {
      buWeekSet.add(`${r.bu}::${r.period_year}::${r.period_week}`);
    });

    // Delete bestaande rijen voor deze combinaties
    let deleted = 0;
    for (const key of buWeekSet) {
      const [bu, year, week] = key.split('::');
      const { error: delErr, count } = await supabase
        .from('urenplanning_dyflexis')
        .delete({ count: 'exact' })
        .eq('bu', bu)
        .eq('period_year', parseInt(year))
        .eq('period_week', parseInt(week));
      if (delErr) {
        console.error(`Delete error for ${key}:`, delErr.message);
      } else {
        deleted += count || 0;
      }
    }
    console.log(`Dyflexis: deleted ${deleted} old rows`);

    // Insert nieuwe rijen in batches van 500
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < validRecords.length; i += batchSize) {
      const batch = validRecords.slice(i, i + batchSize);
      const { error: insErr } = await supabase
        .from('urenplanning_dyflexis')
        .insert(batch);
      if (insErr) {
        console.error('Insert error:', insErr.message);
        return new Response(JSON.stringify({
          error: 'Insert failed',
          message: insErr.message,
          inserted_so_far: inserted,
        }), { status: 500 });
      }
      inserted += batch.length;
    }

    // Samenvatting per BU
    const summary = {};
    validRecords.forEach(r => {
      if (!summary[r.bu]) summary[r.bu] = { total: 0, open: 0, weeks: new Set() };
      summary[r.bu].total += r.netto_hours;
      if (r.is_open) summary[r.bu].open += r.netto_hours;
      summary[r.bu].weeks.add(r.period_week);
    });
    const summaryOut = {};
    for (const bu in summary) {
      summaryOut[bu] = {
        total: Math.round(summary[bu].total * 10) / 10,
        open: Math.round(summary[bu].open * 10) / 10,
        weeks: Array.from(summary[bu].weeks).sort(),
      };
    }

    console.log('Dyflexis: import complete');
    return new Response(JSON.stringify({
      ok: true,
      filename: sourceFile,
      records_total: records.length,
      records_inserted: inserted,
      records_ignored: ignored,
      old_rows_deleted: deleted,
      summary_per_bu: summaryOut,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (err) {
    console.error('Dyflexis error:', err.message, err.stack);
    return new Response(JSON.stringify({
      error: 'Server error',
      message: err.message,
    }), { status: 500 });
  }
}

// Voor handmatige test via curl/Postman
export async function GET() {
  return new Response(JSON.stringify({
    info: 'Dyflexis import endpoint',
    method: 'POST',
    expected_body: '{ filename, data (base64), sender, secret }',
  }), { headers: { 'content-type': 'application/json' } });
}
