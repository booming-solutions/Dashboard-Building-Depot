/* ============================================================
   BESTAND: page-urenplanning.js (v6)
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning/page.js

   WIJZIGINGEN v6:
   - Read-only weergave van Dyflexis-data uit urenplanning_dyflexis
   - Geen handmatige invoer meer (Dyflexis is bron van waarheid)
   - Overuren-kolom: planned - contracturen (alleen positief)
   - Open dienst rijen onderaan per BU
   - Target-balk: geplande netto + overuren vs week-target
   - Sticky tabel-header
   - Klikbare sortering op voornaam (A→Z / Z→A / default)
   - Contracturen uit C16-embed (zelfde dataset als v5)
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// Medewerkers per BU — uit C16 voor contract-info (Vast/Flex, contracturen)
const BU_EMPLOYEES = {"BU Appliance/Houseware":[{"name":"Michanu Isenia","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Michelangelo Lourens","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Ruthlyn Comenencia Martina","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Shelah Janga","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Nilo  Grotestam","contract":"Flexibel","sub":"A/H Operations","contract_hours":null},{"name":"Sheila Lacrum Wawoe","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Francisco Doran","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Christopher Bakmeijer","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Rudelly Mauricia","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Daniel Louman","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Kevin Djotaroeno","contract":"Onbekend","sub":"A/H Management","contract_hours":null}],"BU Building Materials":[{"name":"Niasotis Dandare Ellis","contract":"Vast","sub":"Building Materials Management","contract_hours":40.0}],"BU Hardware":[{"name":"Tercy Stewart","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shannon Martha","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marciela Andrea","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Gilbert Santiroma","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marshelon Janzen","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"John Candelaria","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shuwender Rosini","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Keith Taylor","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Eliana  Dangond Pabon","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Jowendrick Sillie","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Archel Presentacion","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Minguel Goedgedrag","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Javier Martis","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Noah Frankenberger","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marlon Meyer","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Rishantely Jantje","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Christopher Bregita","contract":"Vast","sub":"Hardware Operations","contract_hours":24.0},{"name":"Jhonny Garves","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Noudimar Dorothea","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Tyshawn  Angela","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Raymi-Engelo Regina","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Vai-Ona Martines","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Guishawn Wanga","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Dejuan Brown","contract":"Onbekend","sub":"Hardware Operations","contract_hours":null},{"name":"Rigchantely Da Costa Gomez","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null}],"BU Living":[{"name":"Gijs Verkuijl","contract":"Onbekend","sub":"Living Management","contract_hours":null},{"name":"Franklin Domatilia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Ingerson Carmela","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Sus-Marianne Anastasia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Vianel Brazoban","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Laymine Zimmerman","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Sidmarelly Henriquez","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Tharinah Sophia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Thysheliene Martiszoon","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Connelly  Lourens","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Dianne Meyer - Walle","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Nareelis Jakoba","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Roberto Badaracco","contract":"Vast","sub":"Living Management","contract_hours":32.0},{"name":"Armigilda Kopra","contract":"Vast","sub":"Living Operations","contract_hours":28.0},{"name":"Hannah Perlaza","contract":"Onbekend","sub":"Living Operations","contract_hours":null},{"name":"Mariejela Rosinda Victor","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Dianni Colon","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Jair Mattheeuw","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Qiyazir Lake","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Carina Tidu","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Noemi-Eluzai Cijntje","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Zufreni Martis","contract":"Onbekend","sub":"Living Operations","contract_hours":null}],"BU Sanitair/Keuken":[{"name":"Michael Matroos","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Navin Ramdjas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Enoc Merkies","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Mireya Meyer Rojas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Steven Rogers","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Vianaly Victor","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Jamira Webster","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Ivo Proveniers","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Henk Van Veen","contract":"Vast","sub":"S/K Management","contract_hours":40.0}],"Smart Finance":[{"name":"Judith Petronilia","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Jacqueline  Schotborgh","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Ivaira Windster","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Coralisa Windt De - Verstijnen","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Dienca  Arneman, Van","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Sharesca Niebe","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Yurriene Gonzalez","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Melivienne Legrand","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Karla Valencia - Angarita","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Wilfried Ambrotius","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Lysandra Rafaela Becker","contract":"Onbekend","sub":"Algemeen","contract_hours":null}],"Logistiek":[{"name":"Ramsley Salome","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"John van den Berg","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Robin Hooi","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Norwin Andrea","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Eugene Antonio","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Ricardo Pierre","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shakur Bernadina","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Patrick Newton","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Aldrin Vlijtig","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Harvey  Raap","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Sandrey  Richardson","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shairlyson  Sambo","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Joubert Pieters","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Xavier Werleman","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Naigelon  Clemensia","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Jurrandy Brandao","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Jurich Martina","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Hensley Sambo","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Marijke Antonia","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Ashneltrida Martis","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Herbert Pisas","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Benjamin Martijn","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Sharimar Faneite","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Germilson  Seintje","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Rowendry Martina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Gilma Coco","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Adrianus Zijlstra","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Reimy Ferero Abreu","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Lativa  Pieters","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Curtney Cicilia","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Roderick Paulina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Urlick Romsina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Denzell Russel","contract":"Flexibel","sub":"Transit","contract_hours":null},{"name":"Timothy Newton","contract":"Flexibel","sub":"Brievengat 02","contract_hours":null},{"name":"Railison Daal","contract":"Onbekend","sub":"Brievengat 05","contract_hours":null},{"name":"Rujairo Ricao","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Fabian Mom","contract":"Onbekend","sub":"Supervisors Logistiek","contract_hours":null}],"Store Support":[{"name":"Giovanni Pinedo","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Orlando Reenis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Guadeloup Elisabeth","contract":"Flexibel","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Sidney T. Molina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Ludwina Casser","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Deborah Koeyers","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Nefertari Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"David Waaldijk","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Yeyson Marte Abreu","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Shahira Roberto","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Alvin D Silberie","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Zuneida Alvarez","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Ignaldaly Garcia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Shellany Constansia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":30.0},{"name":"Luisana Chirino","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Philonairis Maria","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Lyene  Daal","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Richinella Obia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Ruthsarai Gallardo","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Keisha Martina","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Marielou  Alexander","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Handre Owens","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Stephanie  Girigori","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Adriana Martes Reyes","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Merugia Cathalina-Martis","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Rochendry Doran","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Dayanara Libinia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Carlos De Franca","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Eldert Juliana","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Dianira Scherptong","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Renaisha Wijngaarden","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Jesseline Sebelon De Wind","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Brithney Garcia","contract":"Onbekend","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Eduard Carolina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Allan Pedro","contract":"Vast","sub":"Facilitair","contract_hours":40.0},{"name":"Rose Cenord Desrosiers","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Jonathan de Wolff","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Omar Requena","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Alberto Betrian","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Chanarda Davis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Liselotte Rojer","contract":"Vast","sub":"Marketing","contract_hours":36.0},{"name":"Clifton Koeyers","contract":"Vast","sub":"Inventory Controller","contract_hours":20.0},{"name":"Jeandrelika Schoop","contract":"Flexibel","sub":"Winkel > Store support Customer Service","contract_hours":null},{"name":"Agnette Pedro - Trotman","contract":"Vast","sub":"Inventory Controller","contract_hours":32.0},{"name":"Marlon Atmodimedjo","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Luigino Kauw-A-Tjoe","contract":"Vast","sub":"Marketing","contract_hours":30.0},{"name":"Brittany Haase","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":16.0},{"name":"Quisheena Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":10.0},{"name":"Franciscus van Kessel","contract":"Vast","sub":"B2B","contract_hours":20.0},{"name":"Franklin Quinones Echeverria","contract":"Onbekend","sub":"Facilitair","contract_hours":null},{"name":"Bobby Herder","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Jundrick Jansen","contract":"Flexibel","sub":"Marketing","contract_hours":null},{"name":"Wendell Finies","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0}]};

// Week-targets per BU = gemiddelde werkuren feb-apr 2026 × 0,90 (-10%) ÷ 4,33 weken
// Berekend op basis van Dyflexis historische data
const BU_WEEK_TARGETS = {
  'BU Appliance/Houseware': 340,
  'BU Building Materials': 24,
  'BU Hardware': 520,
  'BU Living': 505,
  'BU Sanitair/Keuken': 287,
  'Smart Finance': 283,
  'Logistiek': 1071,
  'Store Support': 1495,
};

const NL_DAYS = ['Ma','Di','Wo','Do','Vr','Za','Zo'];

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
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
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

// Convert "Achternaam, Voornaam" → "Voornaam Achternaam" voor display + matching
function normalizeName(dyflexisName) {
  if (!dyflexisName) return '';
  if (dyflexisName === 'Open dienst') return 'Open dienst';
  const parts = dyflexisName.split(',').map(s => s.trim());
  if (parts.length < 2) return dyflexisName;
  // "Achternaam, Voornaam" → "Voornaam Achternaam"
  // Multi-comma: "Berg, van den, John" → "John van den Berg"
  // = laatste deel voorop, rest erachter
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, parts.length - 1).reverse().join(' ');
  return `${last} ${rest}`;
}

// Match Dyflexis-naam aan BU_EMPLOYEES entry op basis van voornaam + laatste achternaam-woord
function matchEmployee(dyflexisName, buEmployees) {
  const normalized = normalizeName(dyflexisName);
  const parts = normalized.toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastWord = parts[parts.length - 1];

  for (const emp of buEmployees) {
    const empParts = emp.name.toLowerCase().split(/\s+/);
    const empFirst = empParts[0];
    const empLast = empParts[empParts.length - 1];
    if (empFirst === firstName && empLast === lastWord) return emp;
  }
  // Fallback: alleen voornaam matchen (laatste resort)
  for (const emp of buEmployees) {
    const empFirst = emp.name.toLowerCase().split(/\s+/)[0];
    if (empFirst === firstName) return emp;
  }
  return null;
}

export default function UrenplanningPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [selectedBU, setSelectedBU] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(getNextWeek());
  const [rows, setRows] = useState([]);     // Raw rijen uit urenplanning_dyflexis
  const [sortMode, setSortMode] = useState('default');
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role, bu_assignment, email, full_name').eq('id', user.id).single();
      if (!p || (p.role !== 'manager' && p.role !== 'admin')) {
        router.push('/dashboard');
        return;
      }
      setProfile(p);
      let bu = p.bu_assignment;
      if (!bu && Object.keys(BU_EMPLOYEES).length > 0) {
        bu = Object.keys(BU_EMPLOYEES)[0];
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
    setDataLoading(true);
    const { data, error } = await supabase
      .from('urenplanning_dyflexis')
      .select('*')
      .eq('bu', selectedBU)
      .eq('period_year', currentWeek.year)
      .eq('period_week', currentWeek.week);
    if (error) {
      console.error('Load error:', error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setDataLoading(false);
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

  // Aggregate rijen per medewerker
  const baseEmployees = BU_EMPLOYEES[selectedBU] || [];
  const empMap = {};  // dyflexis_name -> { name, contract, contract_hours, days{1..7}, total }

  rows.forEach(r => {
    if (r.is_open) return;  // open dienst apart
    const key = r.employee_name;
    if (!empMap[key]) {
      const match = matchEmployee(r.employee_name, baseEmployees);
      empMap[key] = {
        dyflexis_name: r.employee_name,
        display_name: normalizeName(r.employee_name),
        contract: match ? match.contract : 'Onbekend',
        contract_hours: match ? match.contract_hours : null,
        sub: match ? match.sub : (r.sub_afdeling || ''),
        days: {1:0,2:0,3:0,4:0,5:0,6:0,7:0},
        total: 0,
        matched: !!match,
      };
    }
    empMap[key].days[r.day_of_week] += parseFloat(r.netto_hours) || 0;
    empMap[key].total += parseFloat(r.netto_hours) || 0;
  });

  // Open dienst aggregate
  const openDays = {1:0,2:0,3:0,4:0,5:0,6:0,7:0};
  let openTotal = 0;
  rows.forEach(r => {
    if (!r.is_open) return;
    openDays[r.day_of_week] += parseFloat(r.netto_hours) || 0;
    openTotal += parseFloat(r.netto_hours) || 0;
  });

  // Sorteer medewerkers
  let employeeList = Object.values(empMap);
  const firstName = (e) => e.display_name.split(/\s+/)[0].toLowerCase();
  if (sortMode === 'asc') {
    employeeList.sort((a, b) => firstName(a).localeCompare(firstName(b)));
  } else if (sortMode === 'desc') {
    employeeList.sort((a, b) => firstName(b).localeCompare(firstName(a)));
  } else {
    // default: contract type (Vast → Flex → Onbekend), dan total uren desc
    const contractOrder = (c) => c === 'Vast' ? 1 : c === 'Flexibel' ? 2 : 3;
    employeeList.sort((a, b) => {
      const co = contractOrder(a.contract) - contractOrder(b.contract);
      if (co !== 0) return co;
      return b.total - a.total;
    });
  }

  function cycleSortMode() {
    setSortMode(prev => prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default');
  }

  // Totalen voor target-balk
  const dayTotals = [0,0,0,0,0,0,0];
  let weekGrandTotal = 0;
  let overurenTotal = 0;
  employeeList.forEach(emp => {
    for (let d = 1; d <= 7; d++) {
      dayTotals[d-1] += emp.days[d];
    }
    weekGrandTotal += emp.total;
    if (emp.contract === 'Vast' && emp.contract_hours && emp.total > emp.contract_hours) {
      overurenTotal += emp.total - emp.contract_hours;
    }
  });
  // Open dienst toevoegen aan day-totalen
  for (let d = 1; d <= 7; d++) dayTotals[d-1] += openDays[d];
  weekGrandTotal += openTotal;

  const sortIcon = sortMode === 'asc' ? ' ↑' : sortMode === 'desc' ? ' ↓' : ' ↕';
  const headerStyle = {position:'sticky', top:0, zIndex:5, background:'#fff', padding:'10px 10px 8px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10.5, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c'};

  const weekTarget = BU_WEEK_TARGETS[selectedBU];
  const overTarget = weekTarget && weekGrandTotal > weekTarget;
  const onderTarget = weekTarget && weekGrandTotal < weekTarget;

  return (
    <div style={{maxWidth:1400, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:700, margin:0}}>
          Urenplanning <span style={{background:'#fff3cd', color:'#856404', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:8, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Concept</span>
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>Read-only weergave uit Dyflexis. Plannings-data wordt automatisch geïmporteerd (zie Admin → Dyflexis Import).</p>
      </div>

      {(profile.role === 'admin' || !profile.bu_assignment) && (
        <div style={{background:'#fff', padding:'12px 16px', borderRadius:10, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <span style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#9c978c', marginRight:10, letterSpacing:'.4px'}}>Kies BU:</span>
          <select value={selectedBU || ''} onChange={e => setSelectedBU(e.target.value)} style={{padding:'6px 10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13}}>
            {Object.keys(BU_EMPLOYEES).map(bu => <option key={bu} value={bu}>{bu}</option>)}
          </select>
        </div>
      )}

      {/* Week navigatie */}
      <div style={{position:'sticky', top:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, padding:'12px 18px', background:'#fff', borderRadius:10, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <button onClick={() => setCurrentWeek(shiftWeek(currentWeek.year, currentWeek.week, -1))} style={{padding:'8px 14px', border:'1.5px solid rgba(0,0,0,0.14)', background:'#fff', borderRadius:7, fontFamily:'inherit', fontSize:12.5, fontWeight:500, cursor:'pointer'}}>← Vorige week</button>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:15, fontWeight:600}}>{selectedBU}</div>
          <div style={{fontSize:13, color:'#6b6960'}}>Week {currentWeek.week}, {currentWeek.year} ({formatDate(dayDates[0])} t/m {formatDate(dayDates[6])})</div>
        </div>
        <button onClick={() => setCurrentWeek(shiftWeek(currentWeek.year, currentWeek.week, 1))} style={{padding:'8px 14px', border:'1.5px solid rgba(0,0,0,0.14)', background:'#fff', borderRadius:7, fontFamily:'inherit', fontSize:12.5, fontWeight:500, cursor:'pointer'}}>Volgende week →</button>
      </div>

      {/* Target balk */}
      {weekTarget && (
        <div style={{marginBottom:14, padding:'14px 18px', background: overTarget ? '#fee' : onderTarget ? '#f0f5e8' : '#fafaf6', border:`1.5px solid ${overTarget ? '#a33225' : onderTarget ? '#2d6b3f' : 'rgba(0,0,0,0.14)'}`, borderRadius:10}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8, flexWrap:'wrap', gap:8}}>
            <div>
              <div style={{fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:2}}>Week-target</div>
              <div style={{fontSize:15, fontWeight:600}}>
                Ingepland <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{weekGrandTotal.toFixed(0)}u</span> van <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{weekTarget}u</span>
                <span style={{marginLeft:10, fontSize:13, color: overTarget ? '#a33225' : onderTarget ? '#2d6b3f' : '#6b6960', fontWeight:500}}>
                  ({weekGrandTotal > weekTarget ? '+' : ''}{(weekGrandTotal - weekTarget).toFixed(0)}u • {(weekGrandTotal / weekTarget * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
            {overurenTotal > 0 && (
              <div style={{fontSize:12.5, color:'#a33225', fontWeight:500, textAlign:'right'}}>
                <strong>{overurenTotal.toFixed(0)}u overuren gepland</strong><br/>
                <span style={{fontWeight:400, fontSize:11.5}}>Boven contracturen — extra kosten.</span>
              </div>
            )}
          </div>
          <div style={{position:'relative', height:8, background:'rgba(0,0,0,0.08)', borderRadius:4, overflow:'hidden'}}>
            <div style={{position:'absolute', left:0, top:0, height:'100%', width:`${Math.min(weekGrandTotal/weekTarget*100, 110)/110*100}%`, background: overTarget ? '#a33225' : '#2d6b3f', transition:'width .25s ease'}}></div>
            <div style={{position:'absolute', left:`${100/110*100}%`, top:-2, bottom:-2, width:2, background:'#1a1a18'}}></div>
          </div>
          {overTarget && (
            <div style={{marginTop:10, fontSize:12.5, color:'#a33225', fontWeight:500}}>
              Je zit {(weekGrandTotal-weekTarget).toFixed(0)}u <strong>boven het week-target</strong>. CFO-doel: 10% reductie t.o.v. afgelopen 12 maanden.
            </div>
          )}
          {onderTarget && (
            <div style={{marginTop:10, fontSize:12.5, color:'#2d6b3f', fontWeight:500}}>
              {Math.abs(weekGrandTotal-weekTarget).toFixed(0)}u <strong>onder target</strong>.
            </div>
          )}
        </div>
      )}

      {/* Tabel */}
      <div style={{background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)', overflowX:'auto'}}>
        {dataLoading && (
          <div style={{padding:30, textAlign:'center', color:'#9c978c', fontSize:13}}>Data laden...</div>
        )}
        {!dataLoading && rows.length === 0 && (
          <div style={{padding:30, textAlign:'center', color:'#9c978c', fontSize:13}}>
            Geen planning data voor deze week. Importeer een Dyflexis-PDF via Admin → Dyflexis Import.
          </div>
        )}
        {!dataLoading && rows.length > 0 && (
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
                <th style={{...headerStyle, textAlign:'center', padding:'10px 6px', color:'#a33225', width:80}}>Overuren</th>
              </tr>
            </thead>
            <tbody>
              {employeeList.map(emp => {
                const contractColor = emp.contract === 'Flexibel' ? {bg:'#ffe5d6', col:'#a33225'} : emp.contract === 'Vast' ? {bg:'#e0e7d4', col:'#3a5a2c'} : {bg:'#e8e8e8', col:'#666'};
                const showContract = emp.contract === 'Vast' && emp.contract_hours !== null;
                const overuren = (showContract && emp.total > emp.contract_hours) ? emp.total - emp.contract_hours : 0;
                return (
                  <tr key={emp.dyflexis_name}>
                    <td style={{padding:'8px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:12.5}}>
                      {emp.display_name}
                      {!emp.matched && <span style={{marginLeft:6, fontSize:10, color:'#856404', fontWeight:500}} title="Niet gevonden in C16">⚠</span>}
                    </td>
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center'}}>
                      <span style={{display:'inline-block', fontSize:9.5, padding:'1.5px 6px', borderRadius:3, fontWeight:600, letterSpacing:'.2px', background:contractColor.bg, color:contractColor.col}}>
                        {emp.contract === 'Flexibel' ? 'flex' : emp.contract === 'Vast' ? 'vast' : '?'}
                      </span>
                    </td>
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:'#6b6960'}}>
                      {showContract ? emp.contract_hours : '-'}
                    </td>
                    {NL_DAYS.map((_, i) => {
                      const day = i + 1;
                      const h = emp.days[day];
                      return (
                        <td key={day} style={{padding:'8px 6px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color: h > 0 ? '#1a1a18' : '#d4d4d0'}}>
                          {h > 0 ? h.toFixed(1) : '-'}
                        </td>
                      );
                    })}
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, color: overuren > 0 ? '#a33225' : 'inherit'}}>
                      {emp.total > 0 ? emp.total.toFixed(1) : '-'}
                    </td>
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, fontWeight:600, color:'#a33225'}}>
                      {overuren > 0 ? '+' + overuren.toFixed(1) : '-'}
                    </td>
                  </tr>
                );
              })}
              {/* Open dienst rij */}
              {openTotal > 0 && (
                <tr style={{background:'#f5ebe0'}}>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:12.5, fontWeight:600, color:'#6b6960'}}>
                    OPEN DIENST <span style={{fontSize:10, fontWeight:500, marginLeft:6, color:'#a33225'}}>nog in te plannen</span>
                  </td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', color:'#9c978c'}}>—</td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', color:'#9c978c'}}>—</td>
                  {NL_DAYS.map((_, i) => {
                    const day = i + 1;
                    const h = openDays[day];
                    return (
                      <td key={day} style={{padding:'8px 6px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, fontWeight: h > 0 ? 600 : 400, color: h > 0 ? '#a33225' : '#d4d4d0'}}>
                        {h > 0 ? h.toFixed(1) : '-'}
                      </td>
                    );
                  })}
                  <td style={{padding:'8px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color:'#a33225'}}>
                    {openTotal.toFixed(1)}
                  </td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', color:'#9c978c'}}>—</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{background:'#1a1a18', color:'#fff'}}>
                <td colSpan={3} style={{padding:'10px', fontWeight:700, fontSize:12}}>TOTAAL</td>
                {dayTotals.map((t, i) => (
                  <td key={i} style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{t > 0 ? t.toFixed(1) : '-'}</td>
                ))}
                <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{weekGrandTotal.toFixed(1)}</td>
                <td style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:'#ff8a6c'}}>{overurenTotal > 0 ? '+' + overurenTotal.toFixed(1) : '-'}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te lezen:</strong> Data komt uit Dyflexis. Geplande uren zijn netto (pauze afgetrokken, heuristiek: 1u pauze bij {'>='}8h, 0.5u bij 5-7h, geen bij {'<'}5h). Overuren = geplande uren boven contracturen (alleen Vast contract). "Open dienst" = nog niet ingevulde diensten waar een medewerker op moet komen. Het ⚠ symbool achter een naam = medewerker niet gevonden in C16. Bij vragen aan HR.
      </div>
    </div>
  );
}
