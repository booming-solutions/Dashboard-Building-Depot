/* ============================================================
   BESTAND: page_hr_salary.js
   KOPIEER NAAR: src/app/dashboard/hr/salary/page.js
   (vervangt bestaande page.js)
   VERSIE: v27.03

   WIJZIGING: iframe wijst nu naar /api/private/salary-dashboard
   ipv /salary-dashboard.html. Het HTML-bestand staat niet meer
   in public/ maar in private/ en wordt server-side beveiligd.
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';

export default function SalaryDashboard() {
  const [iframeHeight, setIframeHeight] = useState('100vh');

  useEffect(() => {
    function handleResize() {
      setIframeHeight(window.innerHeight - 80 + 'px');
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={{ margin: '-24px', overflow: 'hidden' }}>
      <iframe
        src="/api/private/salary-dashboard"
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          display: 'block',
        }}
        title="Salariskosten Dashboard"
      />
    </div>
  );
}
