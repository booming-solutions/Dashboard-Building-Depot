/* ============================================================
   BESTAND: route.js (daily report cron)
   KOPIEER NAAR: src/app/api/cron/daily-report/route.js
   (NIEUWE mappen aanmaken: src/app/api/cron/daily-report/)

   Wordt elke avond automatisch aangeroepen door Vercel cron
   om 23:15 UTC (= 19:15 lokale tijd Curaçao/Bonaire).

   Configuratie cron staat in vercel.json (root van repo).
   Vercel stuurt een GET request met header Authorization: Bearer ${CRON_SECRET}.

   Ook handmatig aan te roepen via /api/cron/daily-report?manual=1
   (vereist admin auth — zie GET handler).
   ============================================================ */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getDailyReportData, renderEmailHTML, STORE_LABELS } from '@/lib/dailyReport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Vercel cron stuurt header `Authorization: Bearer ${CRON_SECRET}` — als die
// matched, mag de job draaien. Voor handmatige trigger via admin pagina checken
// we de Supabase auth cookie (zoals /api/health doet).
async function isAuthorized(request) {
  // Pad 1: Vercel cron (automatisch)
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${process.env.CRON_SECRET}`) return { ok: true, source: 'cron' };

  // Pad 2: Handmatige trigger door admin
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return { ok: false, reason: 'config' };

    const cookieStore = await cookies();
    let accessToken = null;
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.includes('auth-token') && !cookie.name.includes('code-verifier')) {
        try {
          let val = cookie.value;
          if (val.startsWith('base64-')) val = atob(val.substring(7));
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed) && parsed[0]) accessToken = parsed[0];
          else if (parsed.access_token) accessToken = parsed.access_token;
        } catch (e) {}
        if (accessToken) break;
      }
    }
    if (!accessToken) return { ok: false, reason: 'no_token' };

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return { ok: false, reason: 'no_user' };
    const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return { ok: false, reason: 'not_admin' };
    return { ok: true, source: 'manual', userEmail: user.email };
  } catch (e) {
    return { ok: false, reason: 'auth_error' };
  }
}

async function logError(supabase, errorType, message, context, severity) {
  try {
    await supabase.from('pipeline_errors').insert({
      pipeline_name: 'daily_report',
      error_type: errorType,
      error_message: message,
      context: context || null,
      severity: severity || 'error',
    });
  } catch (e) {
    console.error('Failed to log daily_report error:', e.message);
  }
}

export async function GET(request) {
  const authResult = await isAuthorized(request);
  if (!authResult.ok) {
    return Response.json({ error: 'Unauthorized', reason: authResult.reason }, { status: 401 });
  }

  // Verifieer env vars
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: 'RESEND_API_KEY missing in env vars' }, { status: 500 });
  }
  if (!process.env.DAILY_REPORT_RECIPIENTS) {
    return Response.json({ error: 'DAILY_REPORT_RECIPIENTS missing in env vars' }, { status: 500 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return Response.json({ error: 'Supabase config missing in env vars' }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Parse de gewenste rapport-datum:
  // - Cron: gebruik vandaag in lokale tijd (=verkoopdag)
  // - Manual: laat optionele ?date=YYYY-MM-DD toe
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date');
  let reportDate;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    reportDate = new Date(dateParam + 'T12:00:00Z');
  } else {
    // 23:15 UTC = 19:15 lokaal Curaçao (UTC-4). Op dat moment is het lokale "vandaag"
    // dezelfde kalenderdatum als UTC vandaag (want 19:15 ligt voor middernacht UTC).
    // Pak UTC-vandaag als rapport-datum (sluit aan op de import van 19:00).
    const now = new Date();
    reportDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  }

  // Stores ophalen: 1 (Curaçao) en B (Bonaire)
  const stores = ['1', 'B'];
  let storeReports = [];
  try {
    for (const s of stores) {
      const r = await getDailyReportData(supabase, s, reportDate);
      storeReports.push(r);
    }
  } catch (err) {
    await logError(supabase, 'data_fetch_failed', err.message || String(err),
      { reportDate: reportDate.toISOString() }, 'error');
    return Response.json({ error: 'Failed to fetch data: ' + err.message }, { status: 500 });
  }

  // Render HTML
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.boomingsolutions.ai';
  let html;
  try {
    html = renderEmailHTML(storeReports, siteUrl);
  } catch (err) {
    await logError(supabase, 'render_failed', err.message || String(err), null, 'error');
    return Response.json({ error: 'Failed to render: ' + err.message }, { status: 500 });
  }

  // Recipients parseren — comma separated, whitespace trim
  const recipients = process.env.DAILY_REPORT_RECIPIENTS
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Subject regel
  const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  const subject = `Building Depot Daily Report — ${reportDate.getDate()} ${MN[reportDate.getMonth()]} ${reportDate.getFullYear()}`;

  // Verstuur via Resend
  let sendResult;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Building Depot Daily Report <noreply@boomingsolutions.ai>',
        to: recipients,
        subject: subject,
        html: html,
      }),
    });
    sendResult = await res.json();
    if (!res.ok) {
      await logError(supabase, 'send_failed',
        `Resend API returned ${res.status}: ${JSON.stringify(sendResult)}`,
        { recipients, subject }, 'error');
      return Response.json({ error: 'Send failed', details: sendResult }, { status: 500 });
    }
  } catch (err) {
    await logError(supabase, 'send_exception', err.message || String(err), null, 'error');
    return Response.json({ error: 'Send threw: ' + err.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    source: authResult.source,
    reportDate: reportDate.toISOString().slice(0, 10),
    recipients,
    storesProcessed: storeReports.map(r => ({
      store: r.storeLabel,
      todaySales: r.todaySales,
      mtdSales: r.mtdSales,
      ytdSales: r.ytdSales,
    })),
    resendId: sendResult.id,
  });
}
