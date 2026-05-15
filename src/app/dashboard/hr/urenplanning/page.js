/* ============================================================
   BESTAND: page-urenplanning.js
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning/page.js
   (nieuwe folder: src/app/dashboard/hr/urenplanning/)

   Voor BUMs (en admins): targets invullen voor volgende week + maand
   Toegang: role='bum' of role='admin'
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

const BU_TARGETS = {
  'BU Appliance/Houseware': 1848,
  'BU Building Materials': 165,
  'BU Hardware': 2794,
  'BU Living': 2514,
  'BU Sanitair/Keuken': 1380,
};

const SUB_AFDELINGEN = {
  'BU Appliance/Houseware': ['A/H Operations', 'A/H Management', 'Inkoop'],
  'BU Building Materials': ['Building Materials Management'],
  'BU Hardware': ['Hardware Operations', 'Hardware Management'],
  'BU Living': ['Living Operations', 'Living Management'],
  'BU Sanitair/Keuken': ['S/K Operations', 'S/K Management'],
};

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}
function getNextWeek() {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return getISOWeek(next);
}
function getNextMonth() {
  const now = new Date();
  let m = now.getMonth() + 2;
  let y = now.getFullYear();
  if (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}
function isDeadlinePassed() {
  const now = new Date();
  const dow = now.getDay();
  if (dow === 6 || dow === 0) return true;
  if (dow === 5 && now.getHours() >= 12) return true;
  return false;
}

const MONTH_NAMES = ['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];

export default function UrenplanningPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selectedBU, setSelectedBU] = useState(null);
  const [tab, setTab] = useState('week');
  const [weekTargets, setWeekTargets] = useState({});
  const [monthTargets, setMonthTargets] = useState({});
  const [existingWeek, setExistingWeek] = useState(null);
  const [existingMonth, setExistingMonth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const nextWeek = getNextWeek();
  const nextMonth = getNextMonth();

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);

      const { data: p } = await supabase.from('profiles').select('role, bu_assignment, email, full_name').eq('id', u.id).single();
      if (!p || (p.role !== 'bum' && p.role !== 'admin')) {
        router.push('/dashboard');
        return;
      }
      setProfile(p);

      let bu = p.bu_assignment;
      if (p.role === 'admin' && !bu) bu = 'BU Hardware';
      setSelectedBU(bu);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedBU) return;
    loadExisting();
  }, [selectedBU]);

  async function loadExisting() {
    const { data: w } = await supabase.from('urenplanning_targets').select('*')
      .eq('bu', selectedBU).eq('period_type', 'week')
      .eq('period_year', nextWeek.year).eq('period_value', nextWeek.week);
    setExistingWeek(w && w.length ? w : null);
    if (w && w.length) {
      const map = {};
      w.forEach(r => { map[r.sub_afdeling || '__bu__'] = r.target_hours; });
      setWeekTargets(map);
    } else {
      const subs = SUB_AFDELINGEN[selectedBU] || [];
      const buTarget = BU_TARGETS[selectedBU] || 0;
      const weekTarget = Math.round(buTarget / 4.33);
      const perSub = subs.length ? Math.round(weekTarget / subs.length) : weekTarget;
      const init = { '__bu__': weekTarget };
      subs.forEach(s => { init[s] = perSub; });
      setWeekTargets(init);
    }

    const { data: m } = await supabase.from('urenplanning_targets').select('*')
      .eq('bu', selectedBU).eq('period_type', 'month')
      .eq('period_year', nextMonth.year).eq('period_value', nextMonth.month);
    setExistingMonth(m && m.length ? m : null);
    if (m && m.length) {
      const map = {};
      m.forEach(r => { map[r.sub_afdeling || '__bu__'] = r.target_hours; });
      setMonthTargets(map);
    } else {
      const subs = SUB_AFDELINGEN[selectedBU] || [];
      const buTarget = BU_TARGETS[selectedBU] || 0;
      const perSub = subs.length ? Math.round(buTarget / subs.length) : buTarget;
      const init = { '__bu__': buTarget };
      subs.forEach(s => { init[s] = perSub; });
      setMonthTargets(init);
    }
  }

  async function save(type) {
    setSaving(true);
    setSaveMsg('');
    const targets = type === 'week' ? weekTargets : monthTargets;
    const periodYear = type === 'week' ? nextWeek.year : nextMonth.year;
    const periodValue = type === 'week' ? nextWeek.week : nextMonth.month;

    const rows = Object.entries(targets).map(([sub, hours]) => ({
      bu: selectedBU,
      bum_email: profile.email,
      period_type: type,
      period_year: periodYear,
      period_value: periodValue,
      sub_afdeling: sub === '__bu__' ? null : sub,
      target_hours: parseFloat(hours) || 0,
      updated_at: new Date().toISOString(),
    }));

    // Delete bestaande rijen voor deze periode + bu, dan insert
    await supabase.from('urenplanning_targets').delete()
      .eq('bu', selectedBU).eq('period_type', type)
      .eq('period_year', periodYear).eq('period_value', periodValue);

    const { error } = await supabase.from('urenplanning_targets').insert(rows);
    if (error) {
      setSaveMsg('Fout: ' + error.message);
    } else {
      setSaveMsg('Opgeslagen');
      loadExisting();
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(''), 3000);
  }

  if (loading) {
    return (
      <div style={{minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, fontFamily:"'DM Sans',sans-serif"}}>
        <div style={{width:64, height:64, borderRadius:14, background:'#D63B1A', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:24, letterSpacing:'-.5px', boxShadow:'0 4px 12px rgba(214,59,26,.25)', animation:'pulse 1.5s ease-in-out infinite'}}>BD</div>
        <div style={{fontSize:13, color:'#6b6960', fontWeight:500}}>Urenplanning laden...</div>
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.95)}}`}</style>
      </div>
    );
  }

  const subs = SUB_AFDELINGEN[selectedBU] || [];
  const currentTargets = tab === 'week' ? weekTargets : monthTargets;
  const setCurrentTargets = tab === 'week' ? setWeekTargets : setMonthTargets;
  const subSum = subs.reduce((s, sub) => s + (parseFloat(currentTargets[sub]) || 0), 0);
  const buTarget = parseFloat(currentTargets['__bu__']) || 0;
  const diff = subSum - buTarget;

  const deadlinePassed = isDeadlinePassed();
  const weekNotFilled = !existingWeek;

  const periodLabel = tab === 'week'
    ? `Week ${nextWeek.week}, ${nextWeek.year}`
    : `${MONTH_NAMES[nextMonth.month - 1]} ${nextMonth.year}`;

  return (
    <div style={{maxWidth:1100, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:700, margin:0}}>
          Urenplanning <span style={{background:'#fff3cd', color:'#856404', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:8, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Concept</span>
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>Targets voor volgende week en volgende maand invullen. Deadline: <strong>elke vrijdag 12:00</strong> voor de week erna.</p>
      </div>

      {profile.role === 'admin' && (
        <div style={{background:'#fff', padding:'12px 16px', borderRadius:10, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <span style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#9c978c', marginRight:10, letterSpacing:'.4px'}}>Admin — kies BU:</span>
          <select value={selectedBU || ''} onChange={e => setSelectedBU(e.target.value)} style={{padding:'6px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13}}>
            {Object.keys(BU_TARGETS).map(bu => <option key={bu} value={bu}>{bu}</option>)}
          </select>
        </div>
      )}

      {deadlinePassed && weekNotFilled && tab === 'week' && (
        <div style={{background:'#fee', border:'1.5px solid #a33225', padding:'10px 14px', borderRadius:8, marginBottom:16, color:'#a33225', fontSize:13, fontWeight:500}}>
          <strong>Deadline gemist:</strong> de target voor volgende week (week {nextWeek.week}) had vrijdag 12:00 ingevuld moeten zijn.
        </div>
      )}

      <div style={{display:'flex', gap:0, marginBottom:18, borderBottom:'2px solid rgba(0,0,0,0.08)'}}>
        <button onClick={() => setTab('week')} style={{padding:'10px 18px', border:'none', background:'transparent', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', color: tab === 'week' ? '#D63B1A' : '#6b6960', borderBottom: tab === 'week' ? '2px solid #D63B1A' : '2px solid transparent', marginBottom:-2}}>
          Volgende week ({nextWeek.week})
        </button>
        <button onClick={() => setTab('month')} style={{padding:'10px 18px', border:'none', background:'transparent', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', color: tab === 'month' ? '#D63B1A' : '#6b6960', borderBottom: tab === 'month' ? '2px solid #D63B1A' : '2px solid transparent', marginBottom:-2}}>
          Volgende maand
        </button>
      </div>

      <div style={{background:'#fff', borderRadius:14, padding:24, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)'}}>
        <div style={{fontSize:15, fontWeight:600, marginBottom:4}}>{selectedBU} — {periodLabel}</div>
        <div style={{fontSize:12, color:'#9c978c', marginBottom:18}}>BU-target uit de planning is de gegeven richtlijn. Verdeling over subafdelingen is jouw verantwoordelijkheid.</div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 140px', gap:14, alignItems:'center', marginBottom:8, paddingBottom:10, borderBottom:'1px solid rgba(0,0,0,0.08)'}}>
          <div style={{fontWeight:600}}>BU-totaal target</div>
          <input type="number" value={currentTargets['__bu__'] || 0} onChange={e => setCurrentTargets({...currentTargets, '__bu__': e.target.value})} style={{padding:'8px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:"'JetBrains Mono',monospace", fontSize:13, textAlign:'right'}} />
        </div>

        {subs.length > 0 && (
          <>
            <div style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', margin:'18px 0 10px'}}>Verdeling over subafdelingen</div>
            {subs.map(sub => (
              <div key={sub} style={{display:'grid', gridTemplateColumns:'1fr 140px', gap:14, alignItems:'center', marginBottom:8}}>
                <div style={{paddingLeft:14, color:'#6b6960'}}>{sub}</div>
                <input type="number" value={currentTargets[sub] || 0} onChange={e => setCurrentTargets({...currentTargets, [sub]: e.target.value})} style={{padding:'8px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:"'JetBrains Mono',monospace", fontSize:13, textAlign:'right'}} />
              </div>
            ))}
            <div style={{display:'grid', gridTemplateColumns:'1fr 140px', gap:14, marginTop:14, paddingTop:10, borderTop:'1px solid rgba(0,0,0,0.08)', fontSize:12.5}}>
              <div style={{color: Math.abs(diff) < 1 ? '#2d6b3f' : '#a33225', fontWeight:600}}>
                Som subafdelingen: {subSum.toFixed(0)} • verschil met BU-totaal: {diff > 0 ? '+' : ''}{diff.toFixed(0)}
                {Math.abs(diff) >= 1 && <span style={{marginLeft:6, fontWeight:400}}>(idealiter 0)</span>}
              </div>
            </div>
          </>
        )}

        <div style={{marginTop:20, display:'flex', gap:12, alignItems:'center'}}>
          <button onClick={() => save(tab)} disabled={saving} style={{padding:'10px 22px', background:'#D63B1A', color:'#fff', border:'none', borderRadius:7, fontFamily:'inherit', fontSize:13, fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow:'0 2px 6px rgba(214,59,26,.25)'}}>
            {saving ? 'Opslaan...' : `Opslaan voor ${periodLabel}`}
          </button>
          {saveMsg && <span style={{fontSize:13, color: saveMsg.startsWith('Fout') ? '#a33225' : '#2d6b3f', fontWeight:500}}>{saveMsg}</span>}
          {(tab === 'week' ? existingWeek : existingMonth) && !saveMsg && (
            <span style={{fontSize:12, color:'#6b6960'}}>Eerder opgeslagen — klik op opslaan om te wijzigen</span>
          )}
        </div>
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te lezen:</strong> de BU-target uit het CFO-dashboard (10% reductie t.o.v. rolling 12-mnd gemiddelde) wordt vooringevuld. Je kunt deze aanpassen naar wat realistisch is voor de specifieke week of maand. Verdeling over subafdelingen wordt nu vastgelegd, floormanagers krijgen later eigen toegang om binnen elke subafdeling per medewerker te plannen. Targets zijn maximaal, niet gegarandeerd.
      </div>
    </div>
  );
}
