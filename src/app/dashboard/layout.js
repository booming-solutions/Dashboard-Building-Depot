/* ============================================================
   BESTAND: layout_dashboard.js
   KOPIEER NAAR: src/app/dashboard/layout.js
   (hernoem naar layout.js bij het plaatsen)
   VERSIE: v3.27.02
   ============================================================ */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const APP_VERSION = 'v3.27.02';

function NavDropdown({ icon, label, items, pathname, sidebarOpen }) {
  const isAnyActive = items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const [open, setOpen] = useState(isAnyActive);
  useEffect(() => { if (isAnyActive) setOpen(true); }, [isAnyActive]);

  if (!sidebarOpen) {
    return (
      <div className="relative group">
        <div className={`flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${isAnyActive ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
          <span className="text-base flex-shrink-0">{icon}</span>
        </div>
        <div className="absolute left-full top-0 ml-2 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[200px] hidden group-hover:block z-50">
          <p className="px-3 py-1.5 text-[10px] font-bold text-[#1B3A5C]/40 uppercase tracking-wider">{label}</p>
          {items.map(item => (
            <Link key={item.href} href={item.href} className={`block px-3 py-2 text-sm transition-all ${pathname === item.href ? 'bg-[#1B3A5C]/10 text-[#1B3A5C] font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-[#1B3A5C]'}`}>{item.label}</Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full ${isAnyActive ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
        <span className="text-base flex-shrink-0">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}><path d="M3 4.5L6 7.5L9 4.5" /></svg>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l-2 border-[#1B3A5C]/10 pl-3">
          {items.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${pathname === item.href ? 'bg-[#1B3A5C]/10 text-[#1B3A5C] font-semibold' : 'text-[#1B3A5C]/50 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: pathname === item.href ? '#1B3A5C' : 'transparent', border: pathname === item.href ? 'none' : '1px solid rgba(27,58,92,0.25)' }} />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginModal({ show, onClose, supabase, onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  if (!show) return null;

  async function handleLogin() {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else { onSuccess(); onClose(); setEmail(''); setPassword(''); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl p-7 w-[360px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#1B3A5C] flex items-center justify-center"><span className="text-white text-lg">🔑</span></div>
          <div><h3 className="text-[16px] font-bold text-[#1a0a04]">Inloggen</h3><p className="text-[12px] text-[#6b5240]">Administrator toegang</p></div>
        </div>
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
          className="w-full px-4 py-2.5 rounded-lg border border-[#e5ddd4] text-[14px] mb-3 focus:outline-none focus:border-[#1B3A5C]" placeholder="E-mailadres" autoFocus />
        <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} onKeyDown={e => e.key === 'Enter' && handleLogin()}
          className="w-full px-4 py-2.5 rounded-lg border border-[#e5ddd4] text-[14px] mb-2 focus:outline-none focus:border-[#1B3A5C]" placeholder="Wachtwoord" />
        {error && <p className="text-[12px] text-red-500 mb-2">{error}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={() => { onClose(); setEmail(''); setPassword(''); setError(''); }} className="flex-1 py-2.5 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
          <button onClick={handleLogin} disabled={loading} className="flex-1 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold disabled:opacity-50">{loading ? 'Laden...' : 'Inloggen'}</button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  const loadProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) {
        console.warn('Profile load failed, retrying in 1s...', error.message);
        // Retry once after a short delay (session might not be ready)
        setTimeout(async () => {
          const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single();
          if (retryData) {
            console.log('Profile loaded on retry:', retryData.role);
            setProfile(retryData);
          }
        }, 1000);
      } else {
        console.log('Profile loaded:', data.role);
        setProfile(data);
      }
    } catch (e) {
      console.error('Profile load error:', e);
    }
  }, [supabase]);

  useEffect(() => {
    async function init() {
      // First wait for the session to be established
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        await loadProfile(session.user.id);
      }

      // Listen for auth changes (login/logout)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          // Small delay to ensure session cookie is set for RLS
          setTimeout(() => loadProfile(session.user.id), 500);
        } else {
          setUser(null);
          setProfile(null);
        }
      });

      return () => subscription?.unsubscribe();
    }
    init();
  }, []);

  async function getUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
      await loadProfile(session.user.id);
    } else {
      setUser(null);
      setProfile(null);
    }
  }

  async function handleLogout() { await supabase.auth.signOut(); setUser(null); setProfile(null); router.push('/'); router.refresh(); }
  function handleRefresh() { setRefreshing(true); window.location.reload(); }

  const isAdmin = profile?.role === 'admin';

  const omzetItems = [
    { href: '/dashboard/sales', label: 'Omzet en Marge' },
    { href: '/dashboard/sales/index', label: 'Index Rapport' },
  ];
  const voorraadItems = [{ href: '/dashboard/inventory/budget', label: 'Voorraad vs Budget' }];
  const adminItems = [
    { href: '/dashboard/admin', label: 'Data Upload', icon: '⬆️' },
    { href: '/dashboard/admin/users', label: 'Gebruikersbeheer', icon: '👥' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <LoginModal show={showLogin} onClose={() => setShowLogin(false)} supabase={supabase} onSuccess={getUser} />

      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} flex flex-col transition-all duration-300 fixed h-full z-40`} style={{ background: 'linear-gradient(180deg, #e8eff7 0%, #dce6f1 100%)' }}>
        <div className="p-4 flex items-center gap-3 border-b border-[#c5d4e6]">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 flex-shrink-0 rounded-lg" />
          {sidebarOpen && <span className="font-bold text-[#1B3A5C] leading-tight" style={{ fontSize: '14px', letterSpacing: '0.02em', wordBreak: 'break-word', lineHeight: '1.2' }}>BOOMING SOLUTIONS</span>}
        </div>

        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          <div className="space-y-1">
            <Link href="/dashboard" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${pathname === '/dashboard' ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
              <span className="text-base flex-shrink-0">📊</span>{sidebarOpen && <span>Overzicht</span>}
            </Link>
            <NavDropdown icon="📈" label="Omzet" items={omzetItems} pathname={pathname} sidebarOpen={sidebarOpen} />
            <NavDropdown icon="📦" label="Voorraad" items={voorraadItems} pathname={pathname} sidebarOpen={sidebarOpen} />
            <Link href="/dashboard/reports" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${pathname === '/dashboard/reports' ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
              <span className="text-base flex-shrink-0">📋</span>{sidebarOpen && <span>Rapportages</span>}
            </Link>
            <Link href="/dashboard/files" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${pathname === '/dashboard/files' ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
              <span className="text-base flex-shrink-0">📁</span>{sidebarOpen && <span>Bestanden</span>}
            </Link>
          </div>
          {isAdmin && (
            <div className="mt-6 pt-4 border-t border-[#c5d4e6]">
              {sidebarOpen && <p className="text-[10px] text-[#1B3A5C]/40 uppercase tracking-wider font-semibold px-3 mb-2">Admin</p>}
              <div className="space-y-1">
                {adminItems.map(item => (
                  <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'}`}>
                    <span className="text-base flex-shrink-0">{item.icon}</span>{sidebarOpen && <span>{item.label}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="border-t border-[#c5d4e6]">
          <div className="p-4">
            {user ? (
              <>
                {sidebarOpen && <div className="mb-2"><p className="text-xs text-[#1B3A5C]/70 truncate">{profile?.full_name || user.email?.split('@')[0]}</p><p className="text-[10px] text-[#1B3A5C]/40">{profile?.role || 'laden...'}</p></div>}
                <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-[#1B3A5C]/50 hover:text-[#1B3A5C] transition-colors w-full"><span>🚪</span>{sidebarOpen && <span>Uitloggen</span>}</button>
              </>
            ) : (
              <button onClick={() => setShowLogin(true)} className="flex items-center gap-2.5 text-sm text-[#1B3A5C] transition-all w-full px-2 py-2 rounded-lg bg-white/60 hover:bg-white border border-[#c5d4e6] hover:border-[#1B3A5C]/30 shadow-sm">
                <span className="w-7 h-7 rounded-lg bg-[#1B3A5C] flex items-center justify-center flex-shrink-0"><span className="text-white text-xs">🔑</span></span>
                {sidebarOpen && <span className="font-semibold text-[13px]">Inloggen</span>}
              </button>
            )}
          </div>
          {sidebarOpen && <div className="px-4 pb-3"><p className="text-[10px] text-[#1B3A5C]/30 font-mono">{APP_VERSION}</p></div>}
        </div>
      </aside>

      <main className={`flex-1 ${sidebarOpen ? 'ml-64' : 'ml-20'} transition-all duration-300`}>
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-[#1B3A5C] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <div className="flex items-center gap-3">
            <button onClick={handleRefresh} disabled={refreshing} title="Ververs data" className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#1B3A5C] bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full font-medium transition-all disabled:opacity-50">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
              <span className="hidden sm:inline">{refreshing ? 'Verversen...' : 'Ververs'}</span>
            </button>
            {isAdmin && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-medium">Admin</span>}
            <span className="text-xs bg-green-50 text-green-600 px-3 py-1 rounded-full font-medium">Online</span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>

      <div style={{ position: 'fixed', bottom: 0, left: sidebarOpen ? '256px' : '80px', right: 0, background: 'linear-gradient(135deg, #152238 0%, #1B2E4A 100%)', borderTop: '1px solid rgba(75,163,212,0.15)', padding: '10px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', zIndex: 100, transition: 'left 0.3s' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
        <span style={{ fontSize: '11px', color: '#64748B', letterSpacing: '0.06em', fontFamily: 'monospace' }}>VERGRENDELD</span>
        <span style={{ fontSize: '10px', color: '#475569', margin: '0 8px' }}>·</span>
        <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace' }}>© 2026 Booming Solutions</span>
        <span style={{ fontSize: '10px', color: '#475569', margin: '0 8px' }}>·</span>
        <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace' }}>{APP_VERSION}</span>
      </div>
    </div>
  );
}
