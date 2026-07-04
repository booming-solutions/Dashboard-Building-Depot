/* ============================================================
   BESTAND: route.js  (Order Flow — VesselFinder tracking)
   KOPIEER NAAR: src/app/api/order-flow/track/route.js   (NIEUW)

   POST { po_id }
   - leest container_no + sealine van de PO
   - roept VesselFinder Container Tracking API aan
   - schrijft ETA (general.destination.date), scheepspositie en
     voortgang terug naar de PO; zet eta_source = 'vesselfinder'

   Env-var (Vercel): VESSELFINDER_API_KEY

   Auth: ingelogde gebruiker (cookie) OF x-worker-secret (voor testen).
   ============================================================ */
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = 'https://container.vesselfinder.com/api/1.0/container';

function toISODate(unixSec) {
  if (!unixSec) return null;
  var d = new Date(unixSec * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function toISO(unixSec) {
  if (!unixSec) return null;
  var d = new Date(unixSec * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function POST(req) {
  const key = process.env.VESSELFINDER_API_KEY;
  if (!key) return NextResponse.json({ error: 'VESSELFINDER_API_KEY ontbreekt' }, { status: 500 });

  // Auth: cookie-sessie, of x-worker-secret voor test
  let supabase;
  const workerSecret = req.headers.get('x-worker-secret');
  if (workerSecret && workerSecret === process.env.WORKER_SECRET) {
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  } else {
    supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Ongeldige body' }, { status: 400 }); }
  const po_id = body?.po_id;
  if (!po_id) return NextResponse.json({ error: 'po_id vereist' }, { status: 400 });

  const { data: po, error } = await supabase
    .from('order_flow')
    .select('id, po_number, container_no, sealine')
    .eq('id', po_id).single();
  if (error || !po) return NextResponse.json({ error: 'PO niet gevonden' }, { status: 404 });

  const container = String(po.container_no || '').trim().toUpperCase();
  if (container.length !== 11) {
    return NextResponse.json({ error: 'Containernummer moet exact 11 tekens zijn (4 letters + 7 cijfers).' }, { status: 422 });
  }
  const sealine = (String(po.sealine || '').trim().toUpperCase()) || 'AUTO';

  const url = `${API}/${encodeURIComponent(key)}/${encodeURIComponent(container)}/${encodeURIComponent(sealine)}`;
  let res, j;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
    j = await res.json();
  } catch (e) {
    return NextResponse.json({ error: 'VesselFinder onbereikbaar: ' + e.message }, { status: 502 });
  }

  const status = j?.status;
  const now = new Date().toISOString();

  // Nog niet klaar -> client moet later opnieuw proberen (max 1x per minuut)
  if (res.status === 202 || status === 'queued' || status === 'processing') {
    await supabase.from('order_flow').update({
      tracking_status: status || 'processing',
      tracking_message: 'VesselFinder verwerkt de aanvraag — probeer over ~1 minuut opnieuw.',
      tracking_updated_at: now,
    }).eq('id', po_id);
    return NextResponse.json({ ok: true, status: 'processing', message: 'Nog bezig bij VesselFinder — probeer over ~1 minuut opnieuw.' });
  }

  // Fout
  if (status === 'error' || !res.ok) {
    const msg = j?.errorDescription || j?.errorCode || ('HTTP ' + res.status);
    await supabase.from('order_flow').update({
      tracking_status: 'error', tracking_message: msg, tracking_updated_at: now,
    }).eq('id', po_id);
    return NextResponse.json({ ok: false, status: 'error', code: j?.errorCode, message: msg });
  }

  // Succes
  const g = j?.general || {};
  const dest = g.destination || {};
  const pol = g.origin || {};
  const vessel = (g.currentLocation && g.currentLocation.vessel) || {};
  const etaDate = toISODate(dest.date);

  const patch = {
    pol_name: pol.name || null,
    pod_name: dest.name || null,
    pol_lat: (pol.lat ?? null),
    pol_lng: (pol.lng ?? null),
    pod_lat: (dest.lat ?? null),
    pod_lng: (dest.lng ?? null),
    carrier: g.carrier || null,
    vessel_name: vessel.name || null,
    vessel_imo: vessel.imo || null,
    vessel_mmsi: vessel.mmsi || null,
    vessel_lat: (vessel.latitude ?? null),
    vessel_lng: (vessel.longitude ?? null),
    vessel_course: (vessel.course ?? null),
    vessel_speed: (vessel.speed ?? null),
    vessel_ais_at: toISO(vessel.aisTimestamp),
    tracking_progress: (g.progress ?? null),
    tracking_status: 'success',
    tracking_message: g.carrier ? ('Carrier: ' + g.carrier) : null,
    tracking_updated_at: now,
  };
  if (etaDate) { patch.eta = etaDate; patch.eta_source = 'vesselfinder'; }
  if (sealine !== 'AUTO') { patch.sealine = sealine; }

  await supabase.from('order_flow').update(patch).eq('id', po_id);

  return NextResponse.json({
    ok: true, status: 'success',
    eta: etaDate, carrier: g.carrier || null, progress: g.progress ?? null,
    vessel: vessel.name || null, pod: dest.name || null,
    containers_remaining: j?.subscription?.containersRemaining ?? null,
  });
}