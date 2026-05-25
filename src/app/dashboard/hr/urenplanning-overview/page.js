/* ============================================================
   BESTAND: page-urenplanning-overview.js
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning-overview/page.js

   DOEL: Urenplanning Overzicht — per-medewerker uren-verloop
   - 3-laags drilldown: BU > Sub-afdeling > Medewerker
   - "Hele BU" en "Hele afdeling" als opties voor totalen
   - Hoofdgrafiek: gewerkte uren per week 2026 (actuals + planning toekomst)
   - Stacked bar: regulier + overwerk + ziek + verlof per week
   - KPI-blokken: totaal gewerkt YTD, gem ziek %, totaal overuren, totaal verlof
   - Tabel met week-details

   Data uit urenplanning_dyflexis (is_actual=true = actuals, =false/null = planning)
   ============================================================ */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// Medewerkers per BU — uit C16 voor contract-info
const BU_EMPLOYEES = {"BU Appliance/Houseware":[{"name":"Michanu Isenia","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Michelangelo Lourens","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Ruthlyn Comenencia Martina","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Shelah Janga","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Nilo  Grotestam","contract":"Flexibel","sub":"A/H Operations","contract_hours":null},{"name":"Sheila Lacrum Wawoe","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Francisco Doran","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Christopher Bakmeijer","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Rudelly Mauricia","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Daniel Louman","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Kevin Djotaroeno","contract":"Onbekend","sub":"A/H Management","contract_hours":null}],"BU Building Materials":[{"name":"Niasotis Dandare Ellis","contract":"Vast","sub":"Building Materials Management","contract_hours":40.0}],"BU Hardware":[{"name":"Tercy Stewart","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shannon Martha","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marciela Andrea","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Gilbert Santiroma","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marshelon Janzen","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"John Candelaria","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shuwender Rosini","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Keith Taylor","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Eliana  Dangond Pabon","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Jowendrick Sillie","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Archel Presentacion","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Minguel Goedgedrag","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Javier Martis","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Noah Frankenberger","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marlon Meyer","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Rishantely Jantje","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Christopher Bregita","contract":"Vast","sub":"Hardware Operations","contract_hours":24.0},{"name":"Jhonny Garves","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Noudimar Dorothea","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Tyshawn  Angela","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Raymi-Engelo Regina","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Vai-Ona Martines","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Guishawn Wanga","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Dejuan Brown","contract":"Onbekend","sub":"Hardware Operations","contract_hours":null},{"name":"Rigchantely Da Costa Gomez","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null}],"BU Living":[{"name":"Gijs Verkuijl","contract":"Onbekend","sub":"Living Management","contract_hours":null},{"name":"Franklin Domatilia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Ingerson Carmela","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Sus-Marianne Anastasia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Vianel Brazoban","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Laymine Zimmerman","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Sidmarelly Henriquez","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Tharinah Sophia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Thysheliene Martiszoon","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Connelly  Lourens","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Dianne Meyer - Walle","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Nareelis Jakoba","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Roberto Badaracco","contract":"Vast","sub":"Living Management","contract_hours":32.0},{"name":"Armigilda Kopra","contract":"Vast","sub":"Living Operations","contract_hours":28.0},{"name":"Hannah Perlaza","contract":"Onbekend","sub":"Living Operations","contract_hours":null},{"name":"Mariejela Rosinda Victor","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Dianni Colon","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Jair Mattheeuw","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Qiyazir Lake","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Carina Tidu","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Noemi-Eluzai Cijntje","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Zufreni Martis","contract":"Onbekend","sub":"Living Operations","contract_hours":null}],"BU Sanitair/Keuken":[{"name":"Michael Matroos","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Navin Ramdjas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Enoc Merkies","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Mireya Meyer Rojas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Steven Rogers","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Vianaly Victor","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Jamira Webster","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Ivo Proveniers","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Henk Van Veen","contract":"Vast","sub":"S/K Management","contract_hours":40.0}],"Smart Finance":[{"name":"Judith Petronilia","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Jacqueline  Schotborgh","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Ivaira Windster","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Coralisa Windt De - Verstijnen","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Dienca  Arneman, Van","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Sharesca Niebe","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Yurriene Gonzalez","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Melivienne Legrand","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Karla Valencia - Angarita","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Wilfried Ambrotius","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Lysandra Rafaela Becker","contract":"Onbekend","sub":"Algemeen","contract_hours":null}],"Logistiek":[{"name":"Ramsley Salome","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"John van den Berg","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Robin Hooi","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Norwin Andrea","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Eugene Antonio","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Ricardo Pierre","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shakur Bernadina","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Patrick Newton","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Aldrin Vlijtig","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Harvey  Raap","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Sandrey  Richardson","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shairlyson  Sambo","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Joubert Pieters","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Xavier Werleman","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Naigelon  Clemensia","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Jurrandy Brandao","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Jurich Martina","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Hensley Sambo","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Marijke Antonia","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Ashneltrida Martis","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Herbert Pisas","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Benjamin Martijn","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Sharimar Faneite","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Germilson  Seintje","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Rowendry Martina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Gilma Coco","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Adrianus Zijlstra","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Reimy Ferero Abreu","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Lativa  Pieters","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Curtney Cicilia","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Roderick Paulina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Urlick Romsina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Denzell Russel","contract":"Flexibel","sub":"Transit","contract_hours":null},{"name":"Timothy Newton","contract":"Flexibel","sub":"Brievengat 02","contract_hours":null},{"name":"Railison Daal","contract":"Onbekend","sub":"Brievengat 05","contract_hours":null},{"name":"Rujairo Ricao","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Fabian Mom","contract":"Onbekend","sub":"Supervisors Logistiek","contract_hours":null}],"Store Support":[{"name":"Giovanni Pinedo","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Orlando Reenis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Guadeloup Elisabeth","contract":"Flexibel","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Sidney T. Molina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Ludwina Casser","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Deborah Koeyers","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Nefertari Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"David Waaldijk","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Yeyson Marte Abreu","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Shahira Roberto","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Alvin D Silberie","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Zuneida Alvarez","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Ignaldaly Garcia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Shellany Constansia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":30.0},{"name":"Luisana Chirino","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Philonairis Maria","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Lyene  Daal","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Richinella Obia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Ruthsarai Gallardo","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Keisha Martina","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Marielou  Alexander","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Handre Owens","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Stephanie  Girigori","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Adriana Martes Reyes","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Merugia Cathalina-Martis","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Rochendry Doran","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Dayanara Libinia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Carlos De Franca","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Eldert Juliana","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Dianira Scherptong","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Renaisha Wijngaarden","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Jesseline Sebelon De Wind","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Brithney Garcia","contract":"Onbekend","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Eduard Carolina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Allan Pedro","contract":"Vast","sub":"Facilitair","contract_hours":40.0},{"name":"Rose Cenord Desrosiers","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Jonathan de Wolff","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Omar Requena","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Alberto Betrian","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Chanarda Davis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Liselotte Rojer","contract":"Vast","sub":"Marketing","contract_hours":36.0},{"name":"Clifton Koeyers","contract":"Vast","sub":"Inventory Controller","contract_hours":20.0},{"name":"Jeandrelika Schoop","contract":"Flexibel","sub":"Winkel > Store support Customer Service","contract_hours":null},{"name":"Agnette Pedro - Trotman","contract":"Vast","sub":"Inventory Controller","contract_hours":32.0},{"name":"Marlon Atmodimedjo","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Luigino Kauw-A-Tjoe","contract":"Vast","sub":"Marketing","contract_hours":30.0},{"name":"Brittany Haase","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":16.0},{"name":"Quisheena Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":10.0},{"name":"Franciscus van Kessel","contract":"Vast","sub":"B2B","contract_hours":20.0},{"name":"Franklin Quinones Echeverria","contract":"Onbekend","sub":"Facilitair","contract_hours":null},{"name":"Bobby Herder","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Jundrick Jansen","contract":"Flexibel","sub":"Marketing","contract_hours":null},{"name":"Wendell Finies","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0}]};

const BU_LIST = ['BU Hardware', 'BU Living', 'BU Sanitair/Keuken', 'BU Appliance/Houseware',
                  'BU Building Materials', 'Smart Finance', 'Logistiek', 'Store Support', 'BU Kantoor'];

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d - yearStart) / 86400000) + 1) / 7),
  };
}

