/* ============================================================
   BESTAND: page_hr_urentarget.js
   KOPIEER NAAR: src/app/dashboard/hr/urentarget/page.js
   VERSIE: v27.03

   WIJZIGING: iframe wijst naar /api/private/uren-dashboard
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';

export default function UrentargetDashboard() {
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
        src="/api/private/uren-dashboard"
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          display: 'block',
        }}
        title="Urentarget Dashboard"
      />
    </div>
  );
}
