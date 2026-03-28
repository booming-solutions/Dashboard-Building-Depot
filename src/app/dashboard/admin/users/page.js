/* ============================================================
   BESTAND: page_admin_users.js
   KOPIEER NAAR: src/app/dashboard/admin/users/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [msg, setMsg] = useState(null);

  // Create form
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [newDept, setNewDept] = useState('');
  const [newCompany, setNewCompany] = useState('Building Depot');
  const [creating, setCreating] = useState(false);

  // Edit form
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(p);
    }
    const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (profiles) setUsers(profiles);
    setLoading(false);
  }

  function showMsg(text, type = 'success') {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleCreate() {
    if (!newEmail || !newPassword || !newName) { showMsg('Vul alle verplichte velden in', 'error'); return; }
    if (newPassword.length < 6) { showMsg('Wachtwoord moet minimaal 6 tekens zijn', 'error'); return; }
    setCreating(true);

    // Create auth user via Supabase Admin API (edge function needed for production)
    // For now we use signUp which creates the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: newEmail,
      password: newPassword,
      options: { data: { full_name: newName } }
    });

    if (authError) {
      showMsg('Fout bij aanmaken: ' + authError.message, 'error');
      setCreating(false);
      return;
    }

    if (authData?.user) {
      // Update/insert the profile
      const { error: profError } = await supabase.from('profiles').upsert({
        id: authData.user.id,
        email: newEmail,
        full_name: newName,
        role: newRole,
        department: newDept,
        company: newCompany,
        is_active: true,
        updated_at: new Date().toISOString(),
      });

      if (profError) {
        showMsg('Gebruiker aangemaakt maar profiel fout: ' + profError.message, 'error');
      } else {
        showMsg(`Gebruiker ${newName} aangemaakt`);
        setNewEmail(''); setNewPassword(''); setNewName(''); setNewRole('viewer'); setNewDept(''); setNewCompany('Building Depot');
        setShowCreate(false);
      }
    }

    // Re-login as admin (signUp may have changed the session)
    await loadData();
    setCreating(false);
  }

  function startEdit(u) {
    setEditUser(u);
    setEditName(u.full_name || '');
    setEditRole(u.role || 'viewer');
    setEditDept(u.department || '');
    setEditCompany(u.company || '');
    setEditActive(u.is_active !== false);
  }

  async function handleSave() {
    if (!editUser) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      full_name: editName,
      role: editRole,
      department: editDept,
      company: editCompany,
      is_active: editActive,
      updated_at: new Date().toISOString(),
    }).eq('id', editUser.id);

    if (error) { showMsg('Fout bij opslaan: ' + error.message, 'error'); }
    else { showMsg(`Profiel van ${editName} bijgewerkt`); setEditUser(null); }
    await loadData();
    setSaving(false);
  }

  async function toggleActive(u) {
    const newState = !u.is_active;
    await supabase.from('profiles').update({ is_active: newState, updated_at: new Date().toISOString() }).eq('id', u.id);
    showMsg(`${u.full_name} ${newState ? 'geactiveerd' : 'gedeactiveerd'}`);
    await loadData();
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Admin Panel laden...</p></div>;

  if (profile?.role !== 'admin') {
    return (
      <div className="max-w-[800px] mx-auto mt-16 text-center">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-10 shadow-sm">
          <p className="text-[40px] mb-4">🔒</p>
          <h2 className="text-[20px] font-bold text-[#1a0a04] mb-2">Geen Toegang</h2>
          <p className="text-[14px] text-[#6b5240]">Je hebt admin-rechten nodig om het gebruikersbeheer te openen.</p>
        </div>
      </div>
    );
  }

  const roleColors = {
    admin: { bg: 'bg-red-50', text: 'text-red-600', label: 'Admin' },
    manager: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Manager' },
    viewer: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Viewer' },
  };

  return (
    <div className="max-w-[1200px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>

      {/* Toast message */}
      {msg && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-[14px] font-semibold ${msg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 mb-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#1B3A5C] flex items-center justify-center"><span className="text-white text-2xl">👥</span></div>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: '24px', fontWeight: 900 }}>Gebruikersbeheer</h1>
            <p className="text-[13px] text-[#6b5240]">{users.length} gebruiker{users.length !== 1 ? 's' : ''} geregistreerd</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold hover:bg-[#d4441a] transition-colors flex items-center gap-2">
          <span className="text-lg">+</span> Nieuwe Gebruiker
        </button>
      </div>

      {/* Create User Form */}
      {showCreate && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] border-l-4 border-l-[#E84E1B] p-6 mb-5 shadow-sm">
          <h3 className="text-[16px] font-bold mb-4">Nieuwe Gebruiker Aanmaken</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">Volledige naam *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Jan de Vries" />
            </div>
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">E-mailadres *</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="jan@boomingsolutions.nl" />
            </div>
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">Wachtwoord *</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Min. 6 tekens" />
            </div>
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                <option value="viewer">Viewer — Alleen bekijken</option>
                <option value="manager">Manager — Dashboard + exports</option>
                <option value="admin">Admin — Volledige toegang</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">Afdeling</label>
              <input value={newDept} onChange={e => setNewDept(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="bv. finance, operations" />
            </div>
            <div>
              <label className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijf</label>
              <input value={newCompany} onChange={e => setNewCompany(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Building Depot" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} disabled={creating}
              className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold disabled:opacity-50">
              {creating ? 'Aanmaken...' : '+ Gebruiker Aanmaken'}
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-5 py-2.5 rounded-lg bg-white text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">
              Annuleren
            </button>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-2xl p-7 w-[440px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C] flex items-center justify-center"><span className="text-white text-lg">✏️</span></div>
              <div><h3 className="text-[16px] font-bold">Profiel Bewerken</h3><p className="text-[12px] text-[#6b5240]">{editUser.email}</p></div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Naam</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                  <option value="viewer">Viewer</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Afdeling</label>
                <input value={editDept} onChange={e => setEditDept(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijf</label>
                <input value={editCompany} onChange={e => setEditCompany(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Actief</label>
                <button onClick={() => setEditActive(!editActive)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${editActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${editActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-[12px] text-[#6b5240]">{editActive ? 'Gebruiker kan inloggen' : 'Toegang geblokkeerd'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditUser(null)} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold disabled:opacity-50">{saving ? 'Opslaan...' : 'Opslaan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
        <h3 className="text-[15px] font-bold mb-4">Alle Gebruikers</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Naam', 'E-mail', 'Rol', 'Afdeling', 'Bedrijf', 'Status', 'Aangemaakt', 'Acties'].map(h => (
                  <th key={h} className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const rc = roleColors[u.role] || roleColors.viewer;
                return (
                  <tr key={u.id} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{u.full_name || '—'}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{u.email}</td>
                    <td className="p-2.5 border-b border-[#e5ddd4]">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${rc.bg} ${rc.text}`}>{rc.label}</span>
                    </td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{u.department || '—'}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{u.company || '—'}</td>
                    <td className="p-2.5 border-b border-[#e5ddd4]">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${u.is_active !== false ? 'text-green-600' : 'text-red-500'}`}>
                        <span className={`w-2 h-2 rounded-full ${u.is_active !== false ? 'bg-green-500' : 'bg-red-400'}`} />
                        {u.is_active !== false ? 'Actief' : 'Inactief'}
                      </span>
                    </td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240] whitespace-nowrap">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="p-2.5 border-b border-[#e5ddd4]">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(u)}
                          className="px-3 py-1 rounded-lg text-[12px] font-semibold text-[#1B3A5C] bg-[#e8eff7] hover:bg-[#d5e2f0] transition-colors">
                          Bewerken
                        </button>
                        <button onClick={() => toggleActive(u)}
                          className={`px-3 py-1 rounded-lg text-[12px] font-semibold transition-colors ${u.is_active !== false ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-green-600 bg-green-50 hover:bg-green-100'}`}>
                          {u.is_active !== false ? 'Deactiveer' : 'Activeer'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <p className="text-[10px] text-[#6b5240] font-bold uppercase">Totaal Gebruikers</p>
          <p className="text-[28px] font-bold font-mono mt-1">{users.length}</p>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <p className="text-[10px] text-[#6b5240] font-bold uppercase">Actieve Gebruikers</p>
          <p className="text-[28px] font-bold font-mono mt-1 text-green-600">{users.filter(u => u.is_active !== false).length}</p>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <p className="text-[10px] text-[#6b5240] font-bold uppercase">Admins</p>
          <p className="text-[28px] font-bold font-mono mt-1 text-red-600">{users.filter(u => u.role === 'admin').length}</p>
        </div>
      </div>
    </div>
  );
}
