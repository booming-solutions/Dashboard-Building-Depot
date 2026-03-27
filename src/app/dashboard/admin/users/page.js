'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

const DASHBOARDS = [
  { id: 'fin-overview', name: 'Financieel Overzicht', icon: '📊', color: '#0EA5E9' },
  { id: 'budget-2026', name: 'Budget 2026', icon: '💰', color: '#10B981' },
  { id: 'cashflow', name: 'Cashflow Analyse', icon: '💵', color: '#8B5CF6' },
  { id: 'kpi', name: 'KPI Dashboard', icon: '🎯', color: '#F59E0B' },
  { id: 'inventory', name: 'Inventory & Voorraad', icon: '📦', color: '#EF4444' },
  { id: 'hr', name: 'HR & Personeelszaken', icon: '👥', color: '#EC4899' },
];

const ROLES = ['Administrator', 'Manager', 'Controller', 'Analist', 'HR Manager', 'Viewer'];

const INITIAL_USERS = [
  { id: 1, name: 'Maria Constancia', email: 'm.constancia@buildingdepot.cw', role: 'Manager', dashboards: ['fin-overview', 'budget-2026', 'cashflow'], status: 'active', lastLogin: '2026-03-25' },
  { id: 2, name: 'Ricardo Martina', email: 'r.martina@buildingdepot.cw', role: 'Analist', dashboards: ['kpi', 'inventory'], status: 'active', lastLogin: '2026-03-26' },
  { id: 3, name: 'Sandra Willems', email: 's.willems@buildingdepot.cw', role: 'HR Manager', dashboards: ['hr'], status: 'active', lastLogin: '2026-03-20' },
  { id: 4, name: 'Johan de Groot', email: 'j.degroot@buildingdepot.an', role: 'Controller', dashboards: ['fin-overview', 'budget-2026', 'cashflow', 'kpi'], status: 'invited', lastLogin: null },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState(INITIAL_USERS);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Viewer', dashboards: [] });
  const [toast, setToast] = useState(null);
  const [view, setView] = useState('users');
  const [selectedDashboard, setSelectedDashboard] = useState(null);
  const [profile, setProfile] = useState(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function checkAdmin() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(data);
        if (data?.role !== 'admin') {
          router.push('/dashboard');
        }
      } else {
        router.push('/login');
      }
    }
    checkAdmin();
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleDashboard = (userId, dashId) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const has = u.dashboards.includes(dashId);
      return { ...u, dashboards: has ? u.dashboards.filter(d => d !== dashId) : [...u.dashboards, dashId] };
    }));
    showToast('Toegangsrechten bijgewerkt');
  };

  const addUser = () => {
    if (!newUser.name || !newUser.email) return;
    setUsers(prev => [...prev, { ...newUser, id: Date.now(), status: 'invited', lastLogin: null }]);
    setNewUser({ name: '', email: '', role: 'Viewer', dashboards: [] });
    setShowAddModal(false);
    showToast(`Uitnodiging verstuurd naar ${newUser.email}`);
  };

  const removeUser = (id) => {
    setUsers(prev => prev.filter(u => u.id !== id));
    setSelectedUser(null);
    showToast('Medewerker verwijderd', 'warn');
  };

  const dashboardUsers = selectedDashboard ? users.filter(u => u.dashboards.includes(selectedDashboard)) : [];

  if (profile && profile.role !== 'admin') return null;

  return (
    <div style={{ paddingBottom: '60px', fontFamily: "'Outfit', 'Segoe UI', sans-serif" }}>
      {/* Titel */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1B3A5C', margin: '0 0 4px 0' }}>
          Login Medewerkers
        </h1>
        <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
          Beheer toegangsrechten per medewerker en dashboard
        </p>
      </div>

      {/* View Toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', background: '#f1f5f9', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        {[{ id: 'users', label: '👤 Medewerkers' }, { id: 'dashboards', label: '📊 Per Dashboard' }].map(v => (
          <button key={v.id} onClick={() => { setView(v.id); setSelectedDashboard(null); setSelectedUser(null); }}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: view === v.id ? '#1B3A5C' : 'transparent',
              color: view === v.id ? '#ffffff' : '#64748B',
              fontSize: '13px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
            }}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Totaal', value: users.length, accent: '#1B3A5C' },
          { label: 'Actief', value: users.filter(u => u.status === 'active').length, accent: '#10B981' },
          { label: 'Uitgenodigd', value: users.filter(u => u.status === 'invited').length, accent: '#F59E0B' },
          { label: 'Dashboards', value: DASHBOARDS.length, accent: '#8B5CF6' },
        ].map((s, i) => (
          <div key={i} style={{
            background: '#ffffff', border: '1px solid #e2e8f0',
            borderRadius: '12px', padding: '16px 18px', borderLeft: `4px solid ${s.accent}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: s.accent }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search + Add */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}>🔍</span>
          <input type="text" placeholder="Zoek op naam of e-mail..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '12px 16px 12px 42px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#ffffff', color: '#1B3A5C', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button onClick={() => setShowAddModal(true)}
          style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', background: '#1B3A5C', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(27,58,92,0.2)' }}>
          + Medewerker Toevoegen
        </button>
      </div>

      {/* ═══ MEDEWERKERS WEERGAVE ═══ */}
      {view === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedUser ? '1fr 380px' : '1fr', gap: '20px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', color: '#94A3B8', display: 'grid', gridTemplateColumns: '1fr 140px 110px 70px', gap: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              <span>Medewerker</span><span>Rol</span><span>Status</span><span>Toegang</span>
            </div>
            {filteredUsers.map(user => (
              <div key={user.id} onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}
                style={{
                  padding: '14px 20px', borderBottom: '1px solid #f8fafc',
                  display: 'grid', gridTemplateColumns: '1fr 140px 110px 70px', gap: '12px',
                  alignItems: 'center', cursor: 'pointer', transition: 'background 0.15s',
                  background: selectedUser?.id === user.id ? '#f0f7ff' : 'transparent',
                }}
                onMouseEnter={(e) => { if (selectedUser?.id !== user.id) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { if (selectedUser?.id !== user.id) e.currentTarget.style.background = selectedUser?.id === user.id ? '#f0f7ff' : 'transparent'; }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#1B3A5C', marginBottom: '2px' }}>{user.name}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>{user.email}</div>
                </div>
                <div style={{ fontSize: '13px', color: '#64748B' }}>{user.role}</div>
                <span style={{
                  padding: '3px 10px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                  background: user.status === 'active' ? '#ecfdf5' : user.status === 'invited' ? '#fffbeb' : '#fef2f2',
                  color: user.status === 'active' ? '#059669' : user.status === 'invited' ? '#D97706' : '#DC2626',
                  border: `1px solid ${user.status === 'active' ? '#a7f3d0' : user.status === 'invited' ? '#fde68a' : '#fecaca'}`,
                  width: 'fit-content',
                }}>
                  {user.status === 'active' ? 'Actief' : user.status === 'invited' ? 'Uitgenodigd' : 'Uit'}
                </span>
                <div style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>
                  {user.dashboards.length}/{DASHBOARDS.length}
                </div>
              </div>
            ))}
            {filteredUsers.length === 0 && <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8' }}>Geen medewerkers gevonden</div>}
          </div>

          {/* Detail panel */}
          {selectedUser && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 700, color: '#1B3A5C', marginBottom: '3px' }}>{selectedUser.name}</div>
                  <div style={{ fontSize: '12px', color: '#94A3B8' }}>{selectedUser.email}</div>
                </div>
                <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '18px' }}>✕</button>
              </div>

              <select value={selectedUser.role} onChange={(e) => {
                const r = e.target.value;
                setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, role: r } : u));
                setSelectedUser(p => ({ ...p, role: r }));
                showToast('Rol bijgewerkt');
              }}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1B3A5C', fontSize: '13px', marginBottom: '20px' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              <div style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', fontWeight: 600 }}>Dashboard Toegang</div>
              {DASHBOARDS.map(db => {
                const has = selectedUser.dashboards.includes(db.id);
                return (
                  <div key={db.id} onClick={() => {
                    toggleDashboard(selectedUser.id, db.id);
                    setSelectedUser(p => ({ ...p, dashboards: has ? p.dashboards.filter(d => d !== db.id) : [...p.dashboards, db.id] }));
                  }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '9px 14px', borderRadius: '10px', marginBottom: '5px', cursor: 'pointer',
                      background: has ? '#f0f7ff' : '#f8fafc',
                      border: `1px solid ${has ? '#bfdbfe' : '#f1f5f9'}`,
                      transition: 'all 0.15s',
                    }}>
                    <div style={{ width: '34px', height: '18px', borderRadius: '9px', background: has ? db.color : '#e2e8f0', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: has ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
                    </div>
                    <span style={{ fontSize: '14px' }}>{db.icon}</span>
                    <span style={{ fontSize: '13px', fontWeight: has ? 600 : 400, color: has ? '#1B3A5C' : '#94A3B8' }}>{db.name}</span>
                  </div>
                );
              })}

              <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '8px' }}>
                <button onClick={() => {
                  const ns = selectedUser.status === 'active' ? 'disabled' : 'active';
                  setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, status: ns } : u));
                  setSelectedUser(p => ({ ...p, status: ns }));
                  showToast('Status bijgewerkt');
                }}
                  style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid #fde68a', background: '#fffbeb', color: '#D97706', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  {selectedUser.status === 'active' ? 'Deactiveren' : 'Activeren'}
                </button>
                <button onClick={() => removeUser(selectedUser.id)}
                  style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#DC2626', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  Verwijderen
                </button>
              </div>
              {selectedUser.lastLogin && (
                <div style={{ marginTop: '10px', fontSize: '10px', color: '#94A3B8', textAlign: 'center' }}>
                  Laatste login: {selectedUser.lastLogin}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ DASHBOARDS WEERGAVE ═══ */}
      {view === 'dashboards' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {DASHBOARDS.map(db => {
              const count = users.filter(u => u.dashboards.includes(db.id)).length;
              return (
                <div key={db.id} onClick={() => setSelectedDashboard(db.id)}
                  style={{
                    padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
                    background: selectedDashboard === db.id ? '#f0f7ff' : '#ffffff',
                    border: `1px solid ${selectedDashboard === db.id ? '#bfdbfe' : '#e2e8f0'}`,
                    borderLeft: `4px solid ${db.color}`, transition: 'all 0.15s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
                    <span>{db.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#1B3A5C' }}>{db.name}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', paddingLeft: '26px' }}>
                    {count} medewerker{count !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {selectedDashboard ? (
              <>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#1B3A5C', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {DASHBOARDS.find(d => d.id === selectedDashboard)?.icon}
                  {DASHBOARDS.find(d => d.id === selectedDashboard)?.name}
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '18px' }}>Medewerkers met toegang</div>
                {dashboardUsers.map(user => (
                  <div key={user.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderRadius: '10px', marginBottom: '5px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#1B3A5C' }}>{user.name}</div>
                      <div style={{ fontSize: '11px', color: '#94A3B8' }}>{user.email}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '11px', color: '#94A3B8' }}>{user.role}</span>
                      <button onClick={() => toggleDashboard(user.id, selectedDashboard)}
                        style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fef2f2', color: '#DC2626', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                        Verwijderen
                      </button>
                    </div>
                  </div>
                ))}
                {dashboardUsers.length === 0 && <div style={{ padding: '28px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>Geen medewerkers</div>}

                <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: '10px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 600 }}>Snel Toevoegen</div>
                  {users.filter(u => !u.dashboards.includes(selectedDashboard)).map(user => (
                    <div key={user.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 14px', borderRadius: '8px', marginBottom: '3px', border: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: '12px', color: '#64748B' }}>{user.name}</span>
                      <button onClick={() => toggleDashboard(user.id, selectedDashboard)}
                        style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #a7f3d0', background: '#ecfdf5', color: '#059669', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}>
                        + Toegang
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '180px', color: '#94A3B8', fontSize: '13px' }}>← Selecteer een dashboard</div>
            )}
          </div>
        </div>
      )}

      {/* ═══ MODAL ═══ */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowAddModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '32px', width: '420px', maxWidth: '90vw', boxShadow: '0 24px 64px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#1B3A5C', marginBottom: '24px' }}>Nieuwe Medewerker</div>
            {[{ label: 'Naam', value: newUser.name, key: 'name', ph: 'Volledige naam' }, { label: 'E-mailadres', value: newUser.email, key: 'email', ph: 'naam@buildingdepot.cw' }].map(f => (
              <div key={f.key} style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 600 }}>{f.label}</label>
                <input type={f.key === 'email' ? 'email' : 'text'} value={f.value} onChange={e => setNewUser(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1B3A5C', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 600 }}>Rol</label>
              <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1B3A5C', fontSize: '14px', boxSizing: 'border-box' }}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', fontWeight: 600 }}>Dashboard Toegang</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                {DASHBOARDS.map(db => {
                  const sel = newUser.dashboards.includes(db.id);
                  return (
                    <div key={db.id} onClick={() => setNewUser(p => ({ ...p, dashboards: sel ? p.dashboards.filter(d => d !== db.id) : [...p.dashboards, db.id] }))}
                      style={{ padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11px', background: sel ? '#f0f7ff' : '#f8fafc', border: `1px solid ${sel ? '#bfdbfe' : '#e2e8f0'}`, color: sel ? '#1B3A5C' : '#94A3B8', fontWeight: sel ? 600 : 400, transition: 'all 0.15s' }}>
                      <span>{db.icon}</span><span>{db.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowAddModal(false)} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'transparent', color: '#64748B', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>Annuleren</button>
              <button onClick={addUser} disabled={!newUser.name || !newUser.email}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: 'none', background: '#1B3A5C', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(27,58,92,0.2)', opacity: !newUser.name || !newUser.email ? 0.4 : 1 }}>
                Uitnodiging Versturen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '60px', right: '24px', zIndex: 2000, padding: '10px 18px', borderRadius: '10px', background: toast.type === 'warn' ? '#DC2626' : '#059669', color: '#fff', fontSize: '13px', fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
