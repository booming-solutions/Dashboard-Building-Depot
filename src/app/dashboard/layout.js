'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

function NavDropdown({ icon, label, items, pathname, sidebarOpen }) {
  const isAnyActive = items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const [open, setOpen] = useState(isAnyActive);

  useEffect(() => {
    if (isAnyActive) setOpen(true);
  }, [isAnyActive]);

  if (!sidebarOpen) {
    return (
      <div className="relative group">
        <div className={`flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
          isAnyActive ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'
        }`}>
          <span className="text-base flex-shrink-0">{icon}</span>
        </div>
        <div className="absolute left-full top-0 ml-2 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[200px] hidden group-hover:block z-50">
          <p className="px-3 py-1.5 text-[10px] font-bold text-[#1B3A5C]/40 uppercase tracking-wider">{label}</p>
          {items.map(item => (
            <Link key={item.href} href={item.href}
              className={`block px-3 py-2 text-sm transition-all ${
                pathname === item.href ? 'bg-[#1B3A5C]/10 text-[#1B3A5C] font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-[#1B3A5C]'
              }`}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all w-full ${
          isAnyActive ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'
        }`}>
        <span className="text-base flex-shrink-0">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l-2 border-[#1B3A5C]/10 pl-3">
          {items.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                pathname === item.href ? 'bg-[#1B3A5C]/10 text-[#1B3A5C] font-semibold' : 'text-[#1B3A5C]/50 hover:text-[#1B3A5C] hover:bg-white/50'
              }`}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{
                backgroundColor: pathname === item.href ? '#1B3A5C' : 'transparent',
                border: pathname === item.href ? 'none' : '1px solid rgba(27,58,92,0.25)'
              }} />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(data);
      }
    }
    getUser();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  const simpleNavItems = [
    { href: '/dashboard', label: 'Overzicht', icon: '📊' },
  ];

  const omzetItems = [
    { href: '/dashboard/sales', label: 'Omzet en Marge' },
  ];

  const voorraadItems = [
    { href: '/dashboard/inventory/budget', label: 'Voorraad vs Budget' },
  ];

  const bottomNavItems = [
    { href: '/dashboard/reports', label: 'Rapportages', icon: '📋' },
    { href: '/dashboard/files', label: 'Bestanden', icon: '📁' },
  ];

  const adminItems = [
    { href: '/dashboard/admin', label: 'Data Upload', icon: '⬆️' },
    { href: '/dashboard/admin/users', label: 'Admin Panel', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} flex flex-col transition-all duration-300 fixed h-full z-40`} style={{background:'linear-gradient(180deg, #e8eff7 0%, #dce6f1 100%)'}}>
        
        {/* Logo */}
        <div className="p-4 flex items-center gap-3 border-b border-[#c5d4e6]">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 flex-shrink-0 rounded-lg" />
          {sidebarOpen && (
            <span className="font-bold text-[#1B3A5C] leading-tight"
              style={{ fontSize: '14px', letterSpacing: '0.02em', wordBreak: 'break-word', lineHeight: '1.2' }}>
              BOOMING SOLUTIONS
            </span>
          )}
        </div>

        {/* Navigatie */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          <div className="space-y-1">
            {/* Overzicht */}
            {simpleNavItems.map((item) => (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  pathname === item.href ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'
                }`}>
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            ))}

            {/* Omzet dropdown */}
            <NavDropdown icon="📈" label="Omzet" items={omzetItems} pathname={pathname} sidebarOpen={sidebarOpen} />

            {/* Voorraad dropdown */}
            <NavDropdown icon="📦" label="Voorraad" items={voorraadItems} pathname={pathname} sidebarOpen={sidebarOpen} />

            {/* Rapportages & Bestanden */}
            {bottomNavItems.map((item) => (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  pathname === item.href ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'
                }`}>
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            ))}
          </div>

          {/* Admin sectie */}
          {profile?.role === 'admin' && (
            <div className="mt-6 pt-4 border-t border-[#c5d4e6]">
              {sidebarOpen && <p className="text-[10px] text-[#1B3A5C]/40 uppercase tracking-wider font-semibold px-3 mb-2">Admin</p>}
              <div className="space-y-1">
                {adminItems.map((item) => (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      pathname === item.href || pathname.startsWith(item.href + '/') ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50'
                    }`}>
                    <span className="text-base flex-shrink-0">{item.icon}</span>
                    {sidebarOpen && <span>{item.label}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Gebruiker info */}
        <div className="p-4 border-t border-[#c5d4e6]">
          {sidebarOpen && user && (
            <div className="mb-2">
              <p className="text-xs text-[#1B3A5C]/70 truncate">{profile?.full_name || user.email?.split('@')[0]}</p>
              <p className="text-[10px] text-[#1B3A5C]/40">{profile?.role || 'user'}</p>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-[#1B3A5C]/50 hover:text-[#1B3A5C] transition-colors">
            <span>🚪</span>
            {sidebarOpen && <span>Uitloggen</span>}
          </button>
        </div>
      </aside>

      {/* Hoofdinhoud */}
      <main className={`flex-1 ${sidebarOpen ? 'ml-64' : 'ml-20'} transition-all duration-300`}>
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-[#1B3A5C] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <div className="flex items-center gap-4">
            {profile?.role === 'admin' && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-medium">Admin</span>}
            <span className="text-xs bg-green-50 text-green-600 px-3 py-1 rounded-full font-medium">Online</span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>

      {/* Voettekst */}
      <div style={{
        position: 'fixed', bottom: 0,
        left: sidebarOpen ? '256px' : '80px', right: 0,
        background: 'linear-gradient(135deg, #152238 0%, #1B2E4A 100%)',
        borderTop: '1px solid rgba(75,163,212,0.15)',
        padding: '10px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        zIndex: 100, transition: 'left 0.3s',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <span style={{ fontSize: '11px', color: '#64748B', letterSpacing: '0.06em', fontFamily: 'monospace' }}>VERGRENDELD</span>
        <span style={{ fontSize: '10px', color: '#475569', margin: '0 8px' }}>·</span>
        <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace' }}>© 2026 Booming Solutions</span>
      </div>
    </div>
  );
}
