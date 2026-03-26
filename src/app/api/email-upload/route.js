import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const maxDuration = 60;

export async function POST(request) {
  try {
    // Verify the request comes from our Worker
    const secret = request.headers.get('X-Worker-Secret');
    if (secret !== process.env.WORKER_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filename, data, sender } = await request.json();

    if (!data || !filename) {
      return Response.json({ error: 'Missing data or filename' }, { status: 400 });
    }

    console.log(`Processing email attachment: ${filename} from ${sender}`);

    // Decode base64 to binary
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Parse Excel
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);

    console.log(`Parsed ${json.length} rows`);

    // Map rows to sales_data format
    const batchId = crypto.randomUUID();
    const rows = json.map(row => {
      const keys = Object.keys(row);
      const find = (patterns) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p)));

      let dateVal = row[find(['date'])];
      if (dateVal instanceof Date) {
        dateVal = dateVal.toISOString().split('T')[0];
      } else if (typeof dateVal === 'number') {
        dateVal = new Date((dateVal - 25569) * 86400000).toISOString().split('T')[0];
      } else if (typeof dateVal === 'string') {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) dateVal = d.toISOString().split('T')[0];
      }

      const gmPctKey = keys.find(k =>
        (k.toLowerCase().includes('gross margin') && k.toLowerCase().includes('%')) ||
        k.toLowerCase() === 'gm%'
      );
      const gmKey = keys.find(k =>
        k.toLowerCase().includes('gross margin') && !k.toLowerCase().includes('%')
      );

      let gmPct = parseFloat(row[gmPctKey]) || 0;
      if (Math.abs(gmPct) > 999) gmPct = Math.max(Math.min(gmPct, 999.99), -999.99);

      return {
        bum: String(row[find(['bum'])] || ''),
        sale_date: dateVal,
        store_number: String(row[find(['store'])] || ''),
        dept_code: String(row[find(['department code', 'dept_code'])] || ''),
        dept_name: String(row[find(['department name', 'dept_name'])] || ''),
        net_sales: parseFloat(row[find(['net sales', 'net_sales'])]) || 0,
        gross_margin: parseFloat(row[gmKey]) || 0,
        gm_percentage: gmPct,
        upload_batch: batchId,
      };
    }).filter(r => r.bum && r.sale_date && r.dept_code);

    console.log(`Valid rows: ${rows.length}`);

    // Smart replace: find unique dates in the new data and delete them first
    const uniqueDates = [...new Set(rows.map(r => r.sale_date))].filter(Boolean);
    console.log(`Dates in file: ${uniqueDates.join(', ')}`);

    if (uniqueDates.length > 0) {
      const { error: deleteError, count } = await supabase
        .from('sales_data')
        .delete({ count: 'exact' })
        .in('sale_date', uniqueDates);

      if (deleteError) {
        console.error(`Delete error: ${deleteError.message}`);
      } else {
        console.log(`Deleted ${count || 0} existing rows for dates: ${uniqueDates.join(', ')}`);
      }
    }

    // Insert new data in batches of 500
    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase.from('sales_data').insert(batch);
      if (error) {
        console.error(`Batch error at ${i}: ${error.message}`);
        continue;
      }
      totalInserted += batch.length;
    }

    // Log the upload
    await supabase.from('upload_log').insert({
      filename: `[email] ${filename}`,
      rows_imported: totalInserted,
      status: totalInserted > 0 ? 'success' : 'failed',
    });

    console.log(`Imported ${totalInserted} rows from ${filename}`);
    return Response.json({ success: true, rows_imported: totalInserted });

  } catch (err) {
    console.error('Email upload error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}