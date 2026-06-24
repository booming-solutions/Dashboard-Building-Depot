/* ============================================================
   BESTAND: route.js  (pro forma)
   KOPIEER NAAR: src/app/api/order-flow/proforma/route.js   (NIEUW)

   POST { po_id, kind: 'deposit' | 'final' }
   - valideert de ingelogde gebruiker (RLS-context)
   - berekent bedrag = total_cost * pct/100
   - genereert factuurnummer (PF-2026-00001) via RPC
   - mailt de pro forma naar de AP-mailbox (test: jouw adres)
   - archiveert de pro forma + zet aanvraagdatum op de PO

   Env-vars (Vercel):
     AP_INVOICE_RECIPIENT  -> ap.invoices@building-depot.net
                              (TEST: jeroen.boom@building-depot.net)
     RESEND_API_KEY, ORDER_FLOW_FROM (zie email.js)
   ============================================================ */
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECIPIENT = process.env.AP_INVOICE_RECIPIENT || 'jeroen.boom@building-depot.net';

function money(n, ccy) {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: ccy || 'USD' }).format(Number(n || 0));
}

function invoiceHtml({ po, kind, pct, amount, invoiceNo, ccy }) {
  const label = kind === 'deposit' ? 'Aanbetaling' : 'Restbetaling';
  const today = new Date().toLocaleDateString('nl-NL');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px">
    <h2 style="margin:0 0 4px">PRO FORMA INVOICE</h2>
    <div style="color:#666;margin-bottom:16px">${label} — ${pct}% van PO ${po.po_number}</div>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">Factuurnummer</td><td style="padding:6px 0;text-align:right"><b>${invoiceNo}</b></td></tr>
      <tr><td style="padding:6px 0;color:#666">Datum</td><td style="padding:6px 0;text-align:right">${today}</td></tr>
      <tr><td style="padding:6px 0;color:#666">PO-nummer</td><td style="padding:6px 0;text-align:right">${po.po_number}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Leverancier</td><td style="padding:6px 0;text-align:right">${po.vendor_name || po.vendor_code || '-'}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Afdeling</td><td style="padding:6px 0;text-align:right">${po.dept || '-'}</td></tr>
      <tr><td style="padding:6px 0;color:#666">PO-totaal</td><td style="padding:6px 0;text-align:right">${money(po.total_cost, ccy)}</td></tr>
    </table>
    <table style="border-collapse:collapse;width:100%;margin-top:12px;border-top:2px solid #1a1a1a">
      <tr>
        <td style="padding:12px 0;font-size:15px">${label} (${pct}%)</td>
        <td style="padding:12px 0;text-align:right;font-size:18px"><b>${money(amount, ccy)}</b></td>
      </tr>
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px">
      Automatisch gegenereerd door de Order Flow portal. Betalingsinstructie/bankgegevens
      volgen op de definitieve factuur.
    </p>
  </div>`;
}

export async function POST(req) {
  const supabase = createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Ongeldige body' }, { status: 400 }); }
  const { po_id, kind } = body || {};
  if (!po_id || !['deposit', 'final'].includes(kind)) {
    return NextResponse.json({ error: 'po_id en kind (deposit|final) vereist' }, { status: 400 });
  }

  const { data: po, error: poErr } = await supabase.from('order_flow').select('*').eq('id', po_id).single();
  if (poErr || !po) return NextResponse.json({ error: 'PO niet gevonden' }, { status: 404 });

  const pct = kind === 'deposit' ? Number(po.deposit_pct ?? 30) : Number(po.final_pct ?? 70);
  const ccy = po.currency || 'USD';
  const total = Number(po.total_cost ?? 0);
  if (!total) return NextResponse.json({ error: 'PO heeft geen total_cost; vul die eerst in' }, { status: 422 });
  const amount = Math.round((total * pct / 100) * 100) / 100;

  const { data: invoiceNo, error: numErr } = await supabase.rpc('order_flow_next_proforma');
  if (numErr || !invoiceNo) return NextResponse.json({ error: 'Factuurnummer genereren mislukt' }, { status: 500 });

  const html = invoiceHtml({ po, kind, pct, amount, invoiceNo, ccy });
  const mail = await sendEmail({
    to: RECIPIENT,
    subject: `Pro forma ${invoiceNo} — ${kind === 'deposit' ? 'aanbetaling' : 'restbetaling'} PO ${po.po_number}`,
    html,
  });
  if (!mail.ok) return NextResponse.json({ error: 'Mail versturen mislukt: ' + mail.error }, { status: 502 });

  await supabase.from('order_flow_proforma').insert({
    po_id, kind, invoice_no: invoiceNo, pct, amount, currency: ccy,
    sent_to: RECIPIENT, sent_at: new Date().toISOString(), payload: po,
  });

  const now = new Date().toISOString();
  const patch = kind === 'deposit'
    ? { deposit_requested_at: now, deposit_invoice_no: invoiceNo, deposit_amount: amount }
    : { final_requested_at: now, final_invoice_no: invoiceNo, final_amount: amount };
  await supabase.from('order_flow').update(patch).eq('id', po_id);

  return NextResponse.json({ ok: true, invoice_no: invoiceNo, amount, sent_to: RECIPIENT });
}
