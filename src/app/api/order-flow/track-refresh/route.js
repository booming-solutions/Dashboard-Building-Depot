/* ============================================================
   BESTAND: route.js  (Order Flow — posities verversen)
   KOPIEER NAAR: src/app/api/order-flow/track-refresh/route.js   (NIEUW)

   Haalt voor alle VARENDE containers (nog niet aangekomen) opnieuw de
   positie/ETA op bij VesselFinder en werkt de database bij. Bedoeld voor:
   - een Vercel Cron (automatisch, bv. elke 6 uur), en
   - de knop "Ververs posities" op de wereldkaart (ingelogde gebruiker).

   Auth: Vercel Cron (Authorization: Bearer <CRON_SECRET>),
         of x-worker-secret, of een ingelogde gebruiker.

   Env: VESSELFINDER_API_KEY, (optioneel) CRON_SECRET, WORKER_SECRET,
        SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
   ============================================================ */
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API = 'https://container.vesselfinder.com/api/1.0/container';
const dISO = (s) => (s ? new Date(s * 1000).toISOString() : null);
const dDATE = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : null);

async function handler(req) {
  const key = process.env.VESSELFINDER_API_KEY;
  if (!key) return NextResponse.json({ error: 'VESSELFINDER_API_KEY ontbreekt' }, { status: 500 });

  const auth = req.headers.get('authorization') || '';
  const isCron = !!process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  const isWorker = req.headers.get('x-worker-secret') === process.env.WORKER_SECRET;

  let supabase;
  if (isCron || isWorker) {
    supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  } else {
    supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 });
  }

  // Varende containers: nummer bekend, nog niet (volledig) aangekomen
  const { data: cs, error } = await supabase
    .from('order_flow_containers')
    .select('id, po_id, container_no, sealine, tracking_progress')
    .not('container_no', 'is', null)
    .or('tracking_progress.is.null,tracking_progress.lt.100')
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0, processing = 0, errors = 0, skipped = 0, remaining = null;

  for (const c of cs || []) {
    const container = String(c.container_no || '').trim().toUpperCase();
    if (container.length !== 11) { skipped++; continue; }
    const sealine = (String(c.sealine || '').trim().toUpperCase()) || 'AUTO';
    const now = new Date().toISOString();
    let res, j;
    try {
      res = await fetch(`${API}/${encodeURIComponent(key)}/${encodeURIComponent(container)}/${encodeURIComponent(sealine)}`, { headers: { Accept: 'application/json' } });
      j = await res.json();
    } catch (e) { errors++; continue; }

    const status = j?.status;
    if (res.status === 202 || status === 'queued' || status === 'processing') {
      processing++;
      await supabase.from('order_flow_containers').update({ tracking_status: status || 'processing', tracking_updated_at: now }).eq('id', c.id);
      continue;
    }
    if (status === 'error' || !res.ok) {
      errors++;
      await supabase.from('order_flow_containers').update({ tracking_status: 'error', tracking_message: j?.errorDescription || j?.errorCode || ('HTTP ' + res.status), tracking_updated_at: now }).eq('id', c.id);
      continue;
    }

    const g = j?.general || {};
    const dest = g.destination || {};
    const pol = g.origin || {};
    const vessel = (g.currentLocation && g.currentLocation.vessel) || {};
    const etaDate = dDATE(dest.date);
    await supabase.from('order_flow_containers').update({
      eta: etaDate, carrier: g.carrier || null,
      pol_name: pol.name || null, pol_lat: (pol.lat ?? null), pol_lng: (pol.lng ?? null),
      pod_name: dest.name || null, pod_lat: (dest.lat ?? null), pod_lng: (dest.lng ?? null),
      vessel_name: vessel.name || null, vessel_imo: vessel.imo || null, vessel_mmsi: vessel.mmsi || null,
      vessel_lat: (vessel.latitude ?? null), vessel_lng: (vessel.longitude ?? null), vessel_ais_at: dISO(vessel.aisTimestamp),
      tracking_progress: (g.progress ?? null), tracking_status: 'success',
      tracking_message: g.carrier ? ('Carrier: ' + g.carrier) : null, tracking_updated_at: now,
    }).eq('id', c.id);

    if (etaDate) {
      const { data: e } = await supabase.from('order_flow_containers').select('eta').eq('po_id', c.po_id).not('eta', 'is', null).order('eta', { ascending: true }).limit(1);
      if (e && e.length) await supabase.from('order_flow').update({ eta: e[0].eta, eta_source: 'vesselfinder' }).eq('id', c.po_id);
    }
    remaining = j?.subscription?.containersRemaining ?? remaining;
    updated++;
  }

  return NextResponse.json({ ok: true, checked: (cs || []).length, updated, processing, errors, skipped, containers_remaining: remaining });
}

export const GET = handler;
export const POST = handler;
