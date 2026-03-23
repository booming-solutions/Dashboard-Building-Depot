'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

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

  const navItems = [
    { href: '/dashboard', label: 'Overzicht', icon: '📊' },
    { href: '/dashboard/sales', label: 'Sales', icon: '📈' },
    { href: '/dashboard/reports', label: 'Rapportages', icon: '📋' },
    { href: '/dashboard/files', label: 'Bestanden', icon: '📁' },
  ];

  const adminItems = [
    { href: '/dashboard/admin', label: 'Data Upload', icon: '⬆️' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-navy-deep text-white flex flex-col transition-all duration-300 fixed h-full z-40`}>
        <div className="p-4 flex items-center gap-3 border-b border-white/10">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 flex-shrink-0" />
          {sidebarOpen && <span className="font-display text-lg font-semibold truncate">Booming</span>}
        </div>

        <nav className="flex-1 py-4 px-3">
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  pathname === item.href ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}>
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            ))}
          </div>

          {profile?.role === 'admin' && (
            <div className="mt-6 pt-4 border-t border-white/10">
              {sidebarOpen && <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold px-3 mb-2">Admin</p>}
              <div className="space-y-1">
                {adminItems.map((item) => (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      pathname === item.href ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}>
                    <span className="text-base flex-shrink-0">{item.icon}</span>
                    {sidebarOpen && <span>{item.label}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-white/10">
          {sidebarOpen && user && (
            <div className="mb-2">
              <p className="text-xs text-white/60 truncate">{profile?.full_name || user.email?.split('@')[0]}</p>
              <p className="text-[10px] text-white/30">{profile?.role || 'user'}</p>
            </div>
          )}
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors">
            <span>🚪</span>
            {sidebarOpen && <span>Uitloggen</span>}
          </button>
        </div>
      </aside>

      <main className={`flex-1 ${sidebarOpen ? 'ml-64' : 'ml-20'} transition-all duration-300`}>
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-navy transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <div className="flex items-center gap-4">
            {profile?.role === 'admin' && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-medium">Admin</span>}
            <span className="text-xs bg-green-50 text-green-600 px-3 py-1 rounded-full font-medium">Online</span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
