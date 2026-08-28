/* ============================================================
   BESTAND: resend-request route
   KOPIEER NAAR: src/app/api/mailbox/resend-request/route.js   (NIEUW)

   Verstuurt een "stuur de factuur (opnieuw)"-mail aan de leverancier
   (Nederlands + Engels). Roept de Resend REST-API rechtstreeks aan —
   dus GEEN npm-pakket nodig, breekt de build nooit.

   Env-vars (Vercel):
     RESEND_API_KEY   -> vereist om echt te versturen
     ORDER_FLOW_FROM  -> optioneel afzenderadres (default hieronder)

   Body (JSON): { to, vendor, invoice_number, kind }
     kind = 'invoice'  (default) -> vraag de ene ontbrekende factuur op
     kind = 'statement'          -> vraag de onderliggende originele facturen op
   Antwoord:    { ok:true, id } | { ok:false, error }
   ============================================================ */
import { NextResponse } from 'next/server';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'ongeldige body' }, { status: 400 }); }

  const to = (body.to || '').trim();
  const vendor = (body.vendor || 'leverancier').trim();
  const ref = body.invoice_number ? String(body.invoice_number).trim() : '';
  const kind = body.kind === 'statement' ? 'statement' : 'invoice';

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'geen geldig e-mailadres' }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: 'Mailversturen is nog niet geconfigureerd (RESEND_API_KEY ontbreekt).' }, { status: 503 });
  }
  const from = process.env.ORDER_FLOW_FROM || 'Building Depot <no-reply@building-depot.net>';

  const refNL = ref ? ` met referentie ${ref}` : '';
  const refEN = ref ? ` (ref ${ref})` : '';

  const bodyNL = kind === 'statement'
    ? `Wij ontvingen een rekeningoverzicht (statement), maar om de betaling te kunnen verwerken hebben wij de onderliggende originele facturen nodig. Zou u die (bij voorkeur als PDF) willen sturen naar <a href="mailto:ap.invoices@building-depot.net">ap.invoices@building-depot.net</a>? Dan verwerken wij ze direct.`
    : `In onze administratie ontbreekt de onderliggende factuur${refNL}. Zou u de factuur (bij voorkeur als PDF) willen (her)sturen naar <a href="mailto:ap.invoices@building-depot.net">ap.invoices@building-depot.net</a>? Dan verwerken wij hem direct.`;
  const bodyEN = kind === 'statement'
    ? `We received a statement of account, but in order to process payment we need the underlying original invoices. Could you please send them (preferably as PDF) to <a href="mailto:ap.invoices@building-depot.net">ap.invoices@building-depot.net</a> so we can process them right away?`
    : `We are missing the underlying invoice${refEN}. Could you please (re)send it (preferably as PDF) to <a href="mailto:ap.invoices@building-depot.net">ap.invoices@building-depot.net</a> so we can process it right away?`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1B3A5C;line-height:1.5">
    <p>Beste ${vendor},</p>
    <p>${bodyNL}</p>
    <p>Alvast bedankt.</p>
    <p>Met vriendelijke groet,<br/>Building Depot — Crediteurenadministratie</p>
    <hr style="border:none;border-top:1px solid #e4e8f0;margin:18px 0"/>
    <p>Dear ${vendor},</p>
    <p>${bodyEN}</p>
    <p>Thank you in advance.</p>
    <p>Kind regards,<br/>Building Depot — Accounts Payable</p>
  </div>`;
  const subject = kind === 'statement'
    ? `Verzoek: onderliggende facturen sturen / Request: underlying invoices`
    : `Verzoek: factuur (opnieuw) sturen${ref ? ` — ${ref}` : ''} / Request: (re)send invoice`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `mailprovider ${r.status}: ${t.slice(0, 200)}` }, { status: 502 });
    }
    const j = await r.json().catch(() => ({}));
    return NextResponse.json({ ok: true, id: j.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}