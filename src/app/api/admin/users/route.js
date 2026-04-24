/* ============================================================
   BESTAND: route.js (v2)
   KOPIEER NAAR: src/app/api/admin/users/route.js
   (vervang het bestaande route.js bestand)
   
   WIJZIGINGEN t.o.v. v1:
   - Nieuwe actie 'invite_user' toegevoegd
   - Gebruikt supabase.auth.admin.inviteUserByEmail() 
   - Maakt automatisch een profiel aan met rol, bedrijf, rapporten
   - Bestaande acties (reset_password, delete_user) blijven werken
   ============================================================ */
import { createClient } from '@supabase/supabase-js';

// Admin client with service role key (server-side only)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Regular client for auth verification
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function verifyAdmin(request) {
  var authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  var token = authHeader.replace('Bearer ', '');
  var { data } = await supabase.auth.getUser(token);
  if (!data || !data.user) return false;
  var { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', data.user.id).single();
  return profile && profile.role === 'admin';
}

export async function POST(request) {
  try {
    if (!(await verifyAdmin(request))) {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 401 });
    }

    var body = await request.json();
    var action = body.action;

    // ═══ INVITE NEW USER ═══
    if (action === 'invite_user') {
      var email = body.email;
      var fullName = body.fullName;
      var role = body.role;
      var department = body.department || null;
      var companyId = body.companyId || null;
      var allowedReports = body.allowedReports || [];

      if (!email || !fullName || !role) {
        return Response.json({ error: 'Missing required fields (email, fullName, role)' }, { status: 400 });
      }

      // Stap 1: Stuur de invite-mail via Supabase. Dit maakt automatisch 
      // een auth-user aan zonder wachtwoord en stuurt de invite-mail.
      var inviteResult = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: process.env.NEXT_PUBLIC_SITE_URL 
          ? process.env.NEXT_PUBLIC_SITE_URL + '/auth/welcome'
          : 'https://boomingsolutions.ai/auth/welcome',
      });

      if (inviteResult.error) {
        return Response.json({ error: inviteResult.error.message }, { status: 400 });
      }

      var newUserId = inviteResult.data && inviteResult.data.user ? inviteResult.data.user.id : null;
      if (!newUserId) {
        return Response.json({ error: 'Invite verzonden maar gebruiker-id niet ontvangen' }, { status: 500 });
      }

      // Stap 2: Maak het profiel aan in profiles tabel
      var profileResult = await supabaseAdmin.from('profiles').upsert({
        id: newUserId,
        email: email,
        full_name: fullName,
        role: role,
        department: department,
        company_id: companyId,
        allowed_reports: allowedReports,
        is_active: true,
        updated_at: new Date().toISOString(),
      });

      if (profileResult.error) {
        return Response.json({ 
          error: 'Invite verzonden maar profiel kon niet worden aangemaakt: ' + profileResult.error.message,
          userId: newUserId 
        }, { status: 500 });
      }

      return Response.json({ 
        success: true, 
        message: 'Uitnodiging verstuurd naar ' + email,
        userId: newUserId 
      });
    }

    // ═══ RESET PASSWORD ═══
    if (action === 'reset_password') {
      var userId = body.userId;
      var newPassword = body.newPassword;
      if (!userId || !newPassword) return Response.json({ error: 'Missing userId or newPassword' }, { status: 400 });
      if (newPassword.length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

      var { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, message: 'Password updated' });
    }

    // ═══ DELETE USER ═══
    if (action === 'delete_user') {
      var userId = body.userId;
      if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

      // Delete profile first
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      // Delete auth user
      var { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, message: 'User deleted' });
    }

    // ═══ RESEND INVITE (bonus: voor gebruikers die de mail kwijt zijn) ═══
    if (action === 'resend_invite') {
      var email = body.email;
      if (!email) return Response.json({ error: 'Missing email' }, { status: 400 });

      var result = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: process.env.NEXT_PUBLIC_SITE_URL 
          ? process.env.NEXT_PUBLIC_SITE_URL + '/auth/welcome'
          : 'https://boomingsolutions.ai/auth/welcome',
      });

      if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
      return Response.json({ success: true, message: 'Uitnodiging opnieuw verstuurd' });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin users API error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
