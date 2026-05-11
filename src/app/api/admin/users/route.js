/* ============================================================
   BESTAND: route.js (v4)
   KOPIEER NAAR: src/app/api/admin/users/route.js
   (vervang het bestaande route.js bestand)
   
   WIJZIGING t.o.v. v3:
   - Supabase clients worden nu binnen de functies aangemaakt
     (lazy initialization), niet bij module-load. Dit voorkomt
     dat Next.js bij de build-stap probeert de clients te maken
     zonder env vars beschikbaar.
   - Functionaliteit identiek aan v3.
   
   WIJZIGINGEN t.o.v. v2:
   - Nieuwe actie 'create_user' toegevoegd
   - Maakt account direct aan met tijdelijk wachtwoord
   - Geeft credentials terug aan de admin (geen mail)
   - Zet must_change_password = true op het profiel
   ============================================================ */
import { createClient } from '@supabase/supabase-js';

// Force dynamic — anders probeert Next.js dit bij build te evalueren
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function verifyAdmin(request) {
  var authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  var token = authHeader.replace('Bearer ', '');
  var supabase = getAnonClient();
  var supabaseAdmin = getAdminClient();
  var { data } = await supabase.auth.getUser(token);
  if (!data || !data.user) return false;
  var { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', data.user.id).single();
  return profile && profile.role === 'admin';
}

// Genereer een sterk tijdelijk wachtwoord van 12 tekens
function generateTempPassword() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var symbols = '!@#$%&*';
  var pw = '';
  for (var i = 0; i < 10; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  for (var j = 0; j < 2; j++) {
    pw += symbols.charAt(Math.floor(Math.random() * symbols.length));
  }
  return pw.split('').sort(function() { return 0.5 - Math.random(); }).join('');
}

export async function POST(request) {
  try {
    if (!(await verifyAdmin(request))) {
      return Response.json({ error: 'Unauthorized - admin only' }, { status: 401 });
    }

    var supabaseAdmin = getAdminClient();
    var body = await request.json();
    var action = body.action;

    if (action === 'create_user') {
      var email = body.email;
      var fullName = body.fullName;
      var role = body.role;
      var department = body.department || null;
      var companyId = body.companyId || null;
      var allowedReports = body.allowedReports || [];

      if (!email || !fullName || !role) {
        return Response.json({ error: 'Missing required fields (email, fullName, role)' }, { status: 400 });
      }

      var tempPassword = generateTempPassword();

      var createResult = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createResult.error) {
        return Response.json({ error: createResult.error.message }, { status: 400 });
      }

      var newUserId = createResult.data && createResult.data.user ? createResult.data.user.id : null;
      if (!newUserId) {
        return Response.json({ error: 'Account aangemaakt maar gebruiker-id niet ontvangen' }, { status: 500 });
      }

      var profileResult = await supabaseAdmin.from('profiles').upsert({
        id: newUserId,
        email: email,
        full_name: fullName,
        role: role,
        department: department,
        company_id: companyId,
        allowed_reports: allowedReports,
        is_active: true,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      });

      if (profileResult.error) {
        return Response.json({ 
          error: 'Account aangemaakt maar profiel kon niet worden opgeslagen: ' + profileResult.error.message,
          userId: newUserId 
        }, { status: 500 });
      }

      return Response.json({ 
        success: true, 
        message: 'Account aangemaakt voor ' + email,
        userId: newUserId,
        email: email,
        tempPassword: tempPassword,
      });
    }

    if (action === 'regenerate_password') {
      var userId = body.userId;
      if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

      var newTempPassword = generateTempPassword();

      var updateResult = await supabaseAdmin.auth.admin.updateUserById(userId, { 
        password: newTempPassword 
      });
      if (updateResult.error) return Response.json({ error: updateResult.error.message }, { status: 400 });

      await supabaseAdmin.from('profiles').update({ 
        must_change_password: true,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      var profileLookup = await supabaseAdmin.from('profiles').select('email').eq('id', userId).single();
      var userEmail = profileLookup.data ? profileLookup.data.email : '';

      return Response.json({ 
        success: true, 
        message: 'Tijdelijk wachtwoord opnieuw gegenereerd',
        email: userEmail,
        tempPassword: newTempPassword,
      });
    }

    if (action === 'reset_password') {
      var userId = body.userId;
      var newPassword = body.newPassword;
      if (!userId || !newPassword) return Response.json({ error: 'Missing userId or newPassword' }, { status: 400 });
      if (newPassword.length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

      var { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) return Response.json({ error: error.message }, { status: 400 });

      await supabaseAdmin.from('profiles').update({ 
        must_change_password: true,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      return Response.json({ success: true, message: 'Password updated' });
    }

    if (action === 'delete_user') {
      var userId = body.userId;
      if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

      await supabaseAdmin.from('profiles').delete().eq('id', userId);
      var { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, message: 'User deleted' });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin users API error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