function normalizeName(dyflexisName) {
  if (!dyflexisName) return '';
  if (dyflexisName === 'Open dienst') return 'Open dienst';
  if (!dyflexisName.includes(',')) return dyflexisName.trim();
  const parts = dyflexisName.split(',').map(s => s.trim());
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, parts.length - 1).reverse().join(' ');
  return `${last} ${rest}`;
}

function matchEmployee(name, buEmployees) {
  const n = normalizeName(name).toLowerCase();
  const parts = n.split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0], last = parts[parts.length - 1];
  for (const e of buEmployees) {
    const ep = e.name.toLowerCase().split(/\s+/);
    if (ep[0] === first && ep[ep.length - 1] === last) return e;
  }
  return null;
}

export default function UrenplanningOverviewPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);

  // Filters
  const [selectedBU, setSelectedBU] = useState(null);
  const [selectedSub, setSelectedSub] = useState('__all__');         // '__all__' = hele BU
  const [selectedEmployee, setSelectedEmployee] = useState('__all__'); // '__all__' = hele sub

  // Data
  const [allRows, setAllRows] = useState([]); // alle 2026 records voor selected BU

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role, bu_assignment, email').eq('id', user.id).single();
      if (!p || (p.role !== 'manager' && p.role !== 'admin' && p.role !== 'directie' && p.role !== 'finance')) {
        router.push('/dashboard');
        return;
      }
      setProfile(p);
      let bu = p.bu_assignment || BU_LIST[0];
      setSelectedBU(bu);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedBU) return;
    setSelectedSub('__all__');
    setSelectedEmployee('__all__');
    loadRows();
  }, [selectedBU]);

  useEffect(() => {
    setSelectedEmployee('__all__');
  }, [selectedSub]);

  async function loadRows() {
    setDataLoading(true);
    // Pak alle 2026 records voor deze BU (actuals + planning)
    const { data, error } = await supabase
      .from('urenplanning_dyflexis')
      .select('*')
      .eq('bu', selectedBU)
      .eq('period_year', 2026);
    if (error) { console.error(error); setAllRows([]); }
    else setAllRows(data || []);
    setDataLoading(false);
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

  // === DATA TRANSFORMATIES ===

  // Unieke subs voor selected BU (uit actuals en planning rijen)
  const subOptions = useMemo(() => {
    const subs = new Set();
    allRows.forEach(r => {
      if (r.sub_afdeling) subs.add(r.sub_afdeling);
    });
    return ['__all__', ...Array.from(subs).sort()];
  }, [allRows]);

  // Filter rows op selected sub (planning + actuals samen)
  const filteredRowsBySub = useMemo(() => {
    if (selectedSub === '__all__') return allRows;
    return allRows.filter(r => r.sub_afdeling === selectedSub);
  }, [allRows, selectedSub]);

  // Unieke medewerkers in deze sub
  const employeeOptions = useMemo(() => {
    const emps = new Set();
    filteredRowsBySub.forEach(r => {
      if (r.employee_name && !r.is_open) emps.add(r.employee_name);
    });
    return ['__all__', ...Array.from(emps).sort()];
  }, [filteredRowsBySub]);

  // Filter op medewerker
  const filteredRows = useMemo(() => {
    if (selectedEmployee === '__all__') return filteredRowsBySub;
    return filteredRowsBySub.filter(r => r.employee_name === selectedEmployee);
  }, [filteredRowsBySub, selectedEmployee]);

  // Aggregaten per week (1..53)
  const weekData = useMemo(() => {
    const out = {};
    for (let w = 1; w <= 53; w++) {
      out[w] = {
        week: w,
        hours_worked: 0, regular: 0, overtime: 0,
        leave: 0, sick: 0, total: 0,
        planned: 0, actual_count: 0, planned_count: 0,
      };
    }
    filteredRows.forEach(r => {
      const w = r.period_week;
      if (!out[w]) return;
      if (r.is_actual) {
        out[w].hours_worked += parseFloat(r.hours_worked) || 0;
        out[w].overtime += parseFloat(r.overtime_total) || 0;
        out[w].leave += parseFloat(r.leave_total) || 0;
        out[w].sick += parseFloat(r.sick_total) || 0;
        out[w].total += parseFloat(r.total_hours) || 0;
        out[w].actual_count++;
        // regulier = hours_worked - overtime
        out[w].regular = out[w].hours_worked - out[w].overtime;
      } else if (!r.is_open) {
        // Planning: netto_hours per dag
        out[w].planned += parseFloat(r.netto_hours) || 0;
        out[w].planned_count++;
      }
    });
    return out;
  }, [filteredRows]);

  // KPI's
  const kpis = useMemo(() => {
    let totalWork = 0, totalSick = 0, totalLeave = 0, totalOvertime = 0, totalHours = 0;
    let weeksWithActuals = 0;
    Object.values(weekData).forEach(w => {
      if (w.actual_count > 0) {
        totalWork += w.hours_worked;
        totalSick += w.sick;
        totalLeave += w.leave;
        totalOvertime += w.overtime;
        totalHours += w.total;
        weeksWithActuals++;
      }
    });
    const avgSickPct = totalHours > 0 ? (totalSick / totalHours * 100) : 0;
    return { totalWork, totalSick, totalLeave, totalOvertime, avgSickPct, weeksWithActuals };
  }, [weekData]);

  // Contracturen voor selected employee
  const empContractInfo = useMemo(() => {
    if (selectedEmployee === '__all__') return null;
    const buEmps = BU_EMPLOYEES[selectedBU] || [];
    return matchEmployee(selectedEmployee, buEmps);
  }, [selectedEmployee, selectedBU]);

  // Bepaal welke weken planning vs actual (voor visual onderscheid)
  const today = new Date();
  const currentISO = getISOWeek(today);
  function isFutureWeek(w) {
    return w > currentISO.week || (currentISO.year > 2026);
  }

  // === RENDER HELPERS ===
  const COLOR_REGULAR = '#0056a3';
  const COLOR_OVERTIME = '#6e3bb8';   // paars
  const COLOR_SICK = '#a33225';       // rood
  const COLOR_LEAVE = '#9c978c';      // grijs
  const COLOR_PLANNED = '#cce5ff';    // licht blauw voor planning
  const COLOR_CONTRACT = '#1a1a18';

  // Vind max-waarde voor chart Y-as (voor schaal)
  const chartMax = useMemo(() => {
    let m = 0;
    Object.values(weekData).forEach(w => {
      const stack = w.regular + w.overtime + w.sick + w.leave;
      const plan = w.planned;
      m = Math.max(m, stack, plan);
    });
    return m * 1.15 || 50; // 15% headroom
  }, [weekData]);

  // Weeks om te tonen: 1 t/m max(actual_count, planned_count) week
  const lastWeek = useMemo(() => {
    let last = 0;
    Object.values(weekData).forEach(w => {
      if (w.actual_count > 0 || w.planned_count > 0) last = Math.max(last, w.week);
    });
    return Math.max(last, currentISO.week);
  }, [weekData, currentISO.week]);

  const weeksToShow = Array.from({length: lastWeek}, (_, i) => i + 1);

  // SVG chart dimensies
  const chartHeight = 280;
  const chartTop = 20;
  const chartBottom = 40;
  const barWidth = 24;
  const barGap = 4;
  const chartWidth = weeksToShow.length * (barWidth + barGap) + 60;

  function yScale(v) {
    return chartTop + (chartHeight - chartTop - chartBottom) * (1 - v / chartMax);
  }

  // Contract-uren lijn (alleen voor specifieke medewerker)
  const contractH = empContractInfo?.contract_hours || null;

  // === STYLES ===
  const sectionStyle = {background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)'};

  return (
    <div style={{maxWidth:1500, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:700, margin:0}}>
          Urenplanning Overzicht <span style={{background:'#fff3cd', color:'#856404', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:8, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Concept</span>
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>Uren-verloop per BU, sub-afdeling of medewerker. Werkelijke uren + planning samen in 1 view voor heel 2026.</p>
      </div>

      {/* Filters */}
      <div style={{...sectionStyle, padding:'16px 20px', display:'flex', gap:16, alignItems:'flex-end', flexWrap:'wrap'}}>
        <div>
          <label style={{display:'block', fontSize:10.5, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:6}}>BU</label>
          <select value={selectedBU || ''} onChange={e => setSelectedBU(e.target.value)} style={{padding:'8px 12px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13, minWidth:220}}>
            {BU_LIST.map(bu => <option key={bu} value={bu}>{bu}</option>)}
          </select>
        </div>
        <div>
          <label style={{display:'block', fontSize:10.5, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:6}}>Sub-afdeling</label>
          <select value={selectedSub} onChange={e => setSelectedSub(e.target.value)} style={{padding:'8px 12px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13, minWidth:220}}>
            {subOptions.map(s => <option key={s} value={s}>{s === '__all__' ? '— Hele BU —' : s}</option>)}
          </select>
        </div>
        <div>
          <label style={{display:'block', fontSize:10.5, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:6}}>Medewerker</label>
          <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} style={{padding:'8px 12px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13, minWidth:240}}>
            {employeeOptions.map(e => <option key={e} value={e}>{e === '__all__' ? '— Hele afdeling —' : normalizeName(e)}</option>)}
          </select>
        </div>
      </div>

      {/* KPI's */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, marginBottom:14}}>
        <KPIBlock label="Gewerkte uren" value={kpis.totalWork.toFixed(0) + 'u'} sub={`${kpis.weeksWithActuals} weken`} color="#0056a3" />
        <KPIBlock label="Gem ziek %" value={kpis.avgSickPct.toFixed(1) + '%'} sub={kpis.avgSickPct <= 1 ? 'Laag' : kpis.avgSickPct <= 5 ? 'Gemiddeld' : 'Hoog'} color={kpis.avgSickPct <= 1 ? '#3a5a2c' : kpis.avgSickPct <= 5 ? '#856404' : '#a33225'} />
        <KPIBlock label="Overuren" value={kpis.totalOvertime.toFixed(0) + 'u'} sub={`${(kpis.totalOvertime / kpis.totalWork * 100 || 0).toFixed(1)}% van werk`} color="#6e3bb8" />
        <KPIBlock label="Verlof" value={kpis.totalLeave.toFixed(0) + 'u'} sub={`${(kpis.totalLeave / kpis.totalHours * 100 || 0).toFixed(1)}% van totaal`} color="#9c978c" />
        <KPIBlock label="Ziek" value={kpis.totalSick.toFixed(0) + 'u'} sub="totaal YTD" color="#a33225" />
      </div>

      {/* Contract uren info (alleen voor individuele medewerker) */}
      {empContractInfo && (
        <div style={{background:'#f5ebe0', border:'1px solid rgba(0,0,0,0.08)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#6b6960', marginBottom:14}}>
          Contract: <strong>{empContractInfo.contract}</strong> · Contracturen: <strong style={{fontFamily:"'JetBrains Mono',monospace"}}>{empContractInfo.contract_hours}u/wk</strong> · Sub-afdeling: <strong>{empContractInfo.sub}</strong>
        </div>
      )}

      {/* Hoofdgrafiek: stacked bar regulier + overwerk + ziek + verlof + planning */}
      <div style={{...sectionStyle}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
          <h2 style={{fontSize:14, fontWeight:600, margin:0}}>Uren per week (2026)</h2>
          <div style={{display:'flex', gap:14, fontSize:11, color:'#6b6960'}}>
            <LegendItem color={COLOR_REGULAR} label="Regulier" />
            <LegendItem color={COLOR_OVERTIME} label="Overuren" />
            <LegendItem color={COLOR_SICK} label="Ziek" />
            <LegendItem color={COLOR_LEAVE} label="Verlof" />
            <LegendItem color={COLOR_PLANNED} label="Planning" stroke />
            {contractH && <LegendItem color={COLOR_CONTRACT} label={`Contract ${contractH}u`} line />}
          </div>
        </div>
        {dataLoading ? (
          <div style={{padding:50, textAlign:'center', color:'#9c978c', fontSize:13}}>Data laden...</div>
        ) : (
          <div style={{overflowX:'auto', paddingBottom:8}}>
            <svg width={chartWidth} height={chartHeight} style={{display:'block', minWidth:'100%'}}>
              {/* Y-as gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map(fr => {
                const y = yScale(chartMax * fr);
                return (
                  <g key={fr}>
                    <line x1={40} y1={y} x2={chartWidth} y2={y} stroke="rgba(0,0,0,0.06)" strokeDasharray={fr === 0 ? '' : '2 3'} />
                    <text x={36} y={y + 3} textAnchor="end" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">
                      {(chartMax * fr).toFixed(0)}
                    </text>
                  </g>
                );
              })}
              {/* Contract uren lijn */}
              {contractH && (
                <line x1={40} y1={yScale(contractH)} x2={chartWidth} y2={yScale(contractH)} stroke={COLOR_CONTRACT} strokeWidth="1.5" strokeDasharray="5 3" />
              )}
              {/* Bars per week */}
              {weeksToShow.map((w, i) => {
                const x = 45 + i * (barWidth + barGap);
                const d = weekData[w];
                const fut = isFutureWeek(w);
                // Stacked bar (actuals)
                let yCursor = chartHeight - chartBottom;
                const segments = [];
                [
                  {h: d.regular, color: COLOR_REGULAR, label: 'Regulier'},
                  {h: d.overtime, color: COLOR_OVERTIME, label: 'Overuren'},
                  {h: d.sick, color: COLOR_SICK, label: 'Ziek'},
                  {h: d.leave, color: COLOR_LEAVE, label: 'Verlof'},
                ].forEach((seg, idx) => {
                  if (seg.h > 0) {
                    const segH = (chartHeight - chartTop - chartBottom) * (seg.h / chartMax);
                    segments.push(
                      <rect key={idx} x={x} y={yCursor - segH} width={barWidth} height={segH} fill={seg.color}>
                        <title>{`Wk ${w} · ${seg.label}: ${seg.h.toFixed(1)}u`}</title>
                      </rect>
                    );
                    yCursor -= segH;
                  }
                });
                // Planning bar (alleen toekomst, naast de actual stacked bar)
                if (d.planned > 0 && fut) {
                  const planH = (chartHeight - chartTop - chartBottom) * (d.planned / chartMax);
                  segments.push(
                    <rect key="plan" x={x} y={(chartHeight - chartBottom) - planH} width={barWidth} height={planH} fill={COLOR_PLANNED} stroke="#0056a3" strokeWidth="0.8" strokeDasharray="2 2">
                      <title>{`Wk ${w} · Planning: ${d.planned.toFixed(1)}u`}</title>
                    </rect>
                  );
                }
                return (
                  <g key={w}>
                    {segments}
                    <text x={x + barWidth/2} y={chartHeight - chartBottom + 12} textAnchor="middle" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">
                      {w}
                    </text>
                  </g>
                );
              })}
              <text x={chartWidth/2} y={chartHeight - 4} textAnchor="middle" fontSize="9" fill="#9c978c">Weeknummer</text>
            </svg>
          </div>
        )}
      </div>

      {/* Tabel met week-details */}
      <div style={{...sectionStyle}}>
        <h2 style={{fontSize:14, fontWeight:600, margin:'0 0 14px'}}>Week-details</h2>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0, fontSize:12}}>
            <thead>
              <tr>
                <th style={th()}>Wk</th>
                <th style={th('right')}>Gewerkt</th>
                <th style={th('right')}>Regulier</th>
                <th style={th('right', '#6e3bb8')}>Overuren</th>
                <th style={th('right', '#9c978c')}>Verlof</th>
                <th style={th('right', '#a33225')}>Ziek</th>
                <th style={th('right', '#a33225')}>Ziek %</th>
                <th style={th('right')}>Totaal</th>
                <th style={th('right', '#0056a3')}>Planning</th>
              </tr>
            </thead>
            <tbody>
              {weeksToShow.map(w => {
                const d = weekData[w];
                const isFut = isFutureWeek(w);
                const sickPct = d.total > 0 ? (d.sick / d.total * 100) : 0;
                const sickBg = sickPct <= 1 ? '' : sickPct <= 5 ? 'rgba(255,211,84,0.18)' : 'rgba(214,59,26,0.15)';
                const sickCol = sickPct <= 1 ? '#3a5a2c' : sickPct <= 5 ? '#856404' : '#a33225';
                const hasData = d.actual_count > 0 || d.planned_count > 0;
                if (!hasData) return null;
                return (
                  <tr key={w} style={{opacity: hasData ? 1 : 0.4}}>
                    <td style={td(false, isFut ? '#0056a3' : '#1a1a18')}>{w}{isFut && <span style={{fontSize:9, marginLeft:4, color:'#0056a3'}}>(plan)</span>}</td>
                    <td style={td('right')}>{d.hours_worked > 0 ? d.hours_worked.toFixed(1) : '-'}</td>
                    <td style={td('right')}>{d.regular > 0 ? d.regular.toFixed(1) : '-'}</td>
                    <td style={{...td('right'), color: d.overtime > 0 ? '#6e3bb8' : '#d4d4d0', fontWeight: d.overtime > 0 ? 600 : 400}}>{d.overtime > 0 ? d.overtime.toFixed(1) : '-'}</td>
                    <td style={td('right')}>{d.leave > 0 ? d.leave.toFixed(1) : '-'}</td>
                    <td style={{...td('right'), color: d.sick > 0 ? '#a33225' : '#d4d4d0', fontWeight: d.sick > 0 ? 600 : 400}}>{d.sick > 0 ? d.sick.toFixed(1) : '-'}</td>
                    <td style={{...td('right'), background: sickBg, color: sickCol, fontWeight: sickPct > 1 ? 600 : 400}}>{d.total > 0 ? sickPct.toFixed(1) + '%' : '-'}</td>
                    <td style={td('right', '#1a1a18', true)}>{d.total > 0 ? d.total.toFixed(1) : '-'}</td>
                    <td style={{...td('right'), color: d.planned > 0 ? '#0056a3' : '#d4d4d0', fontStyle:'italic'}}>{d.planned > 0 ? d.planned.toFixed(1) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te lezen:</strong> Hoofdgrafiek toont per week de gewerkte uren opgebouwd uit regulier + overuren + ziek + verlof. Voor toekomstige weken (vanaf vandaag) toont de blauwe gestreepte balk de planning. Selecteer een specifieke medewerker om de contracturen-lijn (zwart gestreept) te zien. Klik op een staaf voor tooltip met details.
      </div>
    </div>
  );
}

function KPIBlock({label, value, sub, color}) {
  return (
    <div style={{background:'#fff', borderRadius:10, padding:'12px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
      <div style={{fontSize:10, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px'}}>{label}</div>
      <div style={{fontSize:20, fontWeight:700, color, fontFamily:"'JetBrains Mono',monospace", marginTop:4}}>{value}</div>
      <div style={{fontSize:10.5, color:'#9c978c', marginTop:2}}>{sub}</div>
    </div>
  );
}

function LegendItem({color, label, stroke, line}) {
  return (
    <div style={{display:'flex', alignItems:'center', gap:4}}>
      {line ? (
        <div style={{width:14, height:0, borderTop:`1.5px dashed ${color}`}}></div>
      ) : (
        <div style={{width:10, height:10, background:color, borderRadius:2, border: stroke ? `1px dashed #0056a3` : 'none'}}></div>
      )}
      <span>{label}</span>
    </div>
  );
}

function th(align='left', color='#9c978c') {
  return {position:'sticky', top:0, background:'#fff', padding:'10px 8px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10, textTransform:'uppercase', letterSpacing:'.4px', color, fontWeight:600, textAlign:align};
}
function td(align=false, color='#1a1a18', bold=false) {
  return {padding:'6px 8px', borderBottom:'1px solid rgba(0,0,0,0.05)', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color, fontWeight: bold ? 600 : 400, textAlign: align || 'left'};
}
