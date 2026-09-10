/* ============================================================
   BESTAND: route.js  (Vooruitbetalingen — voortgang van de Bridge)
   KOPIEER NAAR: src/app/api/finance/prepay/batch/[id]/voortgang/route.js   (NIEUW)

   De Eagle Bridge meldt hier tijdens het boeken elke stap terug:
   logregels (events), de status per regel en de status van de batch.
   Het dashboard leest die tabellen en toont de voortgang live.

   Beveiligd met het batch-token (header x-batch-token of ?t=).

   Body (JSON), alle onderdelen optioneel:
   {
     batch:  { status, laatste_bericht, eagle_store, eagle_user, machine,
               bridge_versie, started, finished, geboekt, overgeslagen, fout },
     rows:   [ { rij, status, stap, voucher, reden } ],
     events: [ { rij, niveau, bericht, tijd } ]
   }
   ============================================================ */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_STATUS = new Set(['klaar', 'bezig', 'afgerond', 'gestopt']);
const ROW_STATUS = new Set(['wachten', 'bezig', 'geboekt', 'overgeslagen', 'gestopt', 'geboekt_handmatig']);

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function POST(req, { params }) {
  const id = params?.id;
  const token = req.headers.get('x-batch-token') || new URL(req.url).searchParams.get('t') || '';
  if (!id || !token) return NextResponse.json({ ok: false, error: 'id of token ontbreekt' }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'ongeldige body' }, { status: 400 }); }

  const db = admin();
  const { data: b, error } = await db.from('eagle_prepay_batches').select('id, token').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!b || b.token !== token) return NextResponse.json({ ok: false, error: 'batch niet gevonden of token onjuist' }, { status: 404 });

  const fouten = [];

  // 1. gebeurtenissen
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length) {
    const rows = events.slice(0, 500).map((e) => ({
      batch_uuid: id,
      rij: Number.isFinite(Number(e.rij)) && e.rij !== null ? Number(e.rij) : null,
      niveau: clip(e.niveau || 'INFO', 10),
      bericht: clip(e.bericht || '', 2000) || '(leeg)',
      tijd: e.tijd || new Date().toISOString(),
    }));
    const { error: e1 } = await db.from('eagle_prepay_events').insert(rows);
    if (e1) fouten.push('events: ' + e1.message);
  }

  // 2. regels
  const rijen = Array.isArray(body.rows) ? body.rows : [];
  for (const r of rijen) {
    if (!Number.isFinite(Number(r.rij))) continue;
    const patch = { updated_at: new Date().toISOString() };
    if (r.status && ROW_STATUS.has(r.status)) patch.status = r.status;
    if (r.stap !== undefined) patch.stap = clip(r.stap, 120);
    if (r.voucher !== undefined) patch.voucher = clip(r.voucher, 40);
    if (r.reden !== undefined) patch.reden = clip(r.reden, 2000);
    const { error: e2 } = await db.from('eagle_prepay_rows').update(patch).eq('batch_uuid', id).eq('rij', Number(r.rij));
    if (e2) fouten.push(`rij ${r.rij}: ` + e2.message);
  }

  // 3. batch
  const bb = body.batch && typeof body.batch === 'object' ? body.batch : null;
  if (bb) {
    const patch = { updated_at: new Date().toISOString() };
    if (bb.status && BATCH_STATUS.has(bb.status)) patch.status = bb.status;
    if (bb.laatste_bericht !== undefined) patch.laatste_bericht = clip(bb.laatste_bericht, 2000);
    if (bb.eagle_store !== undefined) patch.eagle_store = clip(bb.eagle_store, 10);
    if (bb.eagle_user !== undefined) patch.eagle_user = clip(bb.eagle_user, 60);
    if (bb.machine !== undefined) patch.machine = clip(bb.machine, 120);
    if (bb.bridge_versie !== undefined) patch.bridge_versie = clip(bb.bridge_versie, 40);
    if (bb.started) patch.started_at = new Date().toISOString();
    if (bb.finished) patch.finished_at = new Date().toISOString();
    for (const k of ['geboekt', 'overgeslagen', 'fout']) {
      if (Number.isFinite(Number(bb[k])) && bb[k] !== null && bb[k] !== undefined) patch[k] = Number(bb[k]);
    }
    const { error: e3 } = await db.from('eagle_prepay_batches').update(patch).eq('id', id);
    if (e3) fouten.push('batch: ' + e3.message);
  }

  if (fouten.length) return NextResponse.json({ ok: false, error: fouten.join('; ') }, { status: 500 });
  return NextResponse.json({ ok: true });
}
