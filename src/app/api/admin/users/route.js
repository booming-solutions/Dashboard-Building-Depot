/* ============================================================
   BESTAND: route.js
   KOPIEER NAAR: src/app/api/admin/users/route.js
   (maak de map admin/users aan onder api)
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

    if (action === 'reset_password') {
      var userId = body.userId;
      var newPassword = body.newPassword;
      if (!userId || !newPassword) return Response.json({ error: 'Missing userId or newPassword' }, { status: 400 });
      if (newPassword.length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

      var { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ success: true, message: 'Password updated' });
    }

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

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin users API error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
