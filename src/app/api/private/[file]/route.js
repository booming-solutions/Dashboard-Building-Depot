/* ============================================================
   BESTAND: route.js
   KOPIEER NAAR: src/app/api/private/[file]/route.js
   (maak de hele map-structuur aan)

   Beveiligde API-route die HTML-bestanden serveert uit de
   private/ map (buiten public/) alleen aan gebruikers die:
   - Een geldige Supabase-sessie hebben
   - Admin zijn, OF de juiste report-key in allowed_reports

   ROUTING:
   /api/private/salary-dashboard  → check 'hr_payroll'      → private/salary-dashboard.html
   /api/private/uren-dashboard    → check 'hr_urentarget'   → private/uren-dashboard.html
   /api/private/booming-installatie        → 'finance_prepay' → private/booming-installatie.zip (download)
   /api/private/werkinstructie-vooruitbetalingen → 'finance_prepay' → private/werkinstructie-vooruitbetalingen.html

   Een bestand mag als string (html, oude vorm) of als object
   { report, file, type, download } in FILE_PERMISSIONS staan.

   Niet-ingelogd          → 401
   Ingelogd zonder rechten → 403
   Verkeerde bestandsnaam  → 404
   ============================================================ */
import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Whitelist van toegestane bestanden + bijbehorende report-key
const FILE_PERMISSIONS = {
  'salary-dashboard': 'hr_payroll',
  'uren-dashboard': 'hr_urentarget',
  // Booming (Eagle-koppeling vooruitbetalingen): installatiepakket + werkinstructie
  'booming-installatie': { report: 'finance_prepay', file: 'booming-installatie.zip', type: 'application/zip', download: 'booming-installatie.zip' },
  'werkinstructie-vooruitbetalingen': { report: 'finance_prepay', file: 'werkinstructie-vooruitbetalingen.html', type: 'text/html; charset=utf-8' },
};

export async function GET(request, { params }) {
  try {
    const fileKey = params.file;

    // 1) Whitelist-check: alleen bekende bestanden toestaan
    if (!Object.prototype.hasOwnProperty.call(FILE_PERMISSIONS, fileKey)) {
      return new NextResponse('Not Found', { status: 404 });
    }
    const entry = FILE_PERMISSIONS[fileKey];
    const spec = typeof entry === 'string'
      ? { report: entry, file: `${fileKey}.html`, type: 'text/html; charset=utf-8' }
      : entry;
    const requiredReport = spec.report;

    // 2) Sessie-check
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // 3) Profiel + rechten check
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, allowed_reports')
      .eq('id', session.user.id)
      .single();

    if (profileError || !profile) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const isAdmin = profile.role === 'admin';
    const allowed = Array.isArray(profile.allowed_reports)
      ? profile.allowed_reports
      : [];
    if (!isAdmin && !allowed.includes(requiredReport)) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // 4) Lees bestand uit private/ map (buiten public/)
    const filePath = path.join(process.cwd(), 'private', spec.file);
    const inhoud = await readFile(filePath);

    // 5) Stuur met beveiligings-headers (html inline, andere types als download)
    return new NextResponse(inhoud, {
      status: 200,
      headers: {
        'Content-Type': spec.type,
        ...(spec.download ? { 'Content-Disposition': `attachment; filename="${spec.download}"` } : {}),
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self';",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    });
  } catch (err) {
    console.error('[api/private] error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
