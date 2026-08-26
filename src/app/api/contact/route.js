/* ============================================================
   BESTAND: src/app/api/contact/route.js

   Het contactformulier op de homepage postte al naar /api/contact,
   maar die route bestond niet. Elke inzending liep daardoor op een
   404 en de bezoeker kreeg "Er ging iets mis" te zien.

   Deze route gebruikt de REST-API van Resend rechtstreeks via fetch,
   zodat er GEEN nieuwe npm-dependency bij komt (het pakket `resend`
   staat niet in package.json).

   Env-vars in Vercel:
     RESEND_API_KEY   verplicht — anders kan er niets verstuurd worden
     CONTACT_INBOX    waar algemene aanvragen heen gaan
     TRAINING_INBOX   optioneel — aparte inbox voor taaltraining
     CONTACT_FROM     optioneel — afzender. Standaard noreply@boomingsolutions.ai,
                      hetzelfde geverifieerde domein dat de dagelijkse omzetmail
                      (src/app/api/cron/daily-report) al gebruikt.

   Controleren of het goed staat: open https://www.boomingsolutions.ai/api/contact
   in je browser. Die GET verklapt geen sleutels, alleen of ze gezet zijn.
   ============================================================ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTACT_INBOX = process.env.CONTACT_INBOX || '';
const TRAINING_INBOX = process.env.TRAINING_INBOX || CONTACT_INBOX;
const FROM =
  process.env.CONTACT_FROM ||
  'Booming Solutions <noreply@boomingsolutions.ai>';

const MAX = { name: 200, email: 200, company: 200, message: 5000 };

function clean(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Alleen het domein tonen, zodat het adres niet publiek op straat ligt. */
function mask(address) {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  return at === -1 ? '***' : `***@${address.slice(at + 1)}`;
}

/**
 * Statuscheck voor in de browser. Geeft nooit de API-sleutel of het volledige
 * e-mailadres terug — alleen of de instellingen aanwezig zijn.
 */
export async function GET() {
  const missing = [];
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!CONTACT_INBOX) missing.push('CONTACT_INBOX');

  return Response.json({
    gereed: missing.length === 0,
    ontbreekt: missing,
    afzender: FROM,
    afzenderIsTestdomein: FROM.includes('resend.dev'),
    contactInbox: mask(CONTACT_INBOX),
    trainingInbox: mask(TRAINING_INBOX),
    let_op: FROM.includes('resend.dev')
      ? 'Met onboarding@resend.dev kan Resend alleen mailen naar het e-mailadres van je eigen Resend-account. Zet CONTACT_FROM op een adres van een geverifieerd domein.'
      : undefined,
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Ongeldige aanvraag' }, { status: 400 });
  }

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email);
  const company = clean(body.company, MAX.company);
  const message = clean(body.message, MAX.message);
  const topic = body.topic === 'training' ? 'training' : 'algemeen';

  if (!name || !email || !message) {
    return Response.json({ error: 'Naam, e-mailadres en bericht zijn verplicht' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return Response.json({ error: 'Ongeldig e-mailadres' }, { status: 400 });
  }

  const to = topic === 'training' ? TRAINING_INBOX : CONTACT_INBOX;
  const subject =
    topic === 'training'
      ? `[Taaltraining] Aanvraag van ${name}`
      : `[Website] Bericht van ${name}`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#1B3A5C;line-height:1.6">
      <p style="margin:0 0 16px;font-weight:600">
        Nieuw bericht via boomingsolutions.ai${topic === 'training' ? ' — taaltraining' : ''}
      </p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr><td style="padding:2px 16px 2px 0;color:#6b7280">Naam</td><td>${escapeHtml(name)}</td></tr>
        <tr><td style="padding:2px 16px 2px 0;color:#6b7280">E-mail</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        ${company ? `<tr><td style="padding:2px 16px 2px 0;color:#6b7280">Bedrijf</td><td>${escapeHtml(company)}</td></tr>` : ''}
      </table>
      <p style="margin:20px 0 6px;color:#6b7280">Bericht</p>
      <div style="white-space:pre-wrap;padding:14px 16px;background:#f6f7f9;border-radius:10px">${escapeHtml(message)}</div>
    </div>
  `;

  // Nooit stilzwijgend weggooien: wat er misgaat, gaat altijd eerst de log in.
  const logboek = { topic, name, email, company, message };

  if (!process.env.RESEND_API_KEY || !to) {
    console.error(
      '[contact] Niet verstuurd — ontbrekende configuratie:',
      { RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY), to: Boolean(to) },
      logboek
    );
    return Response.json({ error: 'E-mail is niet geconfigureerd' }, { status: 503 });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: email, subject, html }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('[contact] Resend gaf een fout:', res.status, detail, logboek);
      return Response.json({ error: 'Versturen mislukt' }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error('[contact] Onverwachte fout:', e?.message, logboek);
    return Response.json({ error: 'Versturen mislukt' }, { status: 500 });
  }
}
