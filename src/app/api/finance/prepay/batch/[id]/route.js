/* ============================================================
   BESTAND: route.js  (Vooruitbetalingen — batch ophalen door de Bridge)
   KOPIEER NAAR: src/app/api/finance/prepay/batch/[id]/route.js   (NIEUW)

   De Eagle Bridge haalt hier de batch op die hij moet boeken.
   Beveiligd met het batch-token dat bij het aanmaken is uitgegeven
   (query ?t=<token>). Geen dashboard-login nodig op de PC.

   Antwoord: { ok, id, batchId, status, payload, regels:[{rij,status,voucher}] }
   ============================================================ */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export async function GET(req, { params }) {
  const id = params?.id;
  const token = new URL(req.url).searchParams.get('t') || req.headers.get('x-batch-token') || '';
  if (!id || !token) return NextResponse.json({ ok: false, error: 'id of token ontbreekt' }, { status: 400 });

  const db = admin();
  const { data: b, error } = await db
    .from('eagle_prepay_batches')
    .select('id, batch_id, token, status, payload, store, entiteit, entiteit_naam, voucher_date, created_by, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!b || b.token !== token) return NextResponse.json({ ok: false, error: 'batch niet gevonden of token onjuist' }, { status: 404 });

  const { data: rows } = await db
    .from('eagle_prepay_rows')
    .select('rij, status, voucher, reden')
    .eq('batch_uuid', id)
    .order('rij');

  return NextResponse.json({
    ok: true,
    id: b.id,
    batchId: b.batch_id,
    status: b.status,
    store: b.store,
    createdBy: b.created_by,
    createdAt: b.created_at,
    payload: b.payload,
    regels: rows || [],
  });
}
