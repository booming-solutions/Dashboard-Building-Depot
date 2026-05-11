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
};

export async function GET(request, { params }) {
  try {
    const fileKey = params.file;

    // 1) Whitelist-check: alleen bekende bestanden toestaan
    if (!Object.prototype.hasOwnProperty.call(FILE_PERMISSIONS, fileKey)) {
      return new NextResponse('Not Found', { status: 404 });
    }
    const requiredReport = FILE_PERMISSIONS[fileKey];

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
    const filePath = path.join(process.cwd(), 'private', `${fileKey}.html`);
    const html = await readFile(filePath, 'utf-8');

    // 5) Stuur HTML met beveiligings-headers
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
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
