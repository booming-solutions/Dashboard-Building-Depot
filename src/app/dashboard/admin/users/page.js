/* ============================================================
   BESTAND: page_admin_v2.js
   KOPIEER NAAR: src/app/dashboard/admin/users/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

/* ── Report definitions with role presets ── */
var REPORTS = [
  { id: 'sales', label: 'Omzet en Marge', group: 'Omzet', icon: '📊' },
  { id: 'sales_index', label: 'Index Rapport', group: 'Omzet', icon: '📈' },
  { id: 'inventory_budget', label: 'Voorraad vs Budget', group: 'Voorraad', icon: '📦' },
  { id: 'inventory_buying', label: 'Inkoopvoorstel', group: 'Voorraad', icon: '🛒' },
  { id: 'inventory_negative', label: 'Negatieve Voorraad', group: 'Voorraad', icon: '⚠️' },
  { id: 'inventory_health', label: 'Gezondheid Voorraden', group: 'Voorraad', icon: '🏥' },
];

var ROLE_PRESETS = {
  admin: { label: 'Admin — Volledige toegang', reports: REPORTS.map(function(r) { return r.id; }) },
  manager: { label: 'Manager — Dashboard + exports', reports: ['sales', 'sales_index', 'inventory_budget', 'inventory_buying', 'inventory_negative', 'inventory_health'] },
  buyer: { label: 'Buyer — Inkoop & voorraad', reports: ['inventory_budget', 'inventory_buying', 'inventory_negative', 'inventory_health'] },
  finance: { label: 'Finance — Omzet & marge', reports: ['sales', 'sales_index'] },
  viewer: { label: 'Viewer — Alleen basis', reports: ['sales'] },
};

var ROLES = Object.keys(ROLE_PRESETS);

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

