/* ============================================================
   BESTAND: page_hr_salary.js
   KOPIEER NAAR: src/app/dashboard/hr/salary/page.js
   (hernoem naar page.js bij het plaatsen)
   VERSIE: v3.27.02
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
        src="/salary-dashboard.html"
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
