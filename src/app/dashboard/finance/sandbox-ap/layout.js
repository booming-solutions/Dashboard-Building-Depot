/* ============================================================
   BESTAND: sandbox_layout_v3.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/layout.js
   (overschrijft sandbox v2, hernoemen naar layout.js)
   🧪 SANDBOX-MIRROR van productie — regel-voor-regel identiek aan live,
   alleen aangepast:
   - tabel  ap_invoices            → sandbox_ap_invoices
   - route  /dashboard/finance/ap  → /dashboard/finance/sandbox-ap


   v3 WIJZIGINGEN:
   - Nieuwe rol ap_bank toegevoegd (Tineke = Goedkeurder 2)
   - Rol-label 'AP Goedkeurder' → 'Goedkeurder 1'
   - Rol-label nieuw: 'Goedkeurder 2' voor ap_bank
   - Namen achter "—" (bumLabel) verwijderd uit dropdown
   - canApprove1 / canApprove2 / canBank capabilities toegevoegd
   - allowedRoles uitgebreid met 'ap_bank'

   v2 WIJZIGINGEN T.O.V. v1:
   - Role-switcher uitgebreid met ap_approver rol
   - Toegang gegeven aan ap_approver
   - Groepering in de dropdown per rol
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';

// =====================================================================
// Context
// =====================================================================
const ApRoleContext = createContext(null);

export function useApRole() {
  const ctx = useContext(ApRoleContext);
  if (!ctx) throw new Error('useApRole moet binnen AP layout gebruikt worden');
  return ctx;
}

const STORAGE_KEY = 'ap_effective_role';

const ROLE_META = {
  admin:       { label: 'Admin',         icon: '👑', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  ap_approver: { label: 'Goedkeurder 1', icon: '✅', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  ap_bank:     { label: 'Goedkeurder 2', icon: '🏦', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ap_clerk:    { label: 'AP Clerk',      icon: '📋', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  cfo:         { label: 'CFO (oud)',     icon: '💼', color: 'bg-blue-50 text-blue-700 border-blue-200' },
};

export default function APLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [allApUsers, setAllApUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [effectiveProfileId, setEffectiveProfileId] = useState(null);
  
  const loadAll = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setLoading(false);
      router.push('/login');
      return;
    }
    setUser(session.user);
    
    const { data: myProfile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    
    if (error || !myProfile) {
      console.error('Profile niet gevonden:', error);
      setLoading(false);
      return;
    }
    setProfile(myProfile);
    
    if (myProfile.role === 'admin') {
      const { data: apUsers } = await supabase
        .from('profiles')
        .select('id, full_name, role, ap_assigned_bums')
        .in('role', ['admin', 'ap_approver', 'ap_bank', 'ap_clerk', 'cfo'])
        .order('role')
        .order('full_name');
      setAllApUsers(apUsers || []);
      
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored && (apUsers || []).some(u => u.id === stored)) {
        setEffectiveProfileId(stored);
      } else {
        setEffectiveProfileId(session.user.id);
      }
    } else {
      setEffectiveProfileId(session.user.id);
    }
    
    setLoading(false);
  }, [supabase, router]);
  
  useEffect(() => { loadAll(); }, [loadAll]);
  
  function switchToProfile(profileId) {
    setEffectiveProfileId(profileId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, profileId);
    }
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-[14px] text-[#1B3A5C]/40">Laden...</div>
      </div>
    );
  }
  
  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-red-800 mb-2">Geen profiel gevonden</h2>
          <p className="text-[13px] text-red-700">Je profiel kon niet geladen worden. Log opnieuw in.</p>
        </div>
      </div>
    );
  }
  
  // Access check
  const allowedRoles = ['admin', 'cfo', 'ap_approver', 'ap_bank', 'ap_clerk'];
  const reportsList = Array.isArray(profile.allowed_reports) ? profile.allowed_reports : [];
  const hasAccess = allowedRoles.includes(profile.role) || reportsList.includes('finance_ap');
  
  if (!hasAccess) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-amber-900 mb-2">Geen toegang tot Accounts Payable</h2>
          <p className="text-[13px] text-amber-800">
            Deze module is alleen toegankelijk voor admins, AP Goedkeurders, AP Bank en AP Clerks. 
            Neem contact op met je administrator als je hier wel toegang toe moet hebben.
          </p>
        </div>
      </div>
    );
  }
  
  const isAdmin = profile.role === 'admin';
  const effectiveProfile = isAdmin && effectiveProfileId !== profile.id
    ? allApUsers.find(u => u.id === effectiveProfileId) || profile
    : profile;
  
  // Derived capabilities (handig voor pagina's)
  // v3: 4-rollen model
  const canApprove1 = ['admin', 'ap_approver'].includes(effectiveProfile.role);
  const canApprove2 = ['admin', 'ap_bank'].includes(effectiveProfile.role);
  const canSelect   = ['admin', 'ap_clerk'].includes(effectiveProfile.role);
  const canBank     = ['admin', 'ap_bank'].includes(effectiveProfile.role);
  
  // Backwards-compat aliassen (v2 capabilities — andere pages kunnen deze nog gebruiken)
  const canApprove  = canApprove1 || canApprove2;
  const canFinalize = canApprove2;
  
  const contextValue = {
    actualProfile: profile,
    actualRole: profile.role,
    actualName: profile.full_name,
    isAdmin,
    
    effectiveProfile,
    effectiveProfileId: effectiveProfile.id,
    effectiveRole: effectiveProfile.role,
    effectiveName: effectiveProfile.full_name,
    effectiveBums: effectiveProfile.ap_assigned_bums || [],
    isPlayingRole: isAdmin && effectiveProfile.id !== profile.id,
    
    // Derived capabilities
    canApprove1,
    canApprove2,
    canSelect,
    canBank,
    // backwards-compat
    canApprove,
    canFinalize,
    
    canSwitchRoles: isAdmin,
    availableProfiles: allApUsers,
    switchToProfile,
  };
  
  return (
    <ApRoleContext.Provider value={contextValue}>
      {isAdmin && <RoleSwitcherBanner ctx={contextValue} />}
      {children}
    </ApRoleContext.Provider>
  );
}

// =====================================================================
// Role switcher UI
// =====================================================================
function RoleSwitcherBanner({ ctx }) {
  const { actualProfile, effectiveProfileId, availableProfiles, switchToProfile, isPlayingRole, effectiveProfile } = ctx;
  
  // Groepeer per rol
  const grouped = availableProfiles.reduce((acc, u) => {
    if (!acc[u.role]) acc[u.role] = [];
    acc[u.role].push(u);
    return acc;
  }, {});
  
  // Rol-volgorde in de dropdown
  const roleOrder = ['admin', 'ap_approver', 'ap_bank', 'ap_clerk', 'cfo'];
  
  return (
    <div className="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-base">🎭</span>
        <span className="text-[12px] font-semibold text-amber-900">Test-modus</span>
      </div>
      <span className="text-[12px] text-amber-700/70">Bekijk als:</span>
      <select 
        value={effectiveProfileId} 
        onChange={(e) => switchToProfile(e.target.value)}
        className="text-[12px] bg-white border border-amber-300 rounded-md px-2 py-1 focus:outline-none focus:border-amber-500 cursor-pointer min-w-[280px]">
        {roleOrder.map(role => {
          const users = grouped[role] || [];
          if (users.length === 0) return null;
          
          const meta = ROLE_META[role] || { label: role, icon: '👤' };
          
          return (
            <optgroup key={role} label={`${meta.icon} ${meta.label}`}>
              {users.map(u => {
                const isSelf = u.id === actualProfile.id;
                return (
                  <option key={u.id} value={u.id}>
                    {u.full_name}{isSelf ? ' (mijzelf)' : ''}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>
      
      {isPlayingRole && (
        <span className="ml-auto text-[11px] text-amber-700/70 italic">
          Je ziet de portal nu zoals {effectiveProfile.full_name} hem ziet
        </span>
      )}
    </div>
  );
}