export default function AdminUsersPage() {
  var _u = useState([]), users = _u[0], setUsers = _u[1];
  var _c = useState([]), companies = _c[0], setCompanies = _c[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _p = useState(null), profile = _p[0], setProfile = _p[1];
  var _msg = useState(null), msg = _msg[0], setMsg = _msg[1];
  var _tab = useState('users'), tab = _tab[0], setTab = _tab[1];

  // Create user
  var _showCreate = useState(false), showCreate = _showCreate[0], setShowCreate = _showCreate[1];
  var _newEmail = useState(''), newEmail = _newEmail[0], setNewEmail = _newEmail[1];
  var _newPassword = useState(''), newPassword = _newPassword[0], setNewPassword = _newPassword[1];
  var _newName = useState(''), newName = _newName[0], setNewName = _newName[1];
  var _newRole = useState('viewer'), newRole = _newRole[0], setNewRole = _newRole[1];
  var _newDept = useState(''), newDept = _newDept[0], setNewDept = _newDept[1];
  var _newCompanyId = useState(''), newCompanyId = _newCompanyId[0], setNewCompanyId = _newCompanyId[1];
  var _creating = useState(false), creating = _creating[0], setCreating = _creating[1];

  // Edit user
  var _editUser = useState(null), editUser = _editUser[0], setEditUser = _editUser[1];
  var _editName = useState(''), editName = _editName[0], setEditName = _editName[1];
  var _editRole = useState(''), editRole = _editRole[0], setEditRole = _editRole[1];
  var _editDept = useState(''), editDept = _editDept[0], setEditDept = _editDept[1];
  var _editCompanyId = useState(''), editCompanyId = _editCompanyId[0], setEditCompanyId = _editCompanyId[1];
  var _editActive = useState(true), editActive = _editActive[0], setEditActive = _editActive[1];
  var _editReports = useState([]), editReports = _editReports[0], setEditReports = _editReports[1];
  var _saving = useState(false), saving = _saving[0], setSaving = _saving[1];

  // Password reset
  var _resetUser = useState(null), resetUser = _resetUser[0], setResetUser = _resetUser[1];
  var _resetPw = useState(''), resetPw = _resetPw[0], setResetPw = _resetPw[1];
  var _resetPw2 = useState(''), resetPw2 = _resetPw2[0], setResetPw2 = _resetPw2[1];
  var _resetting = useState(false), resetting = _resetting[0], setResetting = _resetting[1];

  // Delete user
  var _deleteTarget = useState(null), deleteTarget = _deleteTarget[0], setDeleteTarget = _deleteTarget[1];
  var _deleting = useState(false), deleting = _deleting[0], setDeleting = _deleting[1];

  var supabase = createClient();

  useEffect(function() { loadData(); }, []);

  async function loadData() {
    var u = await supabase.auth.getUser();
    if (u.data && u.data.user) {
      var p = await supabase.from('profiles').select('*').eq('id', u.data.user.id).single();
      if (p.data) setProfile(p.data);
    }
    var pr = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (pr.data) setUsers(pr.data);
    var co = await supabase.from('companies').select('*').order('name');
    if (co.data) { setCompanies(co.data); if (co.data.length && !newCompanyId) setNewCompanyId(co.data[0].id); }
    setLoading(false);
  }

  function showMessage(text, type) {
    setMsg({ text: text, type: type || 'success' });
    setTimeout(function() { setMsg(null); }, 4000);
  }

  async function adminApiCall(action, body) {
    var s = await supabase.auth.getSession();
    if (!s.data || !s.data.session) { showMessage('Niet ingelogd', 'error'); return null; }
    var res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.data.session.access_token },
      body: JSON.stringify(Object.assign({ action: action }, body)),
    });
    var result = await res.json();
    if (!res.ok) { showMessage(result.error || 'Fout', 'error'); return null; }
    return result;
  }

  async function handleCreate() {
    if (!newEmail || !newPassword || !newName) { showMessage('Vul alle verplichte velden in', 'error'); return; }
    if (newPassword.length < 6) { showMessage('Wachtwoord moet minimaal 6 tekens zijn', 'error'); return; }
    setCreating(true);

    var authResult = await supabase.auth.signUp({ email: newEmail, password: newPassword, options: { data: { full_name: newName } } });
    if (authResult.error) { showMessage('Fout: ' + authResult.error.message, 'error'); setCreating(false); return; }

    if (authResult.data && authResult.data.user) {
      var defaultReports = ROLE_PRESETS[newRole] ? ROLE_PRESETS[newRole].reports : ['sales'];
      await supabase.from('profiles').upsert({
        id: authResult.data.user.id,
        email: newEmail,
        full_name: newName,
        role: newRole,
        department: newDept,
        company_id: newCompanyId || null,
        allowed_reports: defaultReports,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      showMessage('Gebruiker ' + newName + ' aangemaakt');
      setNewEmail(''); setNewPassword(''); setNewName(''); setNewRole('viewer'); setNewDept('');
      setShowCreate(false);
    }
    await loadData();
    setCreating(false);
  }

  function startEdit(u) {
    setEditUser(u);
    setEditName(u.full_name || '');
    setEditRole(u.role || 'viewer');
    setEditDept(u.department || '');
    setEditCompanyId(u.company_id || '');
    setEditActive(u.is_active !== false);
    setEditReports(u.allowed_reports || []);
  }

  function handleRoleChange(role) {
    setEditRole(role);
    if (ROLE_PRESETS[role]) setEditReports(ROLE_PRESETS[role].reports.slice());
  }

  function handleNewRoleChange(role) {
    setNewRole(role);
  }

  function toggleReport(reportId) {
    setEditReports(function(prev) {
      if (prev.indexOf(reportId) >= 0) return prev.filter(function(r) { return r !== reportId; });
      return prev.concat([reportId]);
    });
  }

  async function handleSave() {
    if (!editUser) return;
    setSaving(true);
    await supabase.from('profiles').update({
      full_name: editName,
      role: editRole,
      department: editDept,
      company_id: editCompanyId || null,
      is_active: editActive,
      allowed_reports: editReports,
      updated_at: new Date().toISOString(),
    }).eq('id', editUser.id);
    showMessage('Profiel van ' + editName + ' bijgewerkt');
    setEditUser(null);
    await loadData();
    setSaving(false);
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    if (!resetPw || resetPw.length < 6) { showMessage('Wachtwoord moet minimaal 6 tekens zijn', 'error'); return; }
    if (resetPw !== resetPw2) { showMessage('Wachtwoorden komen niet overeen', 'error'); return; }
    setResetting(true);
    var result = await adminApiCall('reset_password', { userId: resetUser.id, newPassword: resetPw });
    if (result) { showMessage('Wachtwoord van ' + resetUser.full_name + ' is gereset'); setResetUser(null); setResetPw(''); setResetPw2(''); }
    setResetting(false);
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleting(true);
    var result = await adminApiCall('delete_user', { userId: deleteTarget.id });
    if (result) { showMessage('Gebruiker ' + deleteTarget.full_name + ' is verwijderd'); setDeleteTarget(null); await loadData(); }
    setDeleting(false);
  }

  async function toggleActive(u) {
    var newState = !u.is_active;
    await supabase.from('profiles').update({ is_active: newState, updated_at: new Date().toISOString() }).eq('id', u.id);
    showMessage(u.full_name + (newState ? ' geactiveerd' : ' gedeactiveerd'));
    await loadData();
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Admin Panel laden...</p></div>;

  if (profile && profile.role !== 'admin') {
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

  var roleColors = {
    admin: { bg: 'bg-red-50', text: 'text-red-600', label: 'Admin' },
    manager: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Manager' },
    buyer: { bg: 'bg-purple-50', text: 'text-purple-600', label: 'Buyer' },
    finance: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Finance' },
    viewer: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Viewer' },
  };

  var companyName = function(cid) {
    var c = companies.find(function(co) { return co.id === cid; });
    return c ? c.short_name || c.name : '—';
  };

  var reportLabel = function(rid) {
    var r = REPORTS.find(function(rep) { return rep.id === rid; });
    return r ? r.label : rid;
  };

  return (
    <div className="max-w-[1200px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>

      {/* Message toast */}
      {msg && (
        <div className={'fixed top-4 right-4 z-[99] px-5 py-3 rounded-xl shadow-lg text-[13px] font-semibold ' + (msg.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white')}>{msg.text}</div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Gebruikersbeheer</h1>
          <p className="text-[13px] text-[#6b5240]">Beheer gebruikers, rollen en rapporttoegang</p>
        </div>
        <button onClick={function() { setShowCreate(true); }} className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold hover:bg-[#d4431a]">+ Nieuwe Gebruiker</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        {[['users', 'Gebruikers (' + users.length + ')'], ['roles', 'Rollen & Toegang']].map(function(item) {
          return <button key={item[0]} onClick={function() { setTab(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (tab === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
        })}
      </div>

      {/* ═══ USERS TAB ═══ */}
      {tab === 'users' && (
        <>
          {/* Create User Form */}
          {showCreate && (
            <div className="bg-white rounded-[14px] border-2 border-[#E84E1B] p-5 mb-5 shadow-sm">
              <h3 className="text-[16px] font-bold mb-4">Nieuwe Gebruiker Aanmaken</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Naam *</label>
                  <input value={newName} onChange={function(e) { setNewName(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Volledige naam" />
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">E-mail *</label>
                  <input type="email" value={newEmail} onChange={function(e) { setNewEmail(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="email@bedrijf.com" />
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Wachtwoord *</label>
                  <input type="password" value={newPassword} onChange={function(e) { setNewPassword(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Min. 6 tekens" />
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol</label>
                  <select value={newRole} onChange={function(e) { handleNewRoleChange(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                    {ROLES.map(function(r) { return <option key={r} value={r}>{ROLE_PRESETS[r].label}</option>; })}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Afdeling</label>
                  <input value={newDept} onChange={function(e) { setNewDept(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="bv. inkoop, finance" />
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijf</label>
                  <select value={newCompanyId} onChange={function(e) { setNewCompanyId(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                    {companies.map(function(c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-[10px] text-[#6b5240] font-bold uppercase mb-2 block">Standaard rapporten voor {ROLE_PRESETS[newRole] ? newRole : 'viewer'}</label>
                <div className="flex flex-wrap gap-2">
                  {REPORTS.map(function(rep) {
                    var preset = ROLE_PRESETS[newRole] ? ROLE_PRESETS[newRole].reports : ['sales'];
                    var active = preset.indexOf(rep.id) >= 0;
                    return <span key={rep.id} className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ' + (active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400')}>{rep.icon} {rep.label}</span>;
                  })}
                </div>
                <p className="text-[10px] text-[#a08a74] mt-1">Na aanmaken kun je de rapporttoegang per gebruiker aanpassen</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreate} disabled={creating}
                  className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold disabled:opacity-50">
                  {creating ? 'Aanmaken...' : '+ Gebruiker Aanmaken'}
                </button>
                <button onClick={function() { setShowCreate(false); }}
                  className="px-5 py-2.5 rounded-lg bg-white text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              </div>
            </div>
          )}

          {/* Users Table */}
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Naam', 'E-mail', 'Rol', 'Bedrijf', 'Rapporten', 'Status', 'Acties'].map(function(h) {
                      return <th key={h} className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white whitespace-nowrap">{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {users.map(function(u) {
                    var rc = roleColors[u.role] || roleColors.viewer;
                    var reports = u.allowed_reports || [];
                    return (
                      <tr key={u.id} className="hover:bg-[#faf5f0]">
                        <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{u.full_name || '—'}</td>
                        <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{u.email}</td>
                        <td className="p-2.5 border-b border-[#e5ddd4]">
                          <span className={'inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ' + rc.bg + ' ' + rc.text}>{rc.label}</span>
                        </td>
                        <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{companyName(u.company_id)}</td>
                        <td className="p-2.5 border-b border-[#e5ddd4]">
                          <div className="flex flex-wrap gap-1">
                            {reports.length > 0 ? reports.map(function(rid) {
                              var rep = REPORTS.find(function(r) { return r.id === rid; });
                              return rep ? <span key={rid} className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-600" title={rep.label}>{rep.icon}</span> : null;
                            }) : <span className="text-[11px] text-[#a08a74]">Geen</span>}
                          </div>
                        </td>
                        <td className="p-2.5 border-b border-[#e5ddd4]">
                          <span className={'inline-flex items-center gap-1.5 text-[12px] font-semibold ' + (u.is_active !== false ? 'text-green-600' : 'text-red-500')}>
                            <span className={'w-2 h-2 rounded-full ' + (u.is_active !== false ? 'bg-green-500' : 'bg-red-400')} />
                            {u.is_active !== false ? 'Actief' : 'Inactief'}
                          </span>
                        </td>
                        <td className="p-2.5 border-b border-[#e5ddd4]">
                          <div className="flex gap-1.5">
                            <button onClick={function() { startEdit(u); }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#1B3A5C] bg-[#e8eff7] hover:bg-[#d5e2f0] transition-colors">Bewerken</button>
                            <button onClick={function() { setResetUser(u); setResetPw(''); setResetPw2(''); }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 transition-colors">Wachtwoord</button>
                            <button onClick={function() { toggleActive(u); }}
                              className={'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ' + (u.is_active !== false ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-green-600 bg-green-50 hover:bg-green-100')}>
                              {u.is_active !== false ? 'Deactiveer' : 'Activeer'}
                            </button>
                            <button onClick={function() { setDeleteTarget(u); }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors">Verwijder</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <p className="text-[10px] text-[#6b5240] font-bold uppercase">Totaal</p>
              <p className="text-[28px] font-bold font-mono mt-1">{users.length}</p>
            </div>
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <p className="text-[10px] text-[#6b5240] font-bold uppercase">Actief</p>
              <p className="text-[28px] font-bold font-mono mt-1 text-green-600">{users.filter(function(u) { return u.is_active !== false; }).length}</p>
            </div>
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <p className="text-[10px] text-[#6b5240] font-bold uppercase">Admins</p>
              <p className="text-[28px] font-bold font-mono mt-1 text-red-600">{users.filter(function(u) { return u.role === 'admin'; }).length}</p>
            </div>
            <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
              <p className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijven</p>
              <p className="text-[28px] font-bold font-mono mt-1 text-[#1B3A5C]">{companies.length}</p>
            </div>
          </div>
        </>
      )}

      {/* ═══ ROLES TAB ═══ */}
      {tab === 'roles' && (
        <div className="space-y-4">
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[16px] font-bold mb-1">Rol Presets</h3>
            <p className="text-[13px] text-[#6b5240] mb-4">Bij het aanmaken van een gebruiker worden automatisch de rapporten van de geselecteerde rol toegekend. Je kunt daarna per gebruiker aanpassen.</p>
            <div className="space-y-3">
              {ROLES.map(function(role) {
                var preset = ROLE_PRESETS[role];
                var rc = roleColors[role] || roleColors.viewer;
                return (
                  <div key={role} className="flex items-start gap-4 p-3 rounded-xl bg-[#faf7f4]">
                    <div className="w-[140px] flex-shrink-0">
                      <span className={'inline-block px-3 py-1 rounded-full text-[12px] font-semibold ' + rc.bg + ' ' + rc.text}>{rc.label}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[12px] text-[#6b5240] mb-2">{preset.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {REPORTS.map(function(rep) {
                          var active = preset.reports.indexOf(rep.id) >= 0;
                          return <span key={rep.id} className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ' + (active ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-gray-50 text-gray-400 border border-gray-200')}>{rep.icon} {rep.label}</span>;
                        })}
                      </div>
                    </div>
                    <div className="text-[12px] font-mono text-[#6b5240] flex-shrink-0">
                      {users.filter(function(u) { return u.role === role; }).length} users
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
            <h3 className="text-[16px] font-bold mb-1">Beschikbare Rapporten</h3>
            <p className="text-[13px] text-[#6b5240] mb-4">Overzicht van alle rapporten in het dashboard</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {REPORTS.map(function(rep) {
                var usersWithAccess = users.filter(function(u) { return u.allowed_reports && u.allowed_reports.indexOf(rep.id) >= 0; });
                return (
                  <div key={rep.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#faf7f4]">
                    <span className="text-[20px]">{rep.icon}</span>
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold">{rep.label}</p>
                      <p className="text-[11px] text-[#6b5240]">{rep.group}</p>
                    </div>
                    <span className="text-[12px] font-mono text-[#6b5240]">{usersWithAccess.length} users</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT USER MODAL ═══ */}
      {editUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={function() { setEditUser(null); }}>
          <div className="bg-white rounded-2xl p-7 w-[520px] max-h-[90vh] overflow-y-auto shadow-2xl" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C] flex items-center justify-center"><span className="text-white text-lg">✏️</span></div>
              <div><h3 className="text-[16px] font-bold">Profiel Bewerken</h3><p className="text-[12px] text-[#6b5240]">{editUser.email}</p></div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Naam</label>
                <input value={editName} onChange={function(e) { setEditName(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol</label>
                <select value={editRole} onChange={function(e) { handleRoleChange(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                  {ROLES.map(function(r) { return <option key={r} value={r}>{ROLE_PRESETS[r].label}</option>; })}
                </select>
                <p className="text-[10px] text-[#a08a74] mt-1">Rol wijzigen past automatisch de rapporttoegang aan naar de standaard preset</p>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Afdeling</label>
                <input value={editDept} onChange={function(e) { setEditDept(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijf</label>
                <select value={editCompanyId} onChange={function(e) { setEditCompanyId(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                  <option value="">— Geen —</option>
                  {companies.map(function(c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase mb-2 block">Rapporttoegang</label>
                <div className="space-y-1.5">
                  {REPORTS.map(function(rep) {
                    var active = editReports.indexOf(rep.id) >= 0;
                    return (
                      <label key={rep.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#faf7f4] cursor-pointer">
                        <input type="checkbox" checked={active} onChange={function() { toggleReport(rep.id); }}
                          className="w-4 h-4 rounded border-[#e5ddd4] text-[#E84E1B] focus:ring-[#E84E1B]" />
                        <span className="text-[14px]">{rep.icon}</span>
                        <div className="flex-1">
                          <span className="text-[13px] font-semibold">{rep.label}</span>
                          <span className="text-[11px] text-[#a08a74] ml-2">{rep.group}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Actief</label>
                <button onClick={function() { setEditActive(!editActive); }}
                  className={'w-10 h-5 rounded-full transition-colors relative ' + (editActive ? 'bg-green-500' : 'bg-gray-300')}>
                  <div className={'w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ' + (editActive ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
                <span className="text-[12px] text-[#6b5240]">{editActive ? 'Gebruiker kan inloggen' : 'Toegang geblokkeerd'}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setEditUser(null); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold disabled:opacity-50">{saving ? 'Opslaan...' : 'Opslaan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PASSWORD RESET MODAL ═══ */}
      {resetUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={function() { setResetUser(null); }}>
          <div className="bg-white rounded-2xl p-7 w-[400px] shadow-2xl" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><span className="text-amber-600 text-lg">🔑</span></div>
              <div><h3 className="text-[16px] font-bold">Wachtwoord Resetten</h3><p className="text-[12px] text-[#6b5240]">{resetUser.full_name} — {resetUser.email}</p></div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Nieuw wachtwoord</label>
                <input type="password" value={resetPw} onChange={function(e) { setResetPw(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Min. 6 tekens" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Herhaal wachtwoord</label>
                <input type="password" value={resetPw2} onChange={function(e) { setResetPw2(e.target.value); }} onKeyDown={function(e) { if (e.key === 'Enter') handleResetPassword(); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="Herhaal wachtwoord" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setResetUser(null); setResetPw(''); setResetPw2(''); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleResetPassword} disabled={resetting} className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white text-[13px] font-semibold disabled:opacity-50">{resetting ? 'Resetten...' : 'Wachtwoord Resetten'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DELETE MODAL ═══ */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={function() { setDeleteTarget(null); }}>
          <div className="bg-white rounded-2xl p-7 w-[400px] shadow-2xl" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><span className="text-red-600 text-lg">⚠️</span></div>
              <div><h3 className="text-[16px] font-bold text-red-600">Gebruiker Verwijderen</h3><p className="text-[12px] text-[#6b5240]">Dit kan niet ongedaan worden gemaakt!</p></div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 mb-5">
              <p className="text-[13px] text-red-800">Weet je zeker dat je <strong>{deleteTarget.full_name}</strong> ({deleteTarget.email}) permanent wilt verwijderen?</p>
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setDeleteTarget(null); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleDeleteUser} disabled={deleting} className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-[13px] font-semibold disabled:opacity-50">{deleting ? 'Verwijderen...' : 'Definitief Verwijderen'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
