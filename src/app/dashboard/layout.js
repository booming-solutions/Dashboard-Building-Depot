/* ============================================================
   BESTAND: layout.js (v2)
   KOPIEER NAAR: src/app/dashboard/layout.js
   (vervang het bestaande layout.js bestand)
   
   WIJZIGINGEN t.o.v. huidige versie:
   - Order Flow toegevoegd aan REPORT_MAP (was ontbreken)
   - Logistiek-menu verschijnt nu op basis van rapporttoegang
     ipv rolcheck (uniform met Omzet/Voorraad/HR)
   - isLogistics variabele verwijderd (niet meer nodig)
   ============================================================ */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';

// Menu → rapport-id mapping voor toegangscontrole
const REPORT_MAP = {
  '/dashboard/sales': 'sales',
  '/dashboard/sales/forecast': 'sales',
  '/dashboard/sales/index': 'sales_index',
  '/dashboard/sales/traffic': 'sales_traffic',
  '/dashboard/sales/discounts': 'sales_discounts',
  '/dashboard/inventory/budget': 'inventory_budget',
  '/dashboard/inventory/buying': 'inventory_buying',
  '/dashboard/inventory/negative': 'inventory_negative',
  '/dashboard/inventory/health': 'inventory_health',
  '/dashboard/inventory/stockrisk': 'inventory_stockrisk',
  '/dashboard/inventory/price-changes': 'inventory_price_changes',
  '/dashboard/logistics/order-flow': 'logistics_order_flow',
  '/dashboard/hr/salary': 'hr_payroll',
  '/dashboard/hr/urentarget': 'hr_urentarget',
  '/dashboard/hr/urenplanning-overview': 'hr_urenplanning_overview',
};

function hasAccess(pathname, allowedReports, role) {
  if (role === 'admin') return true;
  const reportId = REPORT_MAP[pathname];
  if (!reportId) return true; // pagina's zonder mapping (bv. /admin) geen check
  return (allowedReports || []).includes(reportId);
}

