/* ============================================================
   BESTAND: page_admin_v4.js
   KOPIEER NAAR: src/app/dashboard/admin/users/page.js
   (vervang het bestaande page.js bestand)
   
   WIJZIGINGEN t.o.v. v3:
   - Wachtwoord-veld verwijderd uit "Nieuwe Gebruiker" formulier
   - handleCreate gebruikt nu /api/admin/users invite_user actie
   - Gebruiker krijgt een uitnodigingsmail i.p.v. direct account
   - Knop tekst aangepast naar "Uitnodiging versturen"
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

/* ── Report definitions (nog steeds hardcoded, rollen komen uit DB) ── */
var REPORTS = [
  { id: 'sales', label: 'Omzet en Marge', group: 'Omzet', icon: '📊' },
  { id: 'sales_index', label: 'Index Rapport', group: 'Omzet', icon: '📈' },
  { id: 'sales_traffic', label: 'Bezoekers & Conversie', group: 'Omzet', icon: '👥' },
  { id: 'inventory_budget', label: 'Voorraad vs Budget', group: 'Voorraad', icon: '📦' },
  { id: 'inventory_buying', label: 'Inkoopvoorstel', group: 'Voorraad', icon: '🛒' },
  { id: 'inventory_negative', label: 'Negatieve Voorraad', group: 'Voorraad', icon: '⚠️' },
  { id: 'inventory_health', label: 'Gezondheid Voorraden', group: 'Voorraad', icon: '🏥' },
  { id: 'hr_payroll', label: 'Salariskosten', group: 'HR', icon: '💰' },
];

