/* ============================================================
   BESTAND: page-urenplanning.js (v3)
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning/page.js
   (overschrijft de bestaande page.js)

   WIJZIGINGEN v3:
   - Sticky tabel-header: dagen blijven zichtbaar bij scrollen
   - Klik op "Medewerker" kolom = sorteer A→Z voornaam → Z→A → default toggle
   - Nieuwe kolom "Contract uren": 40h × deeltijdpercentage uit C16
     (alleen voor Vast contract; Flex en onbekend tonen "-")
   - Live overschrijdings-melding: rood label "+Xu boven contract — overwerk?"
     onder week-totaal zodra ingevulde uren > contracturen

   WIJZIGINGEN v2:
   - Dag-niveau invoer per medewerker (Ma t/m Zo)
   - Overwerk-kolom per medewerker (één getal per week)
   - Medewerker-lijst per BU vanuit Dyflexis laatste 3 mnd
   - Sortering: meest actieve medewerkers bovenaan
   - Knop "+ Nieuwe medewerker" — toevoegen op de fly (niet permanent)
   - Contract-tag (Vast/Flex) achter elke naam
   - Logo: Booming Solutions /logo.png ipv BD-vlak
   - Week navigatie: vorige/volgende week
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// Medewerkers per BU — gebouwd uit Dyflexis data (jan-26 t/m apr-26)
// Bovenaan: meest actieve medewerkers laatste 3 maanden
const BU_EMPLOYEES = {"BU Appliance/Houseware":[{"name":"Michanu Isenia","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Michelangelo Lourens","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Ruthlyn Comenencia Martina","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Shelah Janga","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Nilo  Grotestam","contract":"Flexibel","sub":"A/H Operations","contract_hours":null},{"name":"Sheila Lacrum Wawoe","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Francisco Doran","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Christopher Bakmeijer","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Rudelly Mauricia","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Daniel Louman","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Kevin Djotaroeno","contract":"Onbekend","sub":"A/H Management","contract_hours":null}],"BU Building Materials":[{"name":"Niasotis Dandare Ellis","contract":"Vast","sub":"Building Materials Management","contract_hours":40.0}],"BU Hardware":[{"name":"Tercy Stewart","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shannon Martha","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marciela Andrea","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Gilbert Santiroma","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marshelon Janzen","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"John Candelaria","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shuwender Rosini","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Keith Taylor","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Eliana  Dangond Pabon","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Jowendrick Sillie","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Archel Presentacion","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Minguel Goedgedrag","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Javier Martis","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Noah Frankenberger","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marlon Meyer","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Rishantely Jantje","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Christopher Bregita","contract":"Vast","sub":"Hardware Operations","contract_hours":24.0},{"name":"Jhonny Garves","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Noudimar Dorothea","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Tyshawn  Angela","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Raymi-Engelo Regina","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Vai-Ona Martines","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Guishawn Wanga","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Dejuan Brown","contract":"Onbekend","sub":"Hardware Operations","contract_hours":null},{"name":"Rigchantely Da Costa Gomez","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null}],"BU Living":[{"name":"Gijs Verkuijl","contract":"Onbekend","sub":"Living Management","contract_hours":null},{"name":"Franklin Domatilia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Ingerson Carmela","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Sus-Marianne Anastasia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Vianel Brazoban","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Laymine Zimmerman","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Sidmarelly Henriquez","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Tharinah Sophia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Thysheliene Martiszoon","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Connelly  Lourens","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Dianne Meyer - Walle","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Nareelis Jakoba","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Roberto Badaracco","contract":"Vast","sub":"Living Management","contract_hours":32.0},{"name":"Armigilda Kopra","contract":"Vast","sub":"Living Operations","contract_hours":28.0},{"name":"Hannah Perlaza","contract":"Onbekend","sub":"Living Operations","contract_hours":null},{"name":"Mariejela Rosinda Victor","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Dianni Colon","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Jair Mattheeuw","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Qiyazir Lake","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Carina Tidu","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Noemi-Eluzai Cijntje","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Zufreni Martis","contract":"Onbekend","sub":"Living Operations","contract_hours":null}],"BU Sanitair/Keuken":[{"name":"Michael Matroos","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Navin Ramdjas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Enoc Merkies","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Mireya Meyer Rojas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Steven Rogers","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Vianaly Victor","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Jamira Webster","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Ivo Proveniers","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Henk Van Veen","contract":"Vast","sub":"S/K Management","contract_hours":40.0}]};

const NL_DAYS = ['Ma','Di','Wo','Do','Vr','Za','Zo'];

// ISO week functies
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}

function getMondayOfISOWeek(year, week) {
  // 4 jan zit altijd in week 1 (ISO)
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // ma=1, zo=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

function getNextWeek() {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return getISOWeek(next);
}

function shiftWeek(year, week, delta) {
  const monday = getMondayOfISOWeek(year, week);
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return getISOWeek(monday);
}

function formatDate(date) {
  return `${date.getUTCDate()}-${date.getUTCMonth()+1}`;
}

function isDeadlinePassed() {
  const now = new Date();
  const dow = now.getDay();
  if (dow === 6 || dow === 0) return true;
  if (dow === 5 && now.getHours() >= 12) return true;
  return false;
}

export default function UrenplanningPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [selectedBU, setSelectedBU] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(getNextWeek());
  const [employees, setEmployees] = useState([]);
  const [hours, setHours] = useState({});      // {empName: {day1: 8, day2: 8, ...}}
  const [overtime, setOvertime] = useState({}); // {empName: 5}
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpContract, setNewEmpContract] = useState('Vast');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [sortMode, setSortMode] = useState('default'); // 'default' | 'asc' | 'desc'

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role, bu_assignment, email, full_name').eq('id', user.id).single();
      if (!p || (p.role !== 'bum' && p.role !== 'admin' && p.role !== 'floormanager')) {
        router.push('/dashboard');
        return;
      }
      setProfile(p);
      let bu = p.bu_assignment;
      if ((p.role === 'admin' || !bu) && Object.keys(BU_EMPLOYEES).length > 0) {
        bu = bu || Object.keys(BU_EMPLOYEES)[0];
      }
      setSelectedBU(bu);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedBU) return;
    loadData();
  }, [selectedBU, currentWeek]);

  async function loadData() {
    // Base employee list uit Dyflexis (inclusief contract_hours)
    const baseList = BU_EMPLOYEES[selectedBU] || [];

    // Pak alle reeds opgeslagen rijen voor deze week → kan extra namen bevatten (toegevoegd door BUM)
    const { data: dayRows } = await supabase.from('urenplanning_dagelijks').select('*')
      .eq('bu', selectedBU)
      .eq('period_year', currentWeek.year)
      .eq('period_week', currentWeek.week);
    const { data: otRows } = await supabase.from('urenplanning_overwerk').select('*')
      .eq('bu', selectedBU)
      .eq('period_year', currentWeek.year)
      .eq('period_week', currentWeek.week);

    // Bouw de medewerkerslijst: base + extras die in DB staan maar niet in base
    const empMap = {};
    baseList.forEach((e, idx) => { empMap[e.name] = { ...e, added: false, defaultOrder: idx }; });
    let extraIdx = 9999;
    (dayRows || []).forEach(r => {
      if (!empMap[r.employee_name]) {
        empMap[r.employee_name] = { name: r.employee_name, contract: r.contract_type || 'Onbekend', sub: '', contract_hours: null, added: true, defaultOrder: extraIdx++ };
      }
    });
    (otRows || []).forEach(r => {
      if (!empMap[r.employee_name]) {
        empMap[r.employee_name] = { name: r.employee_name, contract: r.contract_type || 'Onbekend', sub: '', contract_hours: null, added: true, defaultOrder: extraIdx++ };
      }
    });

    setEmployees(Object.values(empMap));

    // Load hours
    const hoursMap = {};
    (dayRows || []).forEach(r => {
      if (!hoursMap[r.employee_name]) hoursMap[r.employee_name] = {};
      hoursMap[r.employee_name][r.day_of_week] = r.hours;
    });
    setHours(hoursMap);

    // Load overtime
    const otMap = {};
    (otRows || []).forEach(r => {
      otMap[r.employee_name] = r.overtime_hours;
    });
    setOvertime(otMap);
  }

  function updateHour(empName, day, value) {
    const v = value === '' ? '' : parseFloat(value);
    setHours(prev => ({
      ...prev,
      [empName]: { ...(prev[empName] || {}), [day]: v }
    }));
  }

  function updateOvertime(empName, value) {
    const v = value === '' ? '' : parseFloat(value);
    setOvertime(prev => ({ ...prev, [empName]: v }));
  }

  function addEmployee() {
    if (!newEmpName.trim()) return;
    const trimmed = newEmpName.trim();
    if (employees.some(e => e.name === trimmed)) {
      setSaveMsg('Medewerker staat al in de lijst');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    const maxOrder = employees.reduce((m, e) => Math.max(m, e.defaultOrder || 0), 9999);
    setEmployees(prev => [...prev, { name: trimmed, contract: newEmpContract, sub: '', contract_hours: null, added: true, defaultOrder: maxOrder + 1 }]);
    setNewEmpName('');
    setNewEmpContract('Vast');
  }

  async function save() {
    setSaving(true);
    setSaveMsg('');

    // Verzamel dag-rijen
    const dayRowsToInsert = [];
    employees.forEach(emp => {
      const h = hours[emp.name] || {};
      for (let day = 1; day <= 7; day++) {
        const val = h[day];
        if (val !== undefined && val !== '' && val !== null && parseFloat(val) >= 0) {
          dayRowsToInsert.push({
            bu: selectedBU,
            period_year: currentWeek.year,
            period_week: currentWeek.week,
            day_of_week: day,
            employee_name: emp.name,
            contract_type: emp.contract,
            hours: parseFloat(val) || 0,
            bum_email: profile.email,
            updated_at: new Date().toISOString(),
          });
        }
      }
    });

    // Overwerk-rijen
    const otRowsToInsert = [];
    employees.forEach(emp => {
      const val = overtime[emp.name];
      if (val !== undefined && val !== '' && val !== null && parseFloat(val) > 0) {
        otRowsToInsert.push({
          bu: selectedBU,
          period_year: currentWeek.year,
          period_week: currentWeek.week,
          employee_name: emp.name,
          contract_type: emp.contract,
          overtime_hours: parseFloat(val) || 0,
          bum_email: profile.email,
          updated_at: new Date().toISOString(),
        });
      }
    });

    // Delete oude rijen voor deze week + bu, dan insert
    await supabase.from('urenplanning_dagelijks').delete()
      .eq('bu', selectedBU).eq('period_year', currentWeek.year).eq('period_week', currentWeek.week);
    await supabase.from('urenplanning_overwerk').delete()
      .eq('bu', selectedBU).eq('period_year', currentWeek.year).eq('period_week', currentWeek.week);

    if (dayRowsToInsert.length > 0) {
      const { error } = await supabase.from('urenplanning_dagelijks').insert(dayRowsToInsert);
      if (error) {
        setSaveMsg('Fout opslaan uren: ' + error.message);
        setSaving(false);
        return;
      }
    }
    if (otRowsToInsert.length > 0) {
      const { error } = await supabase.from('urenplanning_overwerk').insert(otRowsToInsert);
      if (error) {
        setSaveMsg('Fout opslaan overwerk: ' + error.message);
        setSaving(false);
        return;
      }
    }

    setSaveMsg('Opgeslagen ✓');
    setSaving(false);
    setTimeout(() => setSaveMsg(''), 3000);
    loadData();
  }

  if (loading) {
    return (
      <div style={{minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, fontFamily:"'DM Sans',sans-serif"}}>
        <img src="/logo.png" alt="Booming Solutions" style={{width:64, height:64, borderRadius:14, animation:'pulse 1.5s ease-in-out infinite'}} />
        <div style={{fontSize:13, color:'#6b6960', fontWeight:500}}>Urenplanning laden...</div>
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.95)}}`}</style>
      </div>
    );
  }

  // Maandag van currentWeek
  const monday = getMondayOfISOWeek(currentWeek.year, currentWeek.week);
  const dayDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dayDates.push(d);
  }

  // Sorteer medewerkers volgens sortMode
  const firstName = (n) => (n || '').split(' ')[0].toLowerCase();
  const sortedEmployees = [...employees];
  if (sortMode === 'asc') {
    sortedEmployees.sort((a, b) => firstName(a.name).localeCompare(firstName(b.name)));
  } else if (sortMode === 'desc') {
    sortedEmployees.sort((a, b) => firstName(b.name).localeCompare(firstName(a.name)));
  } else {
    sortedEmployees.sort((a, b) => (a.defaultOrder || 0) - (b.defaultOrder || 0));
  }

  function cycleSortMode() {
    setSortMode(prev => prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default');
  }

  // Sums per dag + overall
  const dayTotals = [0,0,0,0,0,0,0];
  let weekGrandTotal = 0;
  let overtimeTotal = 0;
  employees.forEach(emp => {
    const h = hours[emp.name] || {};
    for (let d = 1; d <= 7; d++) {
      const v = parseFloat(h[d]) || 0;
      dayTotals[d-1] += v;
      weekGrandTotal += v;
    }
    overtimeTotal += parseFloat(overtime[emp.name]) || 0;
  });

  const deadlinePassed = isDeadlinePassed();
  const isNextWeek = (() => {
    const nw = getNextWeek();
    return nw.year === currentWeek.year && nw.week === currentWeek.week;
  })();

  const sortIcon = sortMode === 'asc' ? ' ↑' : sortMode === 'desc' ? ' ↓' : ' ↕';
  const headerStyle = {position:'sticky', top:0, zIndex:5, background:'#fff', padding:'10px 10px 8px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10.5, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c'};

  return (
    <div style={{maxWidth:1400, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:700, margin:0}}>
          Urenplanning <span style={{background:'#fff3cd', color:'#856404', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:8, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Concept</span>
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>Plan per medewerker per dag. Deadline: <strong>elke vrijdag 12:00</strong> voor de week erna.</p>
      </div>

      {profile.role === 'admin' && (
        <div style={{background:'#fff', padding:'12px 16px', borderRadius:10, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <span style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#9c978c', marginRight:10, letterSpacing:'.4px'}}>Admin — kies BU:</span>
          <select value={selectedBU || ''} onChange={e => setSelectedBU(e.target.value)} style={{padding:'6px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13}}>
            {Object.keys(BU_EMPLOYEES).map(bu => <option key={bu} value={bu}>{bu}</option>)}
          </select>
        </div>
      )}

      {deadlinePassed && isNextWeek && (
        <div style={{background:'#fee', border:'1.5px solid #a33225', padding:'10px 14px', borderRadius:8, marginBottom:16, color:'#a33225', fontSize:13, fontWeight:500}}>
          <strong>Deadline gemist:</strong> de planning voor week {currentWeek.week} had vrijdag 12:00 ingevuld moeten zijn.
        </div>
      )}

      {/* Week navigatie — STICKY */}
      <div style={{position:'sticky', top:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, padding:'12px 18px', background:'#fff', borderRadius:10, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <button onClick={() => setCurrentWeek(shiftWeek(currentWeek.year, currentWeek.week, -1))} style={{padding:'8px 14px', border:'1.5px solid rgba(0,0,0,0.14)', background:'#fff', borderRadius:7, fontFamily:'inherit', fontSize:12.5, fontWeight:500, cursor:'pointer'}}>← Vorige week</button>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:15, fontWeight:600}}>{selectedBU}</div>
          <div style={{fontSize:13, color:'#6b6960'}}>Week {currentWeek.week}, {currentWeek.year} ({formatDate(dayDates[0])} t/m {formatDate(dayDates[6])})</div>
        </div>
        <button onClick={() => setCurrentWeek(shiftWeek(currentWeek.year, currentWeek.week, 1))} style={{padding:'8px 14px', border:'1.5px solid rgba(0,0,0,0.14)', background:'#fff', borderRadius:7, fontFamily:'inherit', fontSize:12.5, fontWeight:500, cursor:'pointer'}}>Volgende week →</button>
      </div>

      {/* Tabel */}
      <div style={{background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)', overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0, fontSize:12.5}}>
          <thead>
            <tr>
              <th style={{...headerStyle, textAlign:'left', cursor:'pointer', userSelect:'none'}} onClick={cycleSortMode} title="Klik om te sorteren op voornaam">
                Medewerker{sortIcon}
              </th>
              <th style={{...headerStyle, textAlign:'center', width:70}}>Contract</th>
              <th style={{...headerStyle, textAlign:'right', width:75}}>Contract uren</th>
              {NL_DAYS.map((d, i) => (
                <th key={i} style={{...headerStyle, textAlign:'center', padding:'10px 6px', width:60}}>
                  {d}<br/><span style={{fontSize:9, color:'#9c978c', fontWeight:400}}>{dayDates[i].getUTCDate()}-{dayDates[i].getUTCMonth()+1}</span>
                </th>
              ))}
              <th style={{...headerStyle, textAlign:'right', width:65}}>Wk tot.</th>
              <th style={{...headerStyle, textAlign:'center', padding:'10px 6px', color:'#a33225', width:80}}>Overwerk</th>
            </tr>
          </thead>
          <tbody>
            {sortedEmployees.map(emp => {
              const h = hours[emp.name] || {};
              let rowTotal = 0;
              for (let d = 1; d <= 7; d++) rowTotal += parseFloat(h[d]) || 0;
              const contractColor = emp.contract === 'Flexibel' ? {bg:'#ffe5d6', col:'#a33225'} : emp.contract === 'Vast' ? {bg:'#e0e7d4', col:'#3a5a2c'} : {bg:'#e8e8e8', col:'#666'};
              const showContractHours = emp.contract === 'Vast' && emp.contract_hours !== null && emp.contract_hours !== undefined;
              const overContract = showContractHours && rowTotal > emp.contract_hours;
              const overBy = overContract ? (rowTotal - emp.contract_hours).toFixed(1) : 0;
              return (
                <tr key={emp.name}>
                  <td style={{padding:'8px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:12.5}}>
                    {emp.name}
                    {emp.added && <span style={{marginLeft:6, fontSize:10, color:'#D63B1A', fontWeight:600}}>nieuw</span>}
                  </td>
                  <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center'}}>
                    <span style={{display:'inline-block', fontSize:9.5, padding:'1.5px 6px', borderRadius:3, fontWeight:600, letterSpacing:'.2px', background:contractColor.bg, color:contractColor.col}}>
                      {emp.contract === 'Flexibel' ? 'flex' : emp.contract === 'Vast' ? 'vast' : '?'}
                    </span>
                  </td>
                  <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:'#6b6960'}}>
                    {showContractHours ? emp.contract_hours : '-'}
                  </td>
                  {NL_DAYS.map((_, i) => {
                    const day = i + 1;
                    return (
                      <td key={day} style={{padding:'4px 4px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center'}}>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={h[day] === undefined || h[day] === '' ? '' : h[day]}
                          onChange={e => updateHour(emp.name, day, e.target.value)}
                          style={{width:'100%', maxWidth:50, padding:'5px 4px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:5, fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, textAlign:'center'}}
                        />
                      </td>
                    );
                  })}
                  <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, color: overContract ? '#a33225' : 'inherit'}}>
                    {rowTotal > 0 ? rowTotal.toFixed(1) : '-'}
                    {overContract && (
                      <div style={{fontSize:9.5, fontWeight:500, color:'#a33225', marginTop:2, lineHeight:1.2}}>+{overBy}u boven contract — overwerk?</div>
                    )}
                  </td>
                  <td style={{padding:'4px 4px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center'}}>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={overtime[emp.name] === undefined || overtime[emp.name] === '' ? '' : overtime[emp.name]}
                      onChange={e => updateOvertime(emp.name, e.target.value)}
                      style={{width:'100%', maxWidth:60, padding:'5px 4px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:5, fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, textAlign:'center', color:'#a33225'}}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:'#1a1a18', color:'#fff'}}>
              <td colSpan={3} style={{padding:'10px', fontWeight:700, fontSize:12}}>TOTAAL</td>
              {dayTotals.map((t, i) => (
                <td key={i} style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{t > 0 ? t.toFixed(1) : '-'}</td>
              ))}
              <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{weekGrandTotal.toFixed(1)}</td>
              <td style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:'#ff8a6c'}}>{overtimeTotal > 0 ? overtimeTotal.toFixed(1) : '-'}</td>
            </tr>
          </tfoot>
        </table>

        {/* Nieuwe medewerker toevoegen */}
        <div style={{marginTop:18, padding:'12px 14px', background:'#f5ebe0', borderRadius:8, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
          <span style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#6b6960', letterSpacing:'.4px'}}>+ Nieuwe medewerker:</span>
          <input type="text" value={newEmpName} onChange={e => setNewEmpName(e.target.value)} placeholder="Volledige naam" style={{flex:1, minWidth:200, padding:'7px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:12.5}} />
          <select value={newEmpContract} onChange={e => setNewEmpContract(e.target.value)} style={{padding:'7px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:12.5, background:'#fff'}}>
            <option value="Vast">Vast contract</option>
            <option value="Flexibel">Flex / urencontract</option>
          </select>
          <button onClick={addEmployee} style={{padding:'7px 14px', background:'#1a1a18', color:'#fff', border:'none', borderRadius:6, fontFamily:'inherit', fontSize:12.5, fontWeight:600, cursor:'pointer'}}>
            Toevoegen
          </button>
        </div>

        {/* Save knop */}
        <div style={{marginTop:18, display:'flex', gap:12, alignItems:'center'}}>
          <button onClick={save} disabled={saving} style={{padding:'10px 22px', background:'#D63B1A', color:'#fff', border:'none', borderRadius:7, fontFamily:'inherit', fontSize:13, fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow:'0 2px 6px rgba(214,59,26,.25)'}}>
            {saving ? 'Opslaan...' : `Opslaan voor week ${currentWeek.week}`}
          </button>
          {saveMsg && <span style={{fontSize:13, color: saveMsg.startsWith('Fout') || saveMsg.includes('al in') ? '#a33225' : '#2d6b3f', fontWeight:500}}>{saveMsg}</span>}
        </div>
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te lezen:</strong> Vul per medewerker per dag het aantal uren in dat hij/zij staat ingeroosterd. Overwerk-kolom is voor verwacht overwerk (geen toeslag, maar gewerkte overwerk-uren). Bij urencontract: alleen invullen op dagen dat de medewerker daadwerkelijk wordt opgeroepen. Nieuwe medewerkers kun je tijdens het invullen toevoegen — die verschijnen in de volgende week automatisch als ze uren maken in Dyflexis. Floormanagers kunnen later worden toegewezen aan subafdelingen.
      </div>
    </div>
  );
}
