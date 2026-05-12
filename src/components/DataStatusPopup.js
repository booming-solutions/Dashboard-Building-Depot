/* ============================================================
   BESTAND: DataStatusPopup.js
   KOPIEER NAAR: src/components/DataStatusPopup.js
   (nieuw bestand)

   Toont een popup bij de eerste page-load van de dag als er
   data-bronnen oranje of rood staan. Eenmaal per dag per browser
   via localStorage. Alleen voor admins.
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

// Zelfde config als de Data Status pagina, maar simpeler — we hoeven hier alleen
// te bepalen of er issues zijn, niet alle subrijen op te halen.
const SOURCES_TO_CHECK = [
  { id: 'sales', label: 'Sales', table: 'sales_data', dateCol: 'sale_date' },
  { id: 'inventory', label: 'Inventory', table: 'inventory_data', dateCol: 'inventory_date' },
  { id: 'negative', label: 'Negatieve Voorraad', table: 'negative_inventory', dateCol: 'report_date' },
  { id: 'buying', label: 'Stock Risk Alert', table: 'buying_data', dateCol: 'upload_date' },
  { id: 'traffic', label: 'Traffic', table: 'traffic_data', dateCol: 'date' },
  { id: 'price', label: 'Price Changes', table: 'price_snapshots', dateCol: 'snapshot_date' },
];

function getStatus(lastDate) {
  if (!lastDate) return { code: 'red', label: 'Geen data', dagen: null };
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = new Date(lastDate + 'T00:00:00');
  const dagen = Math.floor((today - d) / (1000 * 60 * 60 * 24));
  if (dagen <= 1) return { code: 'green', label: 'OK', dagen };
  if (dagen === 2) return { code: 'orange', label: '1 dag te laat', dagen };
  return { code: 'red', label: (dagen - 1) + ' dagen te laat', dagen };
}

function fmtDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return parseInt(parts[2]) + ' ' + MN[parseInt(parts[1]) - 1];
}

const STATUS_COLORS = {
  orange: { dot: '#d97706', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  red: { dot: '#dc2626', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};

export default function DataStatusPopup() {
  const [show, setShow] = useState(false);
  const [issues, setIssues] = useState([]);
  const [checked, setChecked] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    async function check() {
      // Alleen voor ingelogde admins
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setChecked(true); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'admin') { setChecked(true); return; }

      // Check localStorage: is popup al getoond vandaag?
      const today = new Date();
      const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const lastShown = localStorage.getItem('data_status_popup_shown');
      if (lastShown === todayStr) { setChecked(true); return; }

      // Haal voor elke bron de laatste data-datum op
      const foundIssues = [];
      for (const src of SOURCES_TO_CHECK) {
        try {
          const { data: rows } = await supabase
            .from(src.table)
            .select(src.dateCol)
            .order(src.dateCol, { ascending: false })
            .limit(1);
          const lastDate = rows?.[0]?.[src.dateCol] || null;
          const status = getStatus(lastDate);
          if (status.code === 'orange' || status.code === 'red') {
            foundIssues.push({ ...src, lastDate, status });
          }
        } catch (e) {
          // Tabel onbereikbaar = probleem, maar laten we niet hard falen
          console.warn('Data status check failed for', src.id, e);
        }
      }

      if (cancelled) return;
      setIssues(foundIssues);
      if (foundIssues.length > 0) setShow(true);
      setChecked(true);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    localStorage.setItem('data_status_popup_shown', todayStr);
    setShow(false);
  }

  if (!checked || !show || issues.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={dismiss}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-[520px] w-full" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-[#e5ddd4]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center"><span className="text-lg">⚠️</span></div>
            <div>
              <h3 className="text-[17px] font-bold text-[#1a0a04]">Data niet up-to-date</h3>
              <p className="text-[12px] text-[#6b5240]">{issues.length} {issues.length === 1 ? 'bron heeft' : 'bronnen hebben'} aandacht nodig</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-2">
            {issues.map(iss => {
              const c = STATUS_COLORS[iss.status.code];
              return (
                <div key={iss.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.border} ${c.bg}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-[10px] h-[10px] rounded-full flex-shrink-0" style={{ backgroundColor: c.dot }} />
                    <div>
                      <p className="text-[13px] font-semibold text-[#1a0a04]">{iss.label}</p>
                      <p className="text-[11px] text-[#6b5240]">Laatste data: {fmtDate(iss.lastDate)}</p>
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold ${c.text}`}>{iss.status.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 bg-[#faf7f4] border-t border-[#e5ddd4] flex gap-2 rounded-b-2xl">
          <button onClick={dismiss} className="flex-1 py-2.5 rounded-lg bg-white text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4] hover:bg-[#faf5f0] transition-colors">
            Sluiten
          </button>
          <Link href="/dashboard/admin/data-status" onClick={dismiss} className="flex-1 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold text-center hover:bg-[#15314a] transition-colors">
            Bekijk volledig rapport
          </Link>
        </div>
      </div>
    </div>
  );
}
