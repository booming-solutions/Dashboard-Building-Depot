/* ============================================================
   BESTAND: page.js  (Data Status admin pagina)
   KOPIEER NAAR: src/app/dashboard/admin/data-status/page.js
   (deze map bestaat nog niet, moet aangemaakt worden)

   Toont gezondheid van alle datapipelines.
   Drempels:
   - Vandaag/gisteren     = 🟢 OK
   - Eergisteren          = 🟠 1 dag te laat
   - 3+ dagen geleden     = 🔴 2+ dagen te laat
   Drilldown per bron via klik (subrijen per store / BUM).
   ============================================================ */
'use client';

import React, { useState, useEffect, Fragment } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';
import LoadingLogo from '@/components/LoadingLogo';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

// Configuratie van alle bronnen die we monitoren
// Elk bron heeft: tabel, datumkolom, upload-timestamp kolom, dimensies om op te splitsen, en verwachte tijd
const SOURCES = [
  {
    id: 'sales',
    label: 'Sales',
    table: 'sales_data',
    dateCol: 'sale_date',
    uploadCol: 'uploaded_at',
    dimension: 'store_number',
    expectedTime: 'dagelijks 19:00',
    storeLabels: { '1': 'Curaçao', 'B': 'Bonaire' },
  },
  {
    id: 'inventory',
    label: 'Inventory',
    table: 'inventory_data',
    dateCol: 'inventory_date',
    uploadCol: 'created_at',
    dimension: 'store_number',
    expectedTime: 'dagelijks 08:00',
    storeLabels: { '1': 'Curaçao', 'B': 'Bonaire' },
  },
  {
    id: 'negative',
    label: 'Negatieve Voorraad',
    table: 'negative_inventory',
    dateCol: 'report_date',
    uploadCol: 'created_at',
    dimension: 'store_number',
    expectedTime: 'dagelijks 23:00',
    storeLabels: { '1': 'Curaçao', 'B': 'Bonaire' },
  },
  {
    id: 'buying',
    label: 'Stock Risk Alert',
    table: 'buying_data',
    dateCol: 'upload_date',
    uploadCol: 'created_at',
    dimension: 'bum',
    expectedTime: 'dagelijks 23:00',
  },
  {
    id: 'traffic',
    label: 'Traffic (bezoekers)',
    table: 'traffic_data',
    dateCol: 'date',
    uploadCol: 'created_at',
    dimension: 'store_number',
    expectedTime: 'dagelijks',
    storeLabels: { '1': 'Curaçao', 'B': 'Bonaire' },
  },
  {
    id: 'price',
    label: 'Price Changes',
    table: 'price_snapshots',
    dateCol: 'snapshot_date',
    uploadCol: 'created_at',
    dimension: 'regio',
    expectedTime: 'dagelijks 08:00',
    storeLabels: { 'CUR': 'Curaçao', 'BON': 'Bonaire' },
  },
];

// Bepaal status op basis van data-datum vs vandaag
function getStatus(lastDate) {
  if (!lastDate) return { code: 'red', label: 'Geen data', dagen: null };
  const today = new Date();
  today.setHours(0,0,0,0);
  const d = new Date(lastDate + 'T00:00:00');
  const diffMs = today - d;
  const dagen = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dagen <= 1) return { code: 'green', label: dagen === 0 ? 'Vandaag binnen' : 'Gisteren binnen', dagen };
  if (dagen === 2) return { code: 'orange', label: '1 dag te laat', dagen };
  return { code: 'red', label: (dagen - 1) + ' dagen te laat', dagen };
}

const STATUS_COLORS = {
  green: { dot: '#16a34a', bg: 'bg-green-50', text: 'text-green-600', label: '🟢' },
  orange: { dot: '#d97706', bg: 'bg-orange-50', text: 'text-orange-600', label: '🟠' },
  red: { dot: '#dc2626', bg: 'bg-red-50', text: 'text-red-600', label: '🔴' },
};

function fmtDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return parseInt(parts[2]) + ' ' + MN[parseInt(parts[1]) - 1] + ' ' + parts[0];
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const day = d.getDate();
  const month = MN[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm}`;
}

// Bepaal de "worst" status uit een set sub-statussen (voor hoofdrij)
function worstStatus(statuses) {
  if (statuses.some(s => s.code === 'red')) return 'red';
  if (statuses.some(s => s.code === 'orange')) return 'orange';
  return 'green';
}

export default function DataStatusPage() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const supabase = createClient();

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsAdmin(prof?.role === 'admin');
    }
    setAuthChecked(true);
  }

  useEffect(() => {
    if (authChecked && isAdmin) loadData();
  }, [authChecked, isAdmin]);

  async function loadData() {
    setLoading(true);
    const results = {};
    for (const src of SOURCES) {
      // Haal de meest recente data-datum op overall
      const { data: overallRows } = await supabase
        .from(src.table)
        .select(`${src.dateCol}, ${src.uploadCol}`)
        .order(src.dateCol, { ascending: false })
        .limit(1);

      const overallLastDate = overallRows?.[0]?.[src.dateCol] || null;
      const overallLastUpload = overallRows?.[0]?.[src.uploadCol] || null;

      // Haal per-dimensie laatste data datum op
      // (haal alle rijen op met meest recente datum, dan groepeer in JS — simpeler dan complexe Supabase query)
      let subRows = [];
      if (overallLastDate) {
        // Haal de laatste record per dimensie waarde
        // Strategie: get distinct dimension values, voor elk de meest recente
        const { data: dimValues } = await supabase
          .from(src.table)
          .select(src.dimension)
          .not(src.dimension, 'is', null)
          .limit(2000); // genoeg voor BUM (5) of store (~10) waarden

        const uniqueDims = [...new Set((dimValues || []).map(r => r[src.dimension]).filter(v => v != null && v !== ''))];

        for (const dimVal of uniqueDims) {
          const { data: dr } = await supabase
            .from(src.table)
            .select(`${src.dateCol}, ${src.uploadCol}`)
            .eq(src.dimension, dimVal)
            .order(src.dateCol, { ascending: false })
            .limit(1);

          if (dr && dr.length) {
            subRows.push({
              dimension: dimVal,
              dimensionLabel: src.storeLabels?.[dimVal] || dimVal,
              lastDate: dr[0][src.dateCol],
              lastUpload: dr[0][src.uploadCol],
              status: getStatus(dr[0][src.dateCol]),
            });
          }
        }

        // Sorteer subrows: rood eerst, dan oranje, dan groen
        const order = { red: 0, orange: 1, green: 2 };
        subRows.sort((a, b) => order[a.status.code] - order[b.status.code]);
      }

      results[src.id] = {
        config: src,
        overallLastDate,
        overallLastUpload,
        overallStatus: getStatus(overallLastDate),
        subRows,
        worstSubStatus: subRows.length ? worstStatus(subRows.map(r => r.status)) : null,
      };
    }
    setData(results);
    setLoading(false);
  }

  if (!authChecked) return <LoadingLogo text="Verifiëren..." />;
  if (!isAdmin) {
    return (
      <div className="max-w-[800px] mx-auto py-12 text-center">
        <p className="text-[15px] text-[#6b5240]">Deze pagina is alleen toegankelijk voor admins.</p>
      </div>
    );
  }
  if (loading) return <LoadingLogo text="Status laden..." />;

  const totalIssues = SOURCES.reduce((cnt, src) => {
    const r = data[src.id];
    if (!r) return cnt;
    // Hoofdstatus is "worst" van substatussen, anders overall
    const mainStatus = r.worstSubStatus || r.overallStatus.code;
    return mainStatus !== 'green' ? cnt + 1 : cnt;
  }, 0);

  return (
    <div className="max-w-[1100px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: '22px', fontWeight: 900 }}>Data Status</h1>
          <p className="text-[13px] text-[#6b5240]">Overzicht van alle binnenkomende datapipelines</p>
        </div>
        <button onClick={loadData} className="text-[12px] text-[#6b7280] hover:text-[#1B3A5C] bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full font-medium transition-all">
          ↻ Ververs
        </button>
      </div>

      {/* Samenvatting */}
      <div className={`rounded-[14px] border p-4 mb-5 ${totalIssues === 0 ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
        <p className="text-[14px] font-semibold">
          {totalIssues === 0 ? (
            <>🟢 Alle pipelines zijn up-to-date</>
          ) : (
            <>⚠️ {totalIssues} {totalIssues === 1 ? 'bron heeft' : 'bronnen hebben'} aandacht nodig</>
          )}
        </p>
      </div>

      {/* Hoofdtabel */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#faf7f4]">
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Bron</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Laatste data</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Upload moment</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Verwacht</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Status</th>
              <th className="text-center p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Detail</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map(src => {
              const r = data[src.id];
              if (!r) return null;
              const isExpanded = expanded[src.id];
              // Hoofdrij toont "worst" status van subrows
              const mainStatusCode = r.worstSubStatus || r.overallStatus.code;
              const colors = STATUS_COLORS[mainStatusCode];
              const hasSubRows = r.subRows.length > 0;
              return (
                <Fragment key={src.id}>
                  <tr
                    className={`hover:bg-[#faf5f0] cursor-pointer ${isExpanded ? 'bg-[#faf7f4]' : ''}`}
                    onClick={() => hasSubRows && setExpanded(prev => ({ ...prev, [src.id]: !prev[src.id] }))}
                  >
                    <td className="p-3 text-[13px] border-b border-[#e5ddd4] font-semibold">
                      {src.label}
                    </td>
                    <td className="p-3 text-[13px] border-b border-[#e5ddd4]">
                      {fmtDate(r.overallLastDate)}
                    </td>
                    <td className="p-3 text-[12px] border-b border-[#e5ddd4] text-[#6b5240]">
                      {fmtDateTime(r.overallLastUpload)}
                    </td>
                    <td className="p-3 text-[12px] border-b border-[#e5ddd4] text-[#6b5240] italic">
                      {src.expectedTime}
                    </td>
                    <td className="p-3 border-b border-[#e5ddd4]">
                      <div className="flex items-center gap-2">
                        <span className="w-[10px] h-[10px] rounded-full" style={{ backgroundColor: colors.dot }} />
                        <span className={`text-[12px] font-semibold ${colors.text}`}>
                          {r.overallStatus.label}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 border-b border-[#e5ddd4] text-center">
                      {hasSubRows && (
                        <span className="text-[12px] text-[#6b5240]">
                          {isExpanded ? '▲' : '▼'} {r.subRows.length}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && r.subRows.map((sub, idx) => {
                    const subColors = STATUS_COLORS[sub.status.code];
                    return (
                      <tr key={`${src.id}-${idx}`} className="bg-[#fafaf8]">
                        <td className="p-2 pl-8 text-[12px] border-b border-[#e5ddd4] text-[#6b5240]">
                          ↳ {sub.dimensionLabel}
                        </td>
                        <td className="p-2 text-[12px] border-b border-[#e5ddd4] text-[#6b5240]">
                          {fmtDate(sub.lastDate)}
                        </td>
                        <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-[#6b5240]">
                          {fmtDateTime(sub.lastUpload)}
                        </td>
                        <td className="p-2 border-b border-[#e5ddd4]"></td>
                        <td className="p-2 border-b border-[#e5ddd4]">
                          <div className="flex items-center gap-2">
                            <span className="w-[8px] h-[8px] rounded-full" style={{ backgroundColor: subColors.dot }} />
                            <span className={`text-[11px] font-semibold ${subColors.text}`}>
                              {sub.status.label}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 border-b border-[#e5ddd4]"></td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 text-[11px] text-[#a08a74] italic">
        <p>Drempels: 🟢 vandaag of gisteren · 🟠 eergisteren · 🔴 ouder dan eergisteren</p>
        <p>Klik op een rij om uitsplitsing per store of BUM te zien.</p>
      </div>
    </div>
  );
}