function NavDropdown({ icon, label, items, pathname, isCollapsed, isMobile, onNavigate }) {
  const isActive = items.some(item => pathname === item.href || pathname.startsWith(item.href + '/'));
  const [isOpen, setIsOpen] = useState(isActive);
  useEffect(() => { if (isActive) setIsOpen(true); }, [isActive]);

  if (isCollapsed && !isMobile) {
    return (
      <div className="relative group">
        <button className={`w-full flex items-center justify-center h-10 rounded-lg transition-colors ${isActive ? 'bg-[#1B3A5C] text-white' : 'text-[#6b5240] hover:bg-[#f5ede3]'}`} title={label}>
          <span className="text-lg">{icon}</span>
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover:block z-50">
          <div className="bg-white rounded-lg shadow-lg border border-[#e5ddd4] py-1 min-w-[200px]">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#a08a74] border-b border-[#e5ddd4]">{label}</div>
            {items.map(item => (
              <Link key={item.href} href={item.href} onClick={onNavigate} className={`block px-3 py-2 text-[12px] hover:bg-[#faf5f0] ${pathname === item.href ? 'text-[#E84E1B] font-semibold' : 'text-[#3d2f1e]'}`}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-[13px] ${isActive ? 'bg-[#f5ede3] text-[#1B3A5C] font-semibold' : 'text-[#3d2f1e] hover:bg-[#faf5f0]'}`}>
          <span className="flex items-center gap-2.5"><span>{icon}</span><span>{label}</span></span>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
      </button>
      {isOpen && (
        <div className="mt-0.5 ml-6 space-y-0.5">
          {items.map(item => (
            <Link key={item.href} href={item.href} onClick={onNavigate} className={`block px-3 py-1.5 rounded-lg text-[12px] transition-colors ${pathname === item.href ? 'bg-[#E84E1B] text-white' : 'text-[#6b5240] hover:bg-[#faf5f0]'}`}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({ href, icon, label, pathname, isCollapsed, isMobile, onNavigate }) {
  const isActive = pathname === href;

  if (isCollapsed && !isMobile) {
    return (
      <Link href={href} onClick={onNavigate} title={label} className={`w-full flex items-center justify-center h-10 rounded-lg transition-colors ${isActive ? 'bg-[#E84E1B] text-white' : 'text-[#6b5240] hover:bg-[#f5ede3]'}`}>
        <span className="text-lg">{icon}</span>
      </Link>
    );
  }

  return (
    <Link href={href} onClick={onNavigate} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-[13px] ${isActive ? 'bg-[#E84E1B] text-white' : 'text-[#3d2f1e] hover:bg-[#faf5f0]'}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar-collapsed');
      if (saved === 'true') setIsCollapsed(true);
    }
  }, []);

  useEffect(() => {
    checkUser();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      checkUser();
    });
    return () => { authListener?.subscription?.unsubscribe(); };
  }, [pathname]);

  useEffect(() => {
    // Access control op basis van rapporttoegang
    if (!loading && profile && pathname !== '/dashboard' && pathname !== '/dashboard/settings') {
      if (!hasAccess(pathname, profile.allowed_reports, profile.role)) {
        router.push('/dashboard');
      }
    }
  }, [pathname, profile, loading]);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    setUser(user);
    const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!profileData || !profileData.is_active) { await supabase.auth.signOut(); router.push('/login'); return; }
    setProfile(profileData);
    setLoading(false);
  }

  async function handleSignOut() { await supabase.auth.signOut(); router.push('/login'); }

  function toggleCollapse() {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (typeof window !== 'undefined') localStorage.setItem('sidebar-collapsed', newState);
  }

  function closeSidebar() { setSidebarOpen(false); }

  // Bereken beschikbare menu-items op basis van rapporttoegang
  const flags = useMemo(() => {
    if (!profile) return {};
    const allowed = profile.allowed_reports || [];
    const isAdmin = profile.role === 'admin';
    const has = (reportId) => isAdmin || allowed.includes(reportId);
    return {
      sales: has('sales'),
      sales_index: has('sales_index'),
      sales_traffic: has('sales_traffic'),
      sales_discounts: has('sales_discounts'),
      inventory_budget: has('inventory_budget'),
      inventory_buying: has('inventory_buying'),
      inventory_negative: has('inventory_negative'),
      inventory_health: has('inventory_health'),
      inventory_stockrisk: has('inventory_stockrisk'),
      inventory_price_changes: has('inventory_price_changes'),
      logistics_order_flow: has('logistics_order_flow'),
      hr_payroll: has('hr_payroll'),
      hr_urentarget: has('hr_urentarget'),
      hr_urenplanning_overview: has('hr_urenplanning_overview'),
    };
  }, [profile]);

  const omzetItemsAll = [
    { href: '/dashboard/sales', label: 'Omzet en Marge', flag: 'sales' },
    { href: '/dashboard/sales/forecast', label: 'Forecast', flag: 'sales' },
    { href: '/dashboard/sales/index', label: 'Index Rapport', flag: 'sales_index' },
    { href: '/dashboard/sales/traffic', label: 'Bezoekers & Conversie', flag: 'sales_traffic' },
    { href: '/dashboard/sales/discounts', label: 'Kortingen', flag: 'sales_discounts' },
  ];
  const voorraadItemsAll = [
    { href: '/dashboard/inventory/budget', label: 'Voorraad vs Budget', flag: 'inventory_budget' },
    { href: '/dashboard/inventory/buying', label: 'Inkoopvoorstel', flag: 'inventory_buying' },
    { href: '/dashboard/inventory/negative', label: 'Negatieve Voorraad', flag: 'inventory_negative' },
    { href: '/dashboard/inventory/health', label: 'Gezondheid Voorraden', flag: 'inventory_health' },
    { href: '/dashboard/inventory/stockrisk', label: 'Stock Risk Alert', flag: 'inventory_stockrisk' },
    { href: '/dashboard/inventory/price-changes', label: 'Price Changes', flag: 'inventory_price_changes' },
  ];
  const logisticsItemsAll = [
    { href: '/dashboard/logistics/order-flow', label: 'Order Flow', flag: 'logistics_order_flow' },
  ];
  const hrItemsAll = [
    { href: '/dashboard/hr/salary', label: 'Salariskosten', flag: 'hr_payroll' },
    { href: '/dashboard/hr/urentarget', label: 'Uren Target', flag: 'hr_urentarget' },
    { href: '/dashboard/hr/urenplanning-overview', label: 'Uren Planning', flag: 'hr_urenplanning_overview' },
  ];
  const financeItems = [
    { href: '/dashboard/finance/ap', label: 'AP Dashboard' },
    { href: '/dashboard/finance/sandbox-ap', label: 'AP Sandbox' },
    { href: '/dashboard/finance/reports', label: 'Rapportages' },
  ];

  const omzetItems = omzetItemsAll.filter(i => flags[i.flag]);
  const voorraadItems = voorraadItemsAll.filter(i => flags[i.flag]);
  const logisticsItems = logisticsItemsAll.filter(i => flags[i.flag]);
  const hrItems = hrItemsAll.filter(i => flags[i.flag]);

  // Finance blijft op rolcheck (heeft eigen rollen: cfo, ap_approver, ap_clerk)
  const isFinance = ['admin', 'cfo', 'ap_approver', 'ap_clerk'].includes(profile?.role);

  if (loading) return <div style={{ background: '#faf5f0', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#6b5240' }}>Laden...</div>;

  const desktopSidebarWidth = isCollapsed ? '64px' : '220px';

  return (
    <div style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", background: '#faf5f0', minHeight: '100vh', color: '#3d2f1e' }}>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-[#e5ddd4] flex items-center justify-between px-4 h-14">
        <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-[#3d2f1e]">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Booming Solutions" className="w-7 h-7 rounded" />
          <span className="text-[13px] font-bold text-[#1a0a04]">Booming Solutions</span>
        </div>
        <div className="w-8" />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={closeSidebar} />
          <div className="relative bg-white w-[80%] max-w-[280px] h-full flex flex-col shadow-2xl">
            <div className="p-4 border-b border-[#e5ddd4] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Booming Solutions" className="w-8 h-8 rounded" />
                <div>
                  <div className="text-[13px] font-bold text-[#1a0a04]">Booming Solutions</div>
                  <div className="text-[10px] text-[#a08a74]">CFO Dashboard</div>
                </div>
              </div>
              <button onClick={closeSidebar} className="text-[#6b5240] p-1">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              <NavItem href="/dashboard" icon="🏠" label="Home" pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />
              {omzetItems.length > 0 && <NavDropdown icon="📊" label="Omzet" items={omzetItems} pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />}
              {voorraadItems.length > 0 && <NavDropdown icon="📦" label="Voorraad" items={voorraadItems} pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />}
              {logisticsItems.length > 0 && <NavDropdown icon="🚚" label="Logistiek" items={logisticsItems} pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />}
              {hrItems.length > 0 && <NavDropdown icon="👥" label="HR" items={hrItems} pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />}
              {isFinance && <NavDropdown icon="💼" label="Finance" items={financeItems} pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar} />}
              {profile?.role === 'admin' && (
                <NavDropdown icon="⚙️" label="Admin" pathname={pathname} isCollapsed={false} isMobile={true} onNavigate={closeSidebar}
                  items={[
                    { href: '/dashboard/admin', label: 'Data Upload' },
                    { href: '/dashboard/admin/data-status', label: 'Data Status' },
                    { href: '/dashboard/admin/dyflexis-planning', label: 'Dyflexis Planning' },
                    { href: '/dashboard/admin/dyflexis-actuals', label: 'Dyflexis Actuals' },
                    { href: '/dashboard/admin/salary-import', label: 'Salaris Import' },
                    { href: '/dashboard/admin/users', label: 'Gebruikers' },
                    { href: '/dashboard/admin/stats', label: 'Statistieken' },
                  ]}
                />
              )}
            </nav>
            <div className="border-t border-[#e5ddd4] p-3">
              <button onClick={handleSignOut} className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-[#6b5240] hover:bg-[#faf5f0]">Uitloggen</button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full bg-white border-r border-[#e5ddd4] flex-col z-30 transition-all duration-200" style={{ width: desktopSidebarWidth }}>
        <div className={`p-3 border-b border-[#e5ddd4] flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed && (
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="Booming Solutions" className="w-8 h-8 rounded" />
              <div>
                <div className="text-[13px] font-bold text-[#1a0a04]">Booming Solutions</div>
                <div className="text-[10px] text-[#a08a74]">CFO Dashboard</div>
              </div>
            </div>
          )}
          {isCollapsed && <img src="/logo.png" alt="Booming Solutions" className="w-8 h-8 rounded" />}
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          <NavItem href="/dashboard" icon="🏠" label="Home" pathname={pathname} isCollapsed={isCollapsed} />
          {omzetItems.length > 0 && <NavDropdown icon="📊" label="Omzet" items={omzetItems} pathname={pathname} isCollapsed={isCollapsed} />}
          {voorraadItems.length > 0 && <NavDropdown icon="📦" label="Voorraad" items={voorraadItems} pathname={pathname} isCollapsed={isCollapsed} />}
          {logisticsItems.length > 0 && <NavDropdown icon="🚚" label="Logistiek" items={logisticsItems} pathname={pathname} isCollapsed={isCollapsed} />}
          {hrItems.length > 0 && <NavDropdown icon="👥" label="HR" items={hrItems} pathname={pathname} isCollapsed={isCollapsed} />}
          {isFinance && <NavDropdown icon="💼" label="Finance" items={financeItems} pathname={pathname} isCollapsed={isCollapsed} />}
          {profile?.role === 'admin' && (
            <NavDropdown icon="⚙️" label="Admin" pathname={pathname} isCollapsed={isCollapsed}
              items={[
                { href: '/dashboard/admin', label: 'Data Upload' },
                { href: '/dashboard/admin/data-status', label: 'Data Status' },
                { href: '/dashboard/admin/dyflexis-planning', label: 'Dyflexis Planning' },
                { href: '/dashboard/admin/dyflexis-actuals', label: 'Dyflexis Actuals' },
                { href: '/dashboard/admin/salary-import', label: 'Salaris Import' },
                { href: '/dashboard/admin/users', label: 'Gebruikers' },
                { href: '/dashboard/admin/stats', label: 'Statistieken' },
              ]}
            />
          )}
        </nav>
        <div className="border-t border-[#e5ddd4] p-2">
          <button onClick={toggleCollapse} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-[#6b5240] hover:bg-[#faf5f0] ${isCollapsed ? 'justify-center' : ''}`} title={isCollapsed ? 'Uitklappen' : 'Inklappen'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0)' }}>
              <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {!isCollapsed && <span>Inklappen</span>}
          </button>
        </div>
        <div className={`p-3 border-t border-[#e5ddd4] ${isCollapsed ? 'flex justify-center' : ''}`}>
          {!isCollapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#1B3A5C] flex items-center justify-center text-white text-[11px] font-semibold">{profile?.full_name?.[0] || 'U'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[#1a0a04] truncate">{profile?.full_name || 'User'}</div>
                <button onClick={handleSignOut} className="text-[10px] text-[#a08a74] hover:text-[#E84E1B]">Uitloggen</button>
              </div>
            </div>
          ) : (
            <button onClick={handleSignOut} title="Uitloggen" className="w-8 h-8 rounded-full bg-[#1B3A5C] flex items-center justify-center text-white text-[11px] font-semibold">
              {profile?.full_name?.[0] || 'U'}
            </button>
          )}
        </div>
      </aside>

      <main className="lg:pl-[220px] pt-14 lg:pt-0 transition-all duration-200" style={{ paddingLeft: typeof window !== 'undefined' && window.innerWidth >= 1024 ? desktopSidebarWidth : undefined }}>
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}