import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { rows, filename, userId } = body;

    if (!rows || !rows.length) {
      return Response.json({ error: 'Geen data ontvangen' }, { status: 400 });
    }

    const batchId = crypto.randomUUID();

    // Prepare rows for insertion
    const salesRows = rows.map(r => ({
      bum: r.bum,
      sale_date: r.sale_date,
      store_number: r.store_number,
      dept_code: r.dept_code,
      dept_name: r.dept_name,
      net_sales: r.net_sales || 0,
      gross_margin: r.gross_margin || 0,
      gm_percentage: r.gm_percentage || 0,
      upload_batch: batchId,
    }));

    // Insert in batches of 500
    let totalInserted = 0;
    for (let i = 0; i < salesRows.length; i += 500) {
      const batch = salesRows.slice(i, i + 500);
      const { error } = await supabase.from('sales_data').insert(batch);
      if (error) {
        console.error('Insert error:', error);
        return Response.json({ error: `Fout bij rij ${i}: ${error.message}` }, { status: 500 });
      }
      totalInserted += batch.length;
    }

    // Log the upload
    await supabase.from('upload_log').insert({
      uploaded_by: userId,
      filename: filename,
      rows_imported: totalInserted,
      status: 'success',
    });

    return Response.json({ success: true, rows_imported: totalInserted, batch_id: batchId });
  } catch (err) {
    console.error('Upload error:', err);
    return Response.json({ error: 'Er ging iets mis bij het verwerken' }, { status: 500 });
  }
}
