/* ============================================================
   BESTAND: sandbox_layout_v4.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/layout.js
   (overschrijft sandbox v3, hernoemen naar layout.js)
   🧪 SANDBOX-MIRROR van productie v4 — regel-voor-regel identiek aan live,
   alleen aangepast:
   - alle ap_*-tabellen           → sandbox_ap_*  (profiles blijft gedeeld)
   - route /dashboard/finance/ap  → /dashboard/finance/sandbox-ap


   v4 WIJZIGINGEN:
   - Multi-entiteit: BrandBanner bovenaan elke AP-pagina met logo,
     vlag en kleuren per administratie (BDT/BDB/MMC/RCC). Switcher
     om van administratie te wisselen; default BDT (Curaçao Store 1).
   - Context levert nu 'entity', 'entityMeta', 'setEntity' zodat
     pagina's per entiteit kunnen filteren (volgende stap).
   - Logo's verwacht in /public/logos/ (building-depot.png, multimart.png, rcc.png).

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
const ENTITY_STORAGE_KEY = 'ap_active_entity';

// =====================================================================
// Entiteiten — branding per administratie. Logo's staan in /public/logos.
// Zet de aangeleverde bestanden neer als:
//   /public/logos/building-depot.png   (BDT + BDB)
//   /public/logos/multimart.png        (MMC)
//   /public/logos/rcc.png              (RCC)
// =====================================================================
const ENTITY_META = {
  BDT: {
    code: 'BDT', name: 'Building Depot', sub: 'Curaçao · Store 1',
    logo: '/logos/building-depot.png', flag: 'curacao',
    bar: '#E1330B', barText: '#FFFFFF', accent: '#F5C518', soft: '#FDE7E1',
  },
  BDB: {
    code: 'BDB', name: 'Building Depot', sub: 'Bonaire',
    logo: '/logos/building-depot.png', flag: 'bonaire',
    bar: '#0B5AA6', barText: '#FFFFFF', accent: '#F5C518', soft: '#E3EEF8',
  },
  MMC: {
    code: 'MMC', name: 'Multimart', sub: 'Curaçao',
    logo: '/logos/multimart.png', flag: null,
    bar: '#2AA9E0', barText: '#FFFFFF', accent: '#7AB648', soft: '#E4F4FB',
  },
  RCC: {
    code: 'RCC', name: 'Repair Centre', sub: 'Curaçao',
    logo: '/logos/rcc.png', flag: null,
    bar: '#2E3A45', barText: '#FFFFFF', accent: '#8895A3', soft: '#EAEDF0',
  },
};
const ENTITY_ORDER = ['BDT', 'BDB', 'MMC', 'RCC'];

// Vlaggen als SVG (stylized — vervang desgewenst door /public/flags/*.png).
function FlagCuracao({ className = '' }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-label="Curaçao">
      <rect width="60" height="40" fill="#002B7F" />
      <rect y="28" width="60" height="6" fill="#F9D90F" />
      <path d="M12 8l1.6 3.4 3.7.4-2.8 2.5.8 3.6L12 15.9 8.7 17.9l.8-3.6L6.7 11.8l3.7-.4z" fill="#fff" />
      <path d="M9 18l1.1 2.3 2.5.3-1.9 1.7.5 2.5L9 23.4 6.7 24.8l.5-2.5-1.9-1.7 2.5-.3z" fill="#fff" />
    </svg>
  );
}
function FlagBonaire({ className = '' }) {
  return (
    <svg viewBox="0 0 60 40" className={className} aria-label="Bonaire">
      <rect width="60" height="40" fill="#fff" />
      <path d="M0 40 L0 22 L26 40 Z" fill="#0B54A0" />
      <path d="M0 20 L34 40 L40 40 L0 16 Z" fill="#F9D90F" />
      <g transform="translate(13 12)">
        <circle r="7" fill="none" stroke="#D21034" strokeWidth="2" />
        <path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#000" />
      </g>
    </svg>
  );
}
function EntityFlag({ flag, className }) {
  if (flag === 'curacao') return <FlagCuracao className={className} />;
  if (flag === 'bonaire') return <FlagBonaire className={className} />;
  return null;
}

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
  const [entity, setEntityState] = useState('BDT');

  // Actieve entiteit laden uit localStorage (default BDT = Curaçao Store 1)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(ENTITY_STORAGE_KEY);
    if (stored && ENTITY_META[stored]) setEntityState(stored);
  }, []);

  function setEntity(code) {
    if (!ENTITY_META[code]) return;
    setEntityState(code);
    if (typeof window !== 'undefined') localStorage.setItem(ENTITY_STORAGE_KEY, code);
  }
  
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

    // Multi-entiteit
    entity,
    entityMeta: ENTITY_META[entity] || ENTITY_META.BDT,
    setEntity,
    availableEntities: ENTITY_ORDER,
  };
  
  return (
    <ApRoleContext.Provider value={contextValue}>
      <BrandBanner ctx={contextValue} />
      {isAdmin && <RoleSwitcherBanner ctx={contextValue} />}
      {children}
    </ApRoleContext.Provider>
  );
}

// =====================================================================
// Branded header per entiteit — altijd zichtbaar bovenaan elke AP-pagina,
// zodat niemand zich vergist in welke administratie hij boekt.
// =====================================================================
function BrandBanner({ ctx }) {
  const { entity, setEntity, availableEntities } = ctx;
  const m = ENTITY_META[entity] || ENTITY_META.BDT;
  return (
    <div
      className="mb-5 rounded-2xl overflow-hidden shadow-sm border"
      style={{ borderColor: m.bar }}>
      <div className="flex items-center gap-4 px-5 py-3" style={{ background: m.bar, color: m.barText }}>
        {/* Logo */}
        <div className="flex-shrink-0 bg-white rounded-lg p-1.5 shadow-sm h-12 w-12 flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.logo} alt={m.name} className="max-h-full max-w-full object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        {/* Naam + sub */}
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-extrabold leading-tight truncate">{m.name}</div>
          <div className="text-[12px] font-semibold opacity-90">{m.sub}</div>
        </div>
        {/* Grote vlag (indien BDT/BDB) */}
        {m.flag && (
          <div className="flex-shrink-0 rounded-md overflow-hidden shadow ring-1 ring-white/40">
            <EntityFlag flag={m.flag} className="h-11 w-[66px] block" />
          </div>
        )}
        {/* Entiteit-code groot */}
        <div className="flex-shrink-0 text-[26px] font-black tracking-wider px-3 py-1 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.18)' }}>
          {m.code}
        </div>
      </div>

      {/* Switcher-balk */}
      <div className="flex items-center gap-2 px-5 py-2 bg-white flex-wrap">
        <span className="text-[11px] font-semibold text-[#1B3A5C]/50">Administratie:</span>
        {availableEntities.map(code => {
          const em = ENTITY_META[code];
          const active = code === entity;
          return (
            <button key={code} onClick={() => setEntity(code)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-bold transition-all border"
              style={active
                ? { background: em.bar, color: em.barText, borderColor: em.bar }
                : { background: em.soft, color: '#1B3A5C', borderColor: 'transparent' }}>
              {em.flag && <EntityFlag flag={em.flag} className="h-3 w-[18px] rounded-sm" />}
              {em.code}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-[#1B3A5C]/40 italic">
          Je boekt nu in {m.name} {m.sub}
        </span>
      </div>
    </div>
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