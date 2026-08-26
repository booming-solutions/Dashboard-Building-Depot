/* ============================================================
   BESTAND: layout.js
   LOCATIE: src/app/projects/layout.js
   Shell van de projectomgeving (boomingsolutions.ai/projects).

   Eigen ingang, los van /dashboard:
   - wie niet is ingelogd gaat naar /projects/login
   - wie geen 'projects' in profiles.apps heeft, krijgt geen toegang
   - interne gebruikers met ook 'dashboard' zien een wisselknop
   ============================================================ */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const PM_VERSION = 'PM V1.0';

const NAV = [
  { href: '/projects',        label: 'Projecten',    icon: '🏗️' },
  { href: '/projects/tasks',  label: 'Taken',        icon: '✅' },
];

const ADMIN_NAV = [
  { href: '/projects/admin/users', label: 'Toegang', icon: '🔑' },
];

export default function ProjectsLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState('laden'); // laden | ok | geen_toegang
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(true);

  const isLogin = pathname === '/projects/login';

  const init = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { router.replace('/projects/login'); return; }

    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, apps, portal_type, is_active')
      .eq('id', session.user.id)
      .single();

    if (!data || data.is_active === false || !(data.apps || []).includes('projects')) {
      setProfile(data || null);
      setStatus('geen_toegang');
      return;
    }
    setProfile(data);
    setStatus('ok');
  }, [supabase, router]);

  useEffect(() => { if (!isLogin) init(); }, [isLogin, init]);

  async function logout() {
    await supabase.auth.signOut();
    router.push('/projects/login');
  }

  if (isLogin) return children;

  if (status === 'laden') {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Laden...</div>;
  }

  if (status === 'geen_toegang') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-md text-center">
          <p className="text-lg font-bold text-[#1B3A5C]">Geen toegang tot de projectomgeving</p>
          <p className="text-sm text-gray-500 mt-2">
            Je account {profile?.email ? '(' + profile.email + ')' : ''} heeft geen toegang tot Projectmanagement.
            Vraag een beheerder om je toe te voegen.
          </p>
          <div className="flex gap-2 mt-5 justify-center">
            <Link href="/dashboard" className="px-4 py-2 rounded-lg border border-gray-200 text-[13px] font-semibold text-[#1B3A5C]">Naar dashboarding</Link>
            <button onClick={logout} className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold">Uitloggen</button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = profile?.role === 'admin';
  const extern = profile?.portal_type && profile.portal_type !== 'internal';
  const heeftDashboard = (profile?.apps || []).includes('dashboard');
  const items = extern ? NAV.filter(n => n.href === '/projects') : NAV;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={(open ? 'w-64' : 'w-20') + ' flex flex-col transition-all duration-300 fixed h-full z-40'}
        style={{ background: 'linear-gradient(180deg, #e8eff7 0%, #dce6f1 100%)' }}>
        <div className="p-4 flex items-center gap-3 border-b border-[#c5d4e6]">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 flex-shrink-0 rounded-lg" />
          {open && (
            <span className="font-bold text-[#1B3A5C] leading-tight" style={{ fontSize: '13px', letterSpacing: '0.02em', lineHeight: '1.2' }}>
              PROJECT<br />MANAGEMENT
            </span>
          )}
        </div>

        <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-1">
          {items.map(item => {
            const actief = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                className={'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ' +
                  (actief ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50')}>
                <span className="text-base flex-shrink-0">{item.icon}</span>
                {open && <span>{item.label}</span>}
              </Link>
            );
          })}

          {isAdmin && (
            <div className="mt-6 pt-4 border-t border-[#c5d4e6]">
              {open && <p className="text-[10px] text-[#1B3A5C]/40 uppercase tracking-wider font-semibold px-3 mb-2">Admin</p>}
              {ADMIN_NAV.map(item => {
                const actief = pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    className={'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ' +
                      (actief ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C] hover:bg-white/50')}>
                    <span className="text-base flex-shrink-0">{item.icon}</span>
                    {open && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <div className="border-t border-[#c5d4e6]">
          {heeftDashboard && open && (
            <div className="px-4 pt-4">
              <Link href="/dashboard"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/70 hover:bg-white border border-[#c5d4e6] text-[12px] font-semibold text-[#1B3A5C]">
                <span>↔</span><span>Naar dashboarding</span>
              </Link>
            </div>
          )}
          <div className="p-4">
            {open && (
              <div className="mb-2">
                <p className="text-xs text-[#1B3A5C]/70 truncate">{profile?.full_name || profile?.email}</p>
                <p className="text-[10px] text-[#1B3A5C]/40">{extern ? 'externe gebruiker' : profile?.role}</p>
              </div>
            )}
            <button onClick={logout} className="flex items-center gap-2 text-sm text-[#1B3A5C]/50 hover:text-[#1B3A5C] w-full">
              <span>🚪</span>{open && <span>Uitloggen</span>}
            </button>
          </div>
          {open && <div className="px-4 pb-3"><p className="text-[10px] text-[#1B3A5C]/30 font-mono">{PM_VERSION}</p></div>}
        </div>
      </aside>

      <main className={'flex-1 ' + (open ? 'ml-64' : 'ml-20') + ' transition-all duration-300'}>
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setOpen(!open)} className="text-gray-400 hover:text-[#1B3A5C]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          </button>
          <div className="flex items-center gap-3">
            {extern && <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-medium">Klantportaal</span>}
            {isAdmin && <span className="text-xs bg-amber-50 text-amber-600 px-3 py-1 rounded-full font-medium">Admin</span>}
            <span className="text-xs bg-green-50 text-green-600 px-3 py-1 rounded-full font-medium">Online</span>
          </div>
        </header>
        <div className="p-6 pb-16">{children}</div>
      </main>
    </div>
  );
}
