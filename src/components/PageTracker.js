/* ============================================================
   BESTAND: PageTracker.js
   KOPIEER NAAR: src/components/PageTracker.js
   ============================================================ */
'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';

var SESSION_KEY = '__bs_session';

function getSessionId() {
  if (typeof window === 'undefined') return '';
  var sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

var PAGE_NAMES = {
  '/dashboard/sales': 'Omzet en Marge',
  '/dashboard/sales/index': 'Index Rapport',
  '/dashboard/sales/traffic': 'Bezoekers & Conversie',
  '/dashboard/inventory/budget': 'Voorraad vs Budget',
  '/dashboard/inventory/stockrisk': 'Stock Risk Alert',
  '/dashboard/inventory/buying': 'Inkoopvoorstel',
  '/dashboard/inventory/negative': 'Negatieve Voorraad',
  '/dashboard/inventory/health': 'Gezondheid Voorraden',
  '/dashboard/hr/salary': 'Salariskosten',
  '/dashboard/admin': 'Admin Panel',
  '/dashboard/admin/users': 'Gebruikersbeheer',
};

function getPageTitle(path) {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  // Check for BUM sub-pages like /dashboard/inventory/stockrisk/henk
  var parts = path.split('/');
  var parent = parts.slice(0, -1).join('/');
  var bum = parts[parts.length - 1];
  if (PAGE_NAMES[parent]) return PAGE_NAMES[parent] + ' — ' + bum.toUpperCase();
  return path;
}

export default function PageTracker() {
  var pathname = usePathname();
  var lastPath = useRef('');
  var supabase = createClient();

  useEffect(function() {
    if (!pathname || !pathname.startsWith('/dashboard')) return;
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;

    async function track() {
      try {
        var user = await supabase.auth.getUser();
        var userId = user.data.user ? user.data.user.id : null;
        var email = user.data.user ? user.data.user.email : null;

        await supabase.from('page_views').insert({
          user_id: userId,
          user_email: email,
          page_path: pathname,
          page_title: getPageTitle(pathname),
          session_id: getSessionId(),
        });
      } catch (e) {
        // Silent fail — tracking should never break the app
      }
    }
    track();
  }, [pathname]);

  return null; // This component renders nothing
}
