/* ============================================================
   BESTAND: page.js (dashboard root redirect)
   KOPIEER NAAR: src/app/dashboard/page.js
   (overschrijft de bestaande Overzicht pagina)

   Redirect naar /dashboard/sales als standaard landing.
   De oude Overzicht-pagina is verwijderd uit het menu.
   ============================================================ */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/sales');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-[#6b5240]">Doorverwijzen naar Omzet en Marge...</p>
    </div>
  );
}
