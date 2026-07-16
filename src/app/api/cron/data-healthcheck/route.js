/* ============================================================
   BESTAND: cron_data_healthcheck_v2.js
   KOPIEER NAAR: src/app/api/cron/data-healthcheck/route.js
   VERSIE: v2

   Wijzigingen t.o.v. v1:
   - Correcte datum-kolommen voor sales_data (sale_date),
     discount_data (sale_date), traffic_data (date). Voorheen
     stond 'created_at' wat niet bestond → status 'unknown'.
   - Nieuwe bron toegevoegd: visitor_data_weekly (Liselotte's
     wekelijkse visitor-file). Threshold: OK < 8 dagen, warn < 14.
   - weekendTolerance vlag: sales/discount/traffic mogen op
     maandag 3 dagen oud zijn zonder alarm (weekend geen data).
   - traffic_data label uitgebreid: bevat ook tickets, dus
     één check dekt beide.
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Verwachte data-bronnen (dagelijks binnenkomen)
var SOURCES = [
  // Buying data per BUM × Regio
  { key: 'buying_pascal_cur', label: 'Buying — Pascal (Building Materials) CUR', table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'PASCAL', regio: 'CUR' } },
  { key: 'buying_pascal_bon', label: 'Buying — Pascal (Building Materials) BON', table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'PASCAL', regio: 'BON' } },
  { key: 'buying_henk_cur',   label: 'Buying — Henk (Sanitair/Keukens) CUR',    table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'HENK', regio: 'CUR' } },
  { key: 'buying_henk_bon',   label: 'Buying — Henk (Sanitair/Keukens) BON',    table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'HENK', regio: 'BON' } },
  { key: 'buying_john_cur',   label: 'Buying — John (Hardware) CUR',            table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'JOHN', regio: 'CUR' } },
  { key: 'buying_john_bon',   label: 'Buying — John (Hardware) BON',            table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'JOHN', regio: 'BON' } },
  { key: 'buying_daniel_cur', label: 'Buying — Daniel (Appliances) CUR',        table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'DANIEL', regio: 'CUR' } },
  { key: 'buying_daniel_bon', label: 'Buying — Daniel (Appliances) BON',        table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'DANIEL', regio: 'BON' } },
  { key: 'buying_gijs_cur',   label: 'Buying — Gijs (Living) CUR',              table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'GIJS', regio: 'CUR' } },
  { key: 'buying_gijs_bon',   label: 'Buying — Gijs (Living) BON',              table: 'buying_data', dateCol: 'upload_date', filter: { bum: 'GIJS', regio: 'BON' } },
  // Andere Compass exports
  { key: 'negative',       label: 'Negatieve Voorraad Snapshots', table: 'negative_inventory_snapshots', dateCol: 'snapshot_date' },
  { key: 'po',             label: 'PO Deliveries (ETA data)',      table: 'po_deliveries',                dateCol: 'uploaded_at' },
  { key: 'price',          label: 'Price Snapshots',               table: 'price_snapshots',              dateCol: 'snapshot_date' },
  { key: 'sales',          label: 'Sales Data',                    table: 'sales_data',                   dateCol: 'sale_date', weekendTolerance: true },
  { key: 'inventory',      label: 'Inventory Data',                table: 'inventory_data',               dateCol: 'inventory_date' },
  { key: 'discount',       label: 'Kortingen (Discount Data)',     table: 'discount_data',                dateCol: 'sale_date', weekendTolerance: true },
  { key: 'traffic',        label: 'Bezoekers + Tickets (Traffic)', table: 'traffic_data',                 dateCol: 'date',      weekendTolerance: true },
  { key: 'visitor_weekly', label: 'Bezoekers Weekly (Liselotte)',  table: 'visitor_data_weekly',          dateCol: 'uploaded_at', maxAgeDaysOk: 8, maxAgeDaysWarn: 14 },
];

var STATUS = {
  OK: 'ok',           // < 24u
  WARN: 'warn',       // 24-48u
  ERROR: 'error',     // > 48u
  UNKNOWN: 'unknown', // query faalde
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function hoursSince(date) {
  if (!date) return null;
  var d = new Date(date);
  if (isNaN(d.getTime())) return null;
  var now = new Date();
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60);
}

function classifyStatus(hoursAgo, src) {
  if (hoursAgo === null || hoursAgo === undefined) return STATUS.UNKNOWN;
  var okDays = src.maxAgeDaysOk;
  var warnDays = src.maxAgeDaysWarn;
  if (okDays && warnDays) {
    // Custom thresholds per source
    if (hoursAgo < okDays * 24) return STATUS.OK;
    if (hoursAgo < warnDays * 24) return STATUS.WARN;
    return STATUS.ERROR;
  }
  if (src.weekendTolerance) {
    // Weekend tolerance: sales/discount/traffic hebben op maandag data van vrijdag
    // (= tot 72u oud). Dus rekening houden met weekenden.
    var now = new Date();
    var day = now.getUTCDay(); // 0=zo, 1=ma, 2=di, ..., 6=za
    var extraOk = 0, extraWarn = 0;
    if (day === 1) { extraOk = 48; extraWarn = 72; } // maandag: sta 3 dagen toe
    else if (day === 0) { extraOk = 24; extraWarn = 48; } // zondag: sta 2 dagen toe
    if (hoursAgo < 24 + extraOk) return STATUS.OK;
    if (hoursAgo < 48 + extraWarn) return STATUS.WARN;
    return STATUS.ERROR;
  }
  // Default: dagelijkse data
  if (hoursAgo < 24) return STATUS.OK;
  if (hoursAgo < 48) return STATUS.WARN;
  return STATUS.ERROR;
}

function fmtDate(d) {
  if (!d) return '—';
  var dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(dt.getUTCDate()) + '/' + pad(dt.getUTCMonth() + 1) + '/' + dt.getUTCFullYear();
}

function fmtHours(h) {
  if (h === null || h === undefined) return '?';
  if (h < 24) return Math.floor(h) + ' uur';
  var d = Math.floor(h / 24);
  return d + (d === 1 ? ' dag' : ' dagen');
}

async function checkSource(supabase, src) {
  try {
    var query = supabase.from(src.table).select(src.dateCol + ', ' + (src.dateCol === 'upload_date' ? 'upload_date' : src.dateCol)).order(src.dateCol, { ascending: false }).limit(1);
    if (src.filter) {
      Object.keys(src.filter).forEach(function(k) { query = query.eq(k, src.filter[k]); });
    }
    var r = await query;
    if (r.error) {
      return { ...src, status: STATUS.UNKNOWN, error: r.error.message, last_date: null, hours_ago: null };
    }
    if (!r.data || !r.data.length) {
      return { ...src, status: STATUS.ERROR, last_date: null, hours_ago: null, error: 'Geen rijen gevonden' };
    }
    var lastDate = r.data[0][src.dateCol];
    var h = hoursSince(lastDate);
    return { ...src, status: classifyStatus(h, src), last_date: lastDate, hours_ago: h };
  } catch (e) {
    return { ...src, status: STATUS.UNKNOWN, error: e.message, last_date: null, hours_ago: null };
  }
}

function buildEmailHtml(results) {
  var totals = { ok: 0, warn: 0, error: 0, unknown: 0 };
  results.forEach(function(r) { totals[r.status] = (totals[r.status] || 0) + 1; });

  var overallStatus = STATUS.OK;
  if (totals.error > 0) overallStatus = STATUS.ERROR;
  else if (totals.warn > 0 || totals.unknown > 0) overallStatus = STATUS.WARN;

  var headerColor = overallStatus === STATUS.OK ? '#16a34a' : overallStatus === STATUS.WARN ? '#d97706' : '#dc2626';
  var headerText = overallStatus === STATUS.OK ? 'Alles OK' : overallStatus === STATUS.WARN ? 'Aandacht nodig' : 'Actie vereist';

  var today = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var dateStr = pad(today.getUTCDate()) + '/' + pad(today.getUTCMonth() + 1) + '/' + today.getUTCFullYear();

  var rowsHtml = results.map(function(r) {
    var badge;
    if (r.status === STATUS.OK) badge = '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">OK</span>';
    else if (r.status === STATUS.WARN) badge = '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Waarschuwing</span>';
    else if (r.status === STATUS.ERROR) badge = '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Probleem</span>';
    else badge = '<span style="background:#e5e7eb;color:#374151;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Onbekend</span>';
    var lastDate = fmtDate(r.last_date);
    var hoursAgo = r.hours_ago === null ? '' : ' (' + fmtHours(r.hours_ago) + ' geleden)';
    var errorNote = r.error ? '<br><span style="color:#dc2626;font-size:11px;">' + r.error + '</span>' : '';
    return '<tr>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#1a0a04;">' + r.label + errorNote + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">' + badge + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b5240;text-align:right;white-space:nowrap;">' + lastDate + hoursAgo + '</td>' +
      '</tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Data Healthcheck ' + dateStr + '</title></head>' +
    '<body style="margin:0;padding:20px;background:#faf7f4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">' +
    '<div style="padding:20px 24px;background:' + headerColor + ';color:#fff;">' +
      '<div style="font-size:12px;opacity:0.9;letter-spacing:0.5px;text-transform:uppercase;">Booming Solutions — Data Healthcheck</div>' +
      '<div style="font-size:22px;font-weight:600;margin-top:4px;">' + headerText + '</div>' +
      '<div style="font-size:13px;opacity:0.9;margin-top:2px;">' + dateStr + ' — 07:00 Curaçao</div>' +
    '</div>' +
    '<div style="padding:16px 24px;background:#f8f5f2;border-bottom:1px solid #e5e7eb;">' +
      '<span style="display:inline-block;margin-right:16px;font-size:13px;color:#166534;"><strong>' + totals.ok + '</strong> OK</span>' +
      '<span style="display:inline-block;margin-right:16px;font-size:13px;color:#92400e;"><strong>' + totals.warn + '</strong> waarschuwing</span>' +
      '<span style="display:inline-block;margin-right:16px;font-size:13px;color:#991b1b;"><strong>' + totals.error + '</strong> probleem</span>' +
      (totals.unknown > 0 ? '<span style="display:inline-block;font-size:13px;color:#374151;"><strong>' + totals.unknown + '</strong> onbekend</span>' : '') +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;">' +
      '<thead><tr style="background:#faf7f4;">' +
        '<th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b5240;border-bottom:1px solid #e5e7eb;">Bron</th>' +
        '<th style="text-align:right;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b5240;border-bottom:1px solid #e5e7eb;">Status</th>' +
        '<th style="text-align:right;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#6b5240;border-bottom:1px solid #e5e7eb;">Laatst</th>' +
      '</tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
    '</table>' +
    '<div style="padding:14px 24px;background:#faf7f4;font-size:11px;color:#6b5240;border-top:1px solid #e5e7eb;line-height:1.5;">' +
      'Statuscriteria: <strong>OK</strong> = &lt; 24u, <strong>Waarschuwing</strong> = 24-48u, <strong>Probleem</strong> = &gt; 48u.<br>' +
      'Gegenereerd door boomingsolutions.ai/api/cron/data-healthcheck' +
    '</div>' +
    '</div></body></html>';
}

async function sendEmail(html, subject) {
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  var fromAddress = process.env.RESEND_FROM || 'alerts@boomingsolutions.ai';
  var toAddress = 'j.boom@building-depot.net';

  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Booming Solutions <' + fromAddress + '>',
      to: [toAddress],
      subject: subject,
      html: html,
    }),
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Resend API error ' + res.status + ': ' + errText);
  }
  return await res.json();
}

export async function GET(req) {
  // Optionele bescherming: als CRON_SECRET is ingesteld, verwacht die in header
  var cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    var auth = req.headers.get('authorization');
    if (auth !== 'Bearer ' + cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    var supabase = getSupabase();
    // Check alle bronnen parallel
    var results = await Promise.all(SOURCES.map(function(s) { return checkSource(supabase, s); }));

    var totals = { ok: 0, warn: 0, error: 0, unknown: 0 };
    results.forEach(function(r) { totals[r.status]++; });

    var overallStatus = totals.error > 0 ? 'PROBLEEM' : (totals.warn > 0 ? 'WAARSCHUWING' : 'OK');
    var subject = '[Healthcheck] ' + overallStatus + ' — ' + totals.ok + ' OK, ' + totals.warn + ' warn, ' + totals.error + ' err';

    var html = buildEmailHtml(results);
    var emailResult = await sendEmail(html, subject);

    return Response.json({
      success: true,
      overall_status: overallStatus,
      totals: totals,
      results: results.map(function(r) { return { key: r.key, status: r.status, last_date: r.last_date, hours_ago: r.hours_ago, error: r.error }; }),
      email_id: emailResult.id,
    });
  } catch (e) {
    console.error('Healthcheck error:', e);
    return Response.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}