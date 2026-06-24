/* ============================================================
   BESTAND: route.js  (reminder cron)
   KOPIEER NAAR: src/app/api/order-flow/reminders/cron/route.js   (NIEUW)

   GET — draait dagelijks via Vercel Cron (zie vercel.json).
   Zoekt reminders met status 'pending' en due_at <= nu, mailt
   de toegewezen persoon en zet status op 'sent'.

   Gebruikt de SERVICE-ROLE client: draait zonder ingelogde
   gebruiker, dus moet RLS omzeilen.

   Env-vars (Vercel):
     SUPABASE_SERVICE_ROLE_KEY  -> Supabase > Project Settings > API
     CRON_SECRET                -> willekeurige geheime string;
        Vercel stuurt die automatisch mee als Authorization-header.
     RESEND_API_KEY, ORDER_FLOW_FROM (zie email.js)
   ============================================================ */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export async function GET(req) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from('order_flow_reminders')
    .select('id, assignee_email, message, due_at, order_flow ( po_number )')
    .eq('status', 'pending')
    .lte('due_at', nowIso);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const r of due || []) {
    const po = r.order_flow?.po_number ? ` (PO ${r.order_flow.po_number})` : '';
    const html = `
      <div style="font-family:Arial,sans-serif;color:#1a1a1a">
        <h3 style="margin:0 0 8px">Herinnering: actie vereist${esc(po)}</h3>
        <p style="font-size:14px;line-height:1.6">${esc(r.message)}</p>
        <p style="color:#888;font-size:12px">Verstuurd vanuit de Order Flow portal.</p>
      </div>`;
    const res = await sendEmail({
      to: r.assignee_email,
      subject: `Herinnering: actie vereist${po}`,
      html,
    });
    if (res.ok) {
      await admin.from('order_flow_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', r.id);
      sent++;
    }
  }

  return NextResponse.json({ ok: true, processed: due?.length || 0, sent });
}
