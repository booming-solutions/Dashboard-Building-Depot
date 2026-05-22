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
import { extractText, getDocumentProxy } from 'unpdf';

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

// Helper: vind naam direct voor een "X uren " marker
function findNameBefore(text, idx) {
  const windowStart = Math.max(0, idx - 200);
  const windowText = text.substring(windowStart, idx);

  // Check Open dienst eerst
  const openIdx = windowText.lastIndexOf('Open dienst');
  if (openIdx >= 0) {
    const after = windowText.substring(openIdx + 'Open dienst'.length);
    if (/^\s*$/.test(after)) return 'Open dienst';
  }

  // Match "Achternaam, Voornaam" (eventueel met tussenvoegsels via meerdere komma's)
  const nameRe = /([A-Z][a-zA-Z\-]*(?:\s*[a-z]+)?,(?:\s*[A-Z][a-zA-Z\-]*\,?)*(?:\s+[A-Z][a-zA-Z\-]+)+)\s*$/;
  const match = windowText.match(nameRe);
  if (match) return match[1].trim();

  // Fallback - simpel patroon
  const simpleRe = /([A-Z][a-zA-Z][^\d\n]*?,\s*[^,\n\d]+?[a-zA-Z])\s*$/;
  const m2 = windowText.match(simpleRe);
  if (m2) {
    let name = m2[1].trim();
    const headerStrip = 'Datum Start Eind Afdeling Opmerking';
    const hi = name.lastIndexOf(headerStrip);
    if (hi >= 0) name = name.substring(hi + headerStrip.length).trim();
    return name;
  }
  return null;
}

// PDF text parser (unpdf single-line versie)
function parseDyflexisPDF(text) {
  // Vind alle "X uren " markers
  const urenRe = /(\d+(?:\.\d+)?)\s+uren\s+/g;
  const markers = [];
  let m;
  while ((m = urenRe.exec(text)) !== null) {
    markers.push({
      stated: parseFloat(m[1]),
      statedStart: m.index,
      statedEnd: m.index + m[0].length,
    });
  }

  const records = [];
  for (let i = 0; i < markers.length; i++) {
    const naam = findNameBefore(text, markers[i].statedStart);
    if (!naam || naam === 'Totaal') continue;
    const isOpen = naam === 'Open dienst';

    // Block met day-records
    const blockStart = markers[i].statedEnd;
    const blockEnd = i + 1 < markers.length ? markers[i + 1].statedStart : text.length;
    const block = text.substring(blockStart, blockEnd);

    // Day records: dd-mm-jjjj HH:MM HH:MM <afdeling-en-opmerking-tot-volgende-datum-of-einde>
    const dayRe = /(\d{2}-\d{2}-\d{4})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(.+?)(?=\s+\d{2}-\d{2}-\d{4}|\s*$)/g;
    let dm;
    while ((dm = dayRe.exec(block)) !== null) {
      const [, datum, startTime, endTime, restRaw] = dm;

      // Parse rest: afdeling = "Building Depot > ..." of "Multimart ..." of "Repair Center ..."
      // Opmerking = rest die niet bij afdeling-keten hoort
      // Heuristiek: afdeling stopt bij de eerste woordovergang naar opmerking-tekst (geen ">")
      // Voor onze mapping is alleen het BEGIN belangrijk (voor mapAfdeling), opmerking kan rest zijn
      let afdeling = restRaw.trim();
      let opmerking = '';

      const [h1, mn1] = startTime.split(':').map(Number);
      const [h2, mn2] = endTime.split(':').map(Number);
      const bruto = (h2 * 60 + mn2 - h1 * 60 - mn1) / 60;
      if (bruto <= 0) continue;
      const netto = nettoFromBruto(bruto);

      const [dd, mm, yyyy] = datum.split('-').map(Number);
      const dateObj = new Date(Date.UTC(yyyy, mm - 1, dd));
      const isoW = getISOWeek(dateObj);
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
        employee_name: naam,
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

    // Parse PDF met unpdf (serverless-vriendelijk)
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text: pdfText, totalPages } = await extractText(pdf, { mergePages: true });
    const text = pdfText;
    console.log(`Dyflexis: PDF ${totalPages} pages, ${text.length} chars`);

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
