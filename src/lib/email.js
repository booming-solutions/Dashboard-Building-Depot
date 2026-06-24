/* ============================================================
   BESTAND: email.js
   KOPIEER NAAR: src/lib/email.js   (NIEUW bestand)

   Centrale mailhelper (Resend). Eén plek voor afzender + provider,
   zodat later wisselen naar SendGrid/Postmark maar 1 bestand raakt.

   Vereiste env-vars (Vercel):
     RESEND_API_KEY        -> je Resend API key
     ORDER_FLOW_FROM       -> optioneel, default hieronder
   ============================================================ */
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.ORDER_FLOW_FROM || 'Building Depot <no-reply@building-depot.net>';

export async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY ontbreekt' };
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
