/* ============================================================
   BESTAND: page-urenplanning-overview.js
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning-overview/page.js
   (nieuwe folder: src/app/dashboard/hr/urenplanning-overview/)

   Voor CFO: overzicht van wat BUMs hebben ingevuld
   Toegang: alleen admin
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

const BU_LIST = [
  'BU Appliance/Houseware',
  'BU Building Materials',
  'BU Hardware',
  'BU Living',
  'BU Sanitair/Keuken',
];

const BUM_BY_BU = {
  'BU Appliance/Houseware': 'Daniel Louman',
  'BU Building Materials': 'Ivo Proveniers',
  'BU Hardware': 'John Candelaria',
  'BU Living': 'Gijs Verkuijl',
  'BU Sanitair/Keuken': 'Henk van Veen',
};

const MONTH_NAMES = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}

export default function UrenplanningOverviewPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [periodType, setPeriodType] = useState('week');
  const [data, setData] = useState({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (!p || p.role !== 'admin') { router.push('/dashboard'); return; }
      setProfile(p);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading) return;
    load();
  }, [loading, periodType]);

  async function load() {
    const now = new Date();
    const thisWeek = getISOWeek(now);
    const thisMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };

    // Pak komende 4 perioden
    const periods = [];
    if (periodType === 'week') {
      for (let i = 0; i < 4; i++) {
        const d = new Date(); d.setDate(d.getDate() + i * 7);
        periods.push(getISOWeek(d));
      }
    } else {
      for (let i = 0; i < 4; i++) {
        let m = thisMonth.month + i;
        let y = thisMonth.year;
        while (m > 12) { m -= 12; y += 1; }
        periods.push({ year: y, month: m });
      }
    }

    const { data: rows } = await supabase.from('urenplanning_targets')
      .select('*').eq('period_type', periodType);

    const lookup = {};
    (rows || []).forEach(r => {
      const k = `${r.bu}|${r.period_year}|${r.period_value}`;
      if (!lookup[k]) lookup[k] = { bu_total: 0, subs: {}, updated_at: r.updated_at, bum: r.bum_email };
      if (r.sub_afdeling === null) lookup[k].bu_total = r.target_hours;
      else lookup[k].subs[r.sub_afdeling] = r.target_hours;
      if (r.updated_at > lookup[k].updated_at) lookup[k].updated_at = r.updated_at;
    });

    setData({ periods, lookup });
  }

  if (loading) {
    return (
      <div style={{minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, fontFamily:"'DM Sans',sans-serif"}}>
        <img src="/logo.png" alt="Booming Solutions" style={{width:64, height:64, borderRadius:14, animation:'pulse 1.5s ease-in-out infinite'}} />
        <div style={{fontSize:13, color:'#6b6960', fontWeight:500}}>Overzicht laden...</div>
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.95)}}`}</style>
      </div>
    );
  }

  const { periods = [], lookup = {} } = data;

  return (
    <div style={{maxWidth:1280, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:700, margin:0}}>
          Urenplanning Overzicht <span style={{background:'#fff3cd', color:'#856404', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:8, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Concept</span>
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>Wat BUMs hebben ingevuld voor de komende periodes. Vergelijken tegen actuals komt later.</p>
      </div>

      <div style={{display:'flex', gap:0, marginBottom:18, borderBottom:'2px solid rgba(0,0,0,0.08)'}}>
        <button onClick={() => setPeriodType('week')} style={{padding:'10px 18px', border:'none', background:'transparent', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', color: periodType === 'week' ? '#D63B1A' : '#6b6960', borderBottom: periodType === 'week' ? '2px solid #D63B1A' : '2px solid transparent', marginBottom:-2}}>
          Per week
        </button>
        <button onClick={() => setPeriodType('month')} style={{padding:'10px 18px', border:'none', background:'transparent', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', color: periodType === 'month' ? '#D63B1A' : '#6b6960', borderBottom: periodType === 'month' ? '2px solid #D63B1A' : '2px solid transparent', marginBottom:-2}}>
          Per maand
        </button>
      </div>

      <div style={{background:'#fff', borderRadius:14, padding:24, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)', overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12.5}}>
          <thead>
            <tr>
              <th style={{textAlign:'left', padding:'8px 10px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10.5, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c'}}>BU</th>
              <th style={{textAlign:'left', padding:'8px 10px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10.5, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c'}}>BUM</th>
              {periods.map((p, i) => (
                <th key={i} style={{textAlign:'right', padding:'8px 10px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10.5, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c'}}>
                  {periodType === 'week' ? `wk ${p.week}, ${p.year}` : `${MONTH_NAMES[p.month - 1].slice(0,3)} ${p.year}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BU_LIST.map(bu => (
              <tr key={bu}>
                <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontWeight:500}}>{bu}</td>
                <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', color:'#6b6960'}}>{BUM_BY_BU[bu]}</td>
                {periods.map((p, i) => {
                  const k = `${bu}|${p.year}|${periodType === 'week' ? p.week : p.month}`;
                  const entry = lookup[k];
                  if (!entry) {
                    return <td key={i} style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', color:'#a33225', fontFamily:"'JetBrains Mono',monospace"}}>niet ingevuld</td>;
                  }
                  return (
                    <td key={i} style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace"}}>
                      <strong>{Math.round(entry.bu_total).toLocaleString('nl-NL')}</strong>
                      <div style={{fontSize:10, color:'#9c978c', marginTop:2}}>{new Date(entry.updated_at).toLocaleDateString('nl-NL')}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Status:</strong> BUMs vullen targets in voor de komende week (deadline elke vrijdag 12:00) en komende maand. "Niet ingevuld" = nog niet door BUM ingevuld. In een volgende update voegen we hier de actual-uren vergelijking aan toe wanneer Dyflexis-data binnenkomt.
      </div>
    </div>
  );
}
