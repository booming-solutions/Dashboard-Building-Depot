/* ============================================================
   BESTAND: route.js  (Vooruitbetalingen — batch aanmaken)
   KOPIEER NAAR: src/app/api/finance/prepay/batches/route.js   (NIEUW)

   Slaat een batch op die de Eagle Bridge gaat boeken en geeft de
   startlink terug (eagleprepay://batch/<id>?t=<token>).

   - Alleen voor ingelogde dashboardgebruikers (auth-cookie).
   - Elke batch krijgt een eigen, willekeurig token. De Bridge gebruikt
     dat token om de batch op te halen en de voortgang terug te melden.
     Er hoeft dus niets op de PC's van medewerkers geconfigureerd te worden.

   Body (JSON): { batch: <het .eaglebatch-object uit buildBatch()> }
   Antwoord:    { ok, id, batchId, token, launch, bestandsnaam }

   Env-vars (Vercel): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                      SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORES = { '000': '1', '700': 'B' };

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export async function POST(req) {
  // 1. Wie vraagt dit?
  let user = null;
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
  } catch { /* geen sessie */ }
  if (!user) return NextResponse.json({ ok: false, error: 'niet ingelogd' }, { status: 401 });

  // 2. Batch controleren
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'ongeldige body' }, { status: 400 }); }
  const batch = body?.batch;
  if (!batch || !Array.isArray(batch.regels) || !batch.regels.length) {
    return NextResponse.json({ ok: false, error: 'batch bevat geen regels' }, { status: 422 });
  }
  const store = STORES[String(batch.entiteit)];
  if (!store) return NextResponse.json({ ok: false, error: `onbekende entiteit ${batch.entiteit}` }, { status: 422 });
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(String(batch.voucherDate || ''))) {
    return NextResponse.json({ ok: false, error: 'voucherDate ontbreekt of heeft niet het formaat mm/dd/jj' }, { status: 422 });
  }
  for (const r of batch.regels) {
    if (!r.vendor || !r.vendorRefNo || !(Number(r.invoiceAmount) > 0) || !r.distribution?.amount) {
      return NextResponse.json({ ok: false, error: `rij ${r.rij}: onvolledige regel` }, { status: 422 });
    }
  }

  // 3. Dubbelboeking over alle PC's heen: een factuurnummer dat al via
  //    het dashboard geboekt is (of nu bezig is), gaat nooit mee. Het
  //    dashboard zet zo'n regel op de lijst handmatig boeken; dit is het
  //    slot op de deur voor het geval dat toch omzeild wordt.
  const db = admin();
  const keys = batch.regels.map((r) => r.dedupeKey).filter(Boolean);
  if (keys.length) {
    const { data: eerder, error: eErr } = await db
      .from('eagle_prepay_rows')
      .select('dedupe_key,status,voucher')
      .in('dedupe_key', keys)
      .in('status', ['geboekt', 'geboekt_handmatig', 'bezig']);
    if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 });
    const al = new Map((eerder || []).map((r) => [r.dedupe_key, r]));
    const geweigerd = batch.regels
      .filter((r) => al.has(r.dedupeKey))
      .map((r) => `rij ${r.rij} (factuur ${r.vendorRefNo}${al.get(r.dedupeKey).voucher ? `, voucher ${al.get(r.dedupeKey).voucher}` : ''})`);
    if (geweigerd.length) {
      return NextResponse.json({
        ok: false,
        error: 'Al eerder geboekt en niet bevestigd: ' + geweigerd.join('; ') + '. Lees het bestand opnieuw in; deze regels horen op de lijst handmatig boeken.',
      }, { status: 409 });
    }
  }

  // 4. Opslaan
  const token = randomBytes(24).toString('base64url');
  const batchId = batch.batchId || `${String(batch.voucherDate).replace(/\//g, '')}-${batch.entiteit}-${Date.now().toString().slice(-6)}`;
  const totaal = batch.regels.reduce((s, r) => s + Number(r.invoiceAmount || 0), 0);

  // boekdatum (ISO) uit mm/dd/jj
  const [mm, dd, jj] = String(batch.voucherDate).split('/');
  const boekdatum = `20${jj}-${mm}-${dd}`;

  const payload = { ...batch, batchId, store };

  const { data: ins, error: e1 } = await db
    .from('eagle_prepay_batches')
    .insert({
      batch_id: batchId,
      token,
      entiteit: String(batch.entiteit),
      entiteit_naam: batch.entiteitNaam || null,
      store,
      voucher_date: batch.voucherDate,
      boekdatum,
      bestand: batch.bestand || null,
      koers_norm: batch.koersNorm ?? null,
      aantal_regels: batch.regels.length,
      aantal_handmatig: Array.isArray(batch.handmatig) ? batch.handmatig.length : 0,
      totaal_xcg: Number(totaal.toFixed(2)),
      payload,
      status: 'klaar',
      created_by: user.email || user.id,
    })
    .select('id')
    .single();
  if (e1) return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });

  const rows = batch.regels.map((r) => ({
    batch_uuid: ins.id,
    rij: r.rij,
    dedupe_key: r.dedupeKey || null,
    vendor: String(r.vendor),
    vendor_ref_no: String(r.vendorRefNo),
    invoice_amount: Number(r.invoiceAmount),
    voucher_ref: r.voucherRef || null,
    status: 'wachten',
  }));
  const { error: e2 } = await db.from('eagle_prepay_rows').insert(rows);
  if (e2) {
    await db.from('eagle_prepay_batches').delete().eq('id', ins.id);
    return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
  }

  await db.from('eagle_prepay_events').insert({
    batch_uuid: ins.id, niveau: 'INFO',
    bericht: `Batch klaargezet door ${user.email || user.id}: ${batch.regels.length} regel(s), ${batch.entiteitNaam || batch.entiteit}, Store ${store}, datum ${batch.voucherDate}.`,
  });

  // 5. Startlink voor de Bridge. De host gaat mee zodat de Bridge weet
  //    waar hij moet terugmelden (productie én preview-deploys).
  const host = req.headers.get('host') || 'boomingsolutions.ai';
  const launch = `eagleprepay://batch/${ins.id}?t=${token}&h=${encodeURIComponent(host)}`;

  return NextResponse.json({
    ok: true,
    id: ins.id,
    batchId,
    token,
    store,
    launch,
    bestandsnaam: `vooruitbetalingen-${batchId}.eaglebatch`,
    // Voor de download-variant: hetzelfde bestand mét rapportage-gegevens,
    // zodat ook een gedubbelklikt bestand zijn voortgang terugmeldt.
    payload: { ...payload, rapportage: { id: ins.id, token, host } },
  });
}