export default function AdminUsersPage() {
  var _u = useState([]), users = _u[0], setUsers = _u[1];
  var _c = useState([]), companies = _c[0], setCompanies = _c[1];
  var _rp = useState([]), rolePresets = _rp[0], setRolePresets = _rp[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _p = useState(null), profile = _p[0], setProfile = _p[1];
  var _msg = useState(null), msg = _msg[0], setMsg = _msg[1];
  var _tab = useState('users'), tab = _tab[0], setTab = _tab[1];

  // Create user (invite flow)
  var _showCreate = useState(false), showCreate = _showCreate[0], setShowCreate = _showCreate[1];
  var _newEmail = useState(''), newEmail = _newEmail[0], setNewEmail = _newEmail[1];
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

  // Role management
  var _editRolePreset = useState(null), editRolePreset = _editRolePreset[0], setEditRolePreset = _editRolePreset[1];
  var _rpId = useState(''), rpId = _rpId[0], setRpId = _rpId[1];
  var _rpLabel = useState(''), rpLabel = _rpLabel[0], setRpLabel = _rpLabel[1];
  var _rpDescription = useState(''), rpDescription = _rpDescription[0], setRpDescription = _rpDescription[1];
  var _rpReports = useState([]), rpReports = _rpReports[0], setRpReports = _rpReports[1];
  var _rpSortOrder = useState(100), rpSortOrder = _rpSortOrder[0], setRpSortOrder = _rpSortOrder[1];
  var _rpIsNew = useState(false), rpIsNew = _rpIsNew[0], setRpIsNew = _rpIsNew[1];
  var _savingRole = useState(false), savingRole = _savingRole[0], setSavingRole = _savingRole[1];
  var _deleteRole = useState(null), deleteRole = _deleteRole[0], setDeleteRole = _deleteRole[1];
  var _deletingRole = useState(false), deletingRole = _deletingRole[0], setDeletingRole = _deletingRole[1];

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
    var rp = await supabase.from('role_presets').select('*').order('sort_order');
    if (rp.data) setRolePresets(rp.data);
    setLoading(false);
  }

  function showMessage(text, type) {
    setMsg({ text: text, type: type || 'success' });
    setTimeout(function() { setMsg(null); }, 4000);
  }

  function getPreset(roleId) {
    return rolePresets.find(function(r) { return r.id === roleId; });
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

  // ═══ INVITE NEW USER (nieuwe flow via API route) ═══
  async function handleCreate() {
    if (!newEmail || !newName) { 
      showMessage('Vul naam en e-mail in', 'error'); 
      return; 
    }
    // Basis e-mail validatie
    var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(newEmail)) {
      showMessage('Voer een geldig e-mailadres in', 'error');
      return;
    }

    setCreating(true);

    var preset = getPreset(newRole);
    var defaultReports = preset ? preset.reports : ['sales'];

    var result = await adminApiCall('invite_user', {
      email: newEmail,
      fullName: newName,
      role: newRole,
      department: newDept || null,
      companyId: newCompanyId || null,
      allowedReports: defaultReports,
    });

    if (result && result.success) {
      showMessage('Uitnodigingsmail verstuurd naar ' + newEmail);
      setNewEmail(''); setNewName(''); setNewRole('viewer'); setNewDept('');
      setShowCreate(false);
      await loadData();
    }

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
    var preset = getPreset(role);
    if (preset) setEditReports(preset.reports.slice());
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
    var result = await supabase.from('profiles').update({
      full_name: editName,
      role: editRole,
      department: editDept,
      company_id: editCompanyId || null,
      is_active: editActive,
      allowed_reports: editReports,
      updated_at: new Date().toISOString(),
    }).eq('id', editUser.id);
    if (result.error) {
      showMessage('Fout bij opslaan: ' + result.error.message, 'error');
    } else {
      showMessage('Profiel van ' + editName + ' bijgewerkt');
      setEditUser(null);
      await loadData();
    }
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

  // ═══ ROLE MANAGEMENT FUNCTIES ═══

  function startEditRole(role) {
    setEditRolePreset(role);
    setRpId(role.id);
    setRpLabel(role.label || '');
    setRpDescription(role.description || '');
    setRpReports(role.reports || []);
    setRpSortOrder(role.sort_order || 100);
    setRpIsNew(false);
  }

  function startNewRole() {
    setEditRolePreset({});
    setRpId('');
    setRpLabel('');
    setRpDescription('');
    setRpReports([]);
    var maxSort = rolePresets.reduce(function(m, r) { return Math.max(m, r.sort_order || 0); }, 0);
    setRpSortOrder(maxSort + 10);
    setRpIsNew(true);
  }

  function toggleRpReport(reportId) {
    setRpReports(function(prev) {
      if (prev.indexOf(reportId) >= 0) return prev.filter(function(r) { return r !== reportId; });
      return prev.concat([reportId]);
    });
  }

  async function handleSaveRole() {
    if (!rpId.trim()) { showMessage('Rol-id is verplicht', 'error'); return; }
    if (!rpLabel.trim()) { showMessage('Label is verplicht', 'error'); return; }

    var idPattern = /^[a-z0-9_]+$/;
    if (!idPattern.test(rpId)) {
      showMessage('Rol-id mag alleen kleine letters, cijfers en underscores bevatten', 'error');
      return;
    }

    setSavingRole(true);

    if (rpIsNew) {
      var exists = rolePresets.find(function(r) { return r.id === rpId; });
      if (exists) {
        showMessage('Een rol met id "' + rpId + '" bestaat al', 'error');
        setSavingRole(false);
        return;
      }
      var insertResult = await supabase.from('role_presets').insert({
        id: rpId,
        label: rpLabel,
        description: rpDescription,
        reports: rpReports,
        sort_order: rpSortOrder,
        is_system: false,
      });
      if (insertResult.error) {
        showMessage('Fout bij aanmaken: ' + insertResult.error.message, 'error');
        setSavingRole(false);
        return;
      }
      showMessage('Nieuwe rol "' + rpLabel + '" aangemaakt');
    } else {
      var updateResult = await supabase.from('role_presets').update({
        label: rpLabel,
        description: rpDescription,
        reports: rpReports,
        sort_order: rpSortOrder,
        updated_at: new Date().toISOString(),
      }).eq('id', editRolePreset.id);
      if (updateResult.error) {
        showMessage('Fout bij opslaan: ' + updateResult.error.message, 'error');
        setSavingRole(false);
        return;
      }
      showMessage('Rol "' + rpLabel + '" bijgewerkt');
    }

    setEditRolePreset(null);
    await loadData();
    setSavingRole(false);
  }

  async function handleDeleteRole() {
    if (!deleteRole) return;
    setDeletingRole(true);

    var usersWithRole = users.filter(function(u) { return u.role === deleteRole.id; });
    if (usersWithRole.length > 0) {
      showMessage('Kan niet verwijderen: ' + usersWithRole.length + ' gebruiker(s) hebben deze rol', 'error');
      setDeletingRole(false);
      setDeleteRole(null);
      return;
    }

    var result = await supabase.from('role_presets').delete().eq('id', deleteRole.id);
    if (result.error) {
      showMessage('Fout bij verwijderen: ' + result.error.message, 'error');
    } else {
      showMessage('Rol "' + deleteRole.label + '" verwijderd');
      await loadData();
    }
    setDeleteRole(null);
    setDeletingRole(false);
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

  function getRoleStyle(roleId) {
    if (roleColors[roleId]) return roleColors[roleId];
    var preset = getPreset(roleId);
    var label = preset ? (preset.id.charAt(0).toUpperCase() + preset.id.slice(1)) : roleId;
    return { bg: 'bg-slate-50', text: 'text-slate-600', label: label };
  }

  var companyName = function(cid) {
    var c = companies.find(function(co) { return co.id === cid; });
    return c ? c.short_name || c.name : '—';
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
        <div className="flex gap-2">
          {tab === 'roles' && (
            <button onClick={startNewRole} className="px-5 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:bg-[#163048]">+ Nieuwe Rol</button>
          )}
          {tab === 'users' && (
            <button onClick={function() { setShowCreate(true); }} className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold hover:bg-[#d4431a]">+ Nieuwe Gebruiker</button>
          )}
        </div>
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
          {/* Invite User Form (geen wachtwoord meer) */}
          {showCreate && (
            <div className="bg-white rounded-[14px] border-2 border-[#E84E1B] p-5 mb-5 shadow-sm">
              <h3 className="text-[16px] font-bold mb-1">Nieuwe Gebruiker Uitnodigen</h3>
              <p className="text-[12px] text-[#6b5240] mb-4">De gebruiker ontvangt een uitnodigingsmail en stelt zelf zijn wachtwoord in</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
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
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol</label>
                  <select value={newRole} onChange={function(e) { handleNewRoleChange(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                    {rolePresets.map(function(r) { return <option key={r.id} value={r.id}>{r.label}</option>; })}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Afdeling</label>
                  <input value={newDept} onChange={function(e) { setNewDept(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" placeholder="bv. inkoop, finance (optioneel)" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] text-[#6b5240] font-bold uppercase">Bedrijf</label>
                  <select value={newCompanyId} onChange={function(e) { setNewCompanyId(e.target.value); }}
                    className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]">
                    {companies.map(function(c) { return <option key={c.id} value={c.id}>{c.name}</option>; })}
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-[10px] text-[#6b5240] font-bold uppercase mb-2 block">Standaard rapporten voor {newRole}</label>
                <div className="flex flex-wrap gap-2">
                  {REPORTS.map(function(rep) {
                    var preset = getPreset(newRole);
                    var presetReports = preset ? preset.reports : ['sales'];
                    var active = presetReports.indexOf(rep.id) >= 0;
                    return <span key={rep.id} className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ' + (active ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400')}>{rep.icon} {rep.label}</span>;
                  })}
                </div>
                <p className="text-[10px] text-[#a08a74] mt-1">Na aanmaken kun je de rapporttoegang per gebruiker aanpassen</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-[12px] text-blue-800">
                  <strong>📧 Uitnodigingsmail wordt verstuurd:</strong> De gebruiker krijgt een e-mail met een eenmalige link om zijn wachtwoord in te stellen. De link verloopt na 24 uur.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreate} disabled={creating}
                  className="px-5 py-2.5 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold disabled:opacity-50">
                  {creating ? 'Versturen...' : '📧 Uitnodiging Versturen'}
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
                    var rc = getRoleStyle(u.role);
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
              {rolePresets.map(function(preset) {
                var rc = getRoleStyle(preset.id);
                var userCount = users.filter(function(u) { return u.role === preset.id; }).length;
                return (
                  <div key={preset.id} className="flex items-start gap-4 p-3 rounded-xl bg-[#faf7f4]">
                    <div className="w-[140px] flex-shrink-0">
                      <span className={'inline-block px-3 py-1 rounded-full text-[12px] font-semibold ' + rc.bg + ' ' + rc.text}>{rc.label}</span>
                      {preset.is_system && (
                        <p className="text-[9px] text-[#a08a74] mt-1 uppercase tracking-wider font-semibold">Systeem</p>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-[12px] text-[#6b5240] mb-2">{preset.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {REPORTS.map(function(rep) {
                          var active = (preset.reports || []).indexOf(rep.id) >= 0;
                          return <span key={rep.id} className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold ' + (active ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-gray-50 text-gray-400 border border-gray-200')}>{rep.icon} {rep.label}</span>;
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <div className="text-[12px] font-mono text-[#6b5240]">
                        {userCount} users
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={function() { startEditRole(preset); }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#1B3A5C] bg-[#e8eff7] hover:bg-[#d5e2f0] transition-colors">Bewerken</button>
                        {!preset.is_system && (
                          <button onClick={function() { setDeleteRole(preset); }}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors">Verwijder</button>
                        )}
                      </div>
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
                  {rolePresets.map(function(r) { return <option key={r.id} value={r.id}>{r.label}</option>; })}
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

      {/* ═══ EDIT/NEW ROLE MODAL ═══ */}
      {editRolePreset && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={function() { setEditRolePreset(null); }}>
          <div className="bg-white rounded-2xl p-7 w-[560px] max-h-[90vh] overflow-y-auto shadow-2xl" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#1B3A5C] flex items-center justify-center">
                <span className="text-white text-lg">{rpIsNew ? '➕' : '✏️'}</span>
              </div>
              <div>
                <h3 className="text-[16px] font-bold">{rpIsNew ? 'Nieuwe Rol Aanmaken' : 'Rol Bewerken'}</h3>
                <p className="text-[12px] text-[#6b5240]">{rpIsNew ? 'Definieer een nieuwe rol met standaard rapporttoegang' : editRolePreset.id}</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Rol-ID {rpIsNew && '*'}</label>
                <input 
                  value={rpId} 
                  onChange={function(e) { setRpId(e.target.value.toLowerCase()); }}
                  disabled={!rpIsNew}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C] disabled:bg-[#faf7f4] disabled:text-[#a08a74]"
                  placeholder="bv. inkoper, finance_lead" />
                <p className="text-[10px] text-[#a08a74] mt-1">
                  {rpIsNew 
                    ? 'Alleen kleine letters, cijfers en underscores. Kan later niet gewijzigd worden.' 
                    : 'De rol-ID kan niet gewijzigd worden na aanmaken'}
                </p>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Label *</label>
                <input value={rpLabel} onChange={function(e) { setRpLabel(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]"
                  placeholder="bv. Inkoper — Voorraad & bestellingen" />
                <p className="text-[10px] text-[#a08a74] mt-1">Wordt getoond in dropdowns en overzichten</p>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Beschrijving</label>
                <textarea value={rpDescription} onChange={function(e) { setRpDescription(e.target.value); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]"
                  rows={2}
                  placeholder="Optionele toelichting bij de rol" />
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase">Volgorde</label>
                <input 
                  type="number" 
                  value={rpSortOrder} 
                  onChange={function(e) { setRpSortOrder(parseInt(e.target.value) || 0); }}
                  className="w-full mt-1 px-3 py-2.5 border border-[#e5ddd4] rounded-lg text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
                <p className="text-[10px] text-[#a08a74] mt-1">Lager = eerder in de lijst (admin=10, viewer=50)</p>
              </div>
              <div>
                <label className="text-[10px] text-[#6b5240] font-bold uppercase mb-2 block">Standaard Rapporttoegang</label>
                <div className="space-y-1.5">
                  {REPORTS.map(function(rep) {
                    var active = rpReports.indexOf(rep.id) >= 0;
                    return (
                      <label key={rep.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#faf7f4] cursor-pointer">
                        <input type="checkbox" checked={active} onChange={function() { toggleRpReport(rep.id); }}
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
              {!rpIsNew && editRolePreset.is_system && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[11px] text-amber-700 font-semibold">ℹ️ Systeem-rol</p>
                  <p className="text-[11px] text-amber-600 mt-1">Deze rol kan niet verwijderd worden, maar je kunt het label, de beschrijving en de rapporttoegang wel aanpassen.</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setEditRolePreset(null); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleSaveRole} disabled={savingRole} className="flex-1 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold disabled:opacity-50">
                {savingRole ? 'Opslaan...' : (rpIsNew ? 'Rol Aanmaken' : 'Opslaan')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DELETE ROLE MODAL ═══ */}
      {deleteRole && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={function() { setDeleteRole(null); }}>
          <div className="bg-white rounded-2xl p-7 w-[420px] shadow-2xl" onClick={function(e) { e.stopPropagation(); }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><span className="text-red-600 text-lg">⚠️</span></div>
              <div>
                <h3 className="text-[16px] font-bold text-red-600">Rol Verwijderen</h3>
                <p className="text-[12px] text-[#6b5240]">Deze actie kan niet ongedaan worden gemaakt</p>
              </div>
            </div>
            <div className="bg-red-50 rounded-xl p-4 mb-5">
              <p className="text-[13px] text-red-800">
                Weet je zeker dat je de rol <strong>{deleteRole.label}</strong> (<code className="text-[11px] bg-white px-1 py-0.5 rounded">{deleteRole.id}</code>) permanent wilt verwijderen?
              </p>
              {users.filter(function(u) { return u.role === deleteRole.id; }).length > 0 && (
                <p className="text-[11px] text-red-700 mt-2">
                  ⚠️ {users.filter(function(u) { return u.role === deleteRole.id; }).length} gebruiker(s) hebben momenteel deze rol. Wijs eerst een andere rol toe voordat je kunt verwijderen.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={function() { setDeleteRole(null); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
              <button onClick={handleDeleteRole} disabled={deletingRole} className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-[13px] font-semibold disabled:opacity-50">
                {deletingRole ? 'Verwijderen...' : 'Definitief Verwijderen'}
              </button>
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

      {/* ═══ DELETE USER MODAL ═══ */}
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
