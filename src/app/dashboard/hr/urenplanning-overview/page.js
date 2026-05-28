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
  // Collapse multiple whitespace to single spaces
  let s = dyflexisName.replace(/\s+/g, ' ').trim();
  if (!s.includes(',')) return s;
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, parts.length - 1).reverse().join(' ');
  return `${last} ${rest}`.replace(/\s+/g, ' ').trim();
}

// Een nog strakkere key voor groepering: lowercase, geen accenten, geen interpunctie
function nameKey(name) {
  return normalizeName(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9 ]/g, '')                       // strip interpunctie
    .replace(/\s+/g, ' ')
    .trim();
}

// Handmatige aliassen: alternatieve key → canonical key
// Voor namen waarbij actuals en planning verschillende achternaam-volgorde gebruiken
// of waar de parser per ongeluk extra woorden heeft meegelift
const NAME_ALIASES = {
  // Mensen met meerdere achternamen — Jeroen's lijst
  'henk veen': 'henk van veen',
  'mireya rojas': 'mireya meyer rojas',
  'eliana pabon': 'eliana dangond pabon',
  'ruthlyn martina': 'ruthlyn comenencia martina',
  'sheila wawoe': 'sheila lacrum wawoe',
  'coralisa verstijnen': 'coralisa windt de verstijnen',
  'karla angarita': 'karla valencia angarita',
  'reimy abreu': 'reimy ferero abreu',
  // Volgorde-issues bij planning vs actuals
  'van dienca arneman': 'dienca van arneman',
  // Parser-artefacten in planning (eens parser is herwerkt zijn deze redundant)
  'franciscus van building depot bonaire magazijn kessel': 'franciscus van kessel',
  'john van den building depot bonaire store management berg': 'john van den berg',
};

// Toepassen alias op nameKey output
function nameKeyAliased(name) {
  const k = nameKey(name);
  return NAME_ALIASES[k] || k;
}

// Voor display: gebruik canonical naam waar mogelijk
const CANONICAL_DISPLAY = {
  'henk van veen': 'Henk van Veen',
  'mireya meyer rojas': 'Mireya Meyer Rojas',
  'eliana dangond pabon': 'Eliana Dangond Pabon',
  'ruthlyn comenencia martina': 'Ruthlyn Comenencia Martina',
  'sheila lacrum wawoe': 'Sheila Lacrum Wawoe',
  'coralisa windt de verstijnen': 'Coralisa Windt de - Verstijnen',
  'karla valencia angarita': 'Karla Valencia - Angarita',
  'reimy ferero abreu': 'Reimy Ferero Abreu',
  'dienca van arneman': 'Dienca van Arneman',
  'franciscus van kessel': 'Franciscus van Kessel',
  'john van den berg': 'John van den Berg',
};

// Standaard sub-afdelingen per BU - exacte namen uit Dyflexis (zoals zichtbaar in week 13+ actuals)
// Deze worden bovenaan getoond in de dropdown; afwijkende subs komen onder een scheidingslijn
const STANDARD_SUBS = {
  'BU Living': ['Living Management', 'Living Operations'],
  'BU Hardware': ['Hardware Management', 'Hardware Operations'],
  'BU Sanitair/Keuken': ['S/K Management', 'S/K Operations'],
  'BU Appliance/Houseware': ['A/H Management', 'A/H Operations'],
  'BU Building Materials': ['Building Materials Management', 'Building Materials Operations'],
  'Smart Finance': ['Smart Finance'],
  'Logistiek': ['Brievengat 02', 'Brievengat 05', 'Transit', 'Tussenmagazijn', 'Drive Thru'],
  'Store Support': ['Bewaking', 'Customer Service', 'Facilitair', 'Kassa', 'Schoonmaak'],
  'BU Kantoor': ['Administratie', 'HR', 'IT', 'Inventory Controller', 'Marketing'],
};

// Sub-alias mappings — varianten naar standaard naam (case-insensitief match)
const SUB_ALIASES = {
  'store support schoonmaak': 'Schoonmaak',
  'store support -bewaking': 'Bewaking',
  'store support kassa': 'Kassa',
  'store support customer service': 'Customer Service',
  'b2b': 'Building Materials Operations',
};

// Normaliseer sub-afdeling: pas alias toe, of probeer prefix-match met standaard subs van BU
function normalizeSub(rawSub, bu) {
  if (!rawSub) return null;
  const s = String(rawSub).trim();
  if (!s) return null;
  const sLow = s.toLowerCase();

  // Strip "archived" variantsj
  if (sLow.includes('archived')) return s; // laat archived intact als historisch

  // Direct alias match
  if (SUB_ALIASES[sLow]) return SUB_ALIASES[sLow];

  // Standard subs voor deze BU: probeer prefix-match
  const standardSubs = STANDARD_SUBS[bu] || [];
  for (const std of standardSubs) {
    if (sLow === std.toLowerCase()) return std;
    if (sLow.startsWith(std.toLowerCase() + ' ')) return std; // "Hardware Management Verlof" -> "Hardware Management"
    if (sLow.startsWith(std.toLowerCase())) return std;       // catches "Hardware ManagementVerlof"
  }
  // Niets gematcht — return zoals het is (Smart Finance, etc)
  return s;
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

// Schoon sub_afdeling op: strip page-break-artefacten en eventuele namen die zijn meegelift
function cleanSubAfdeling(sub) {
  if (!sub) return null;
  let s = String(sub).trim();
  // Strip alles vanaf "Datum Start Eind Afdeling Opmerking" (page-break header)
  const headerIdx = s.indexOf('Datum Start Eind');
  if (headerIdx >= 0) s = s.substring(0, headerIdx).trim();
  // Strip alles vanaf een mogelijk medewerkers-naam (Capitalized + komma)
  const nameIdx = s.search(/\s+[A-Z][a-zA-Z\- ]*,\s*[A-Z]/);
  if (nameIdx >= 0) s = s.substring(0, nameIdx).trim();
  // Strip trailing zooi
  s = s.replace(/\s+$/, '');
  return s || null;
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

  // View mode: 'recent' = vanaf week 13 (nieuwe BU-structuur), 'all' = heel 2026
  const [viewMode, setViewMode] = useState('recent');
  const STRUCTURE_START_WEEK = 13;

  // Contract filter: 'all' = alle medewerkers, 'vast' = alleen Vast contract
  const [contractFilter, setContractFilter] = useState('all');

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
    // Render null tijdens loading om hooks-volgorde stabiel te houden — we doen alle hooks eerst, return wordt onderaan na alle hooks
  }

  // === DATA TRANSFORMATIES ===

  // Unieke subs voor selected BU (uit actuals en planning rijen)
  // Sub_afdeling wordt geschoond + genormaliseerd voor weergave
  // De dropdown krijgt: __all__ + STANDARD subs (in vaste volgorde) + ---- + andere subs alfabetisch
  const subOptions = useMemo(() => {
    const found = new Set();
    allRows.forEach(r => {
      const cleaned = cleanSubAfdeling(r.sub_afdeling);
      const norm = normalizeSub(cleaned, selectedBU);
      if (norm) found.add(norm);
    });
    const standard = STANDARD_SUBS[selectedBU] || [];
    // Standaard subs die ook daadwerkelijk voorkomen in de data (in standaard-volgorde)
    const standardPresent = standard.filter(s => found.has(s));
    // Andere subs (niet in standaard) alfabetisch
    const otherSubs = Array.from(found)
      .filter(s => !standard.includes(s))
      .sort();
    // Bouw lijst: __all__, standaard, optioneel scheider, andere
    const result = ['__all__', ...standardPresent];
    if (otherSubs.length > 0 && standardPresent.length > 0) {
      result.push('__sep__');
    }
    result.push(...otherSubs);
    return result;
  }, [allRows, selectedBU]);

  // Filter rows op selected sub (planning + actuals samen)
  // We vergelijken via normalizeSub(cleanSubAfdeling) zodat alle varianten matchen
  const filteredRowsBySub = useMemo(() => {
    if (selectedSub === '__all__') return allRows;
    return allRows.filter(r => normalizeSub(cleanSubAfdeling(r.sub_afdeling), selectedBU) === selectedSub);
  }, [allRows, selectedSub, selectedBU]);

  // Unieke medewerkers in deze sub (gegroepeerd op nameKey zodat actual + planning samenvallen)
  // We bewaren ook ALLE raw varianten per key zodat we conflicten kunnen tonen
  const employeeOptionsData = useMemo(() => {
    const byKey = new Map(); // key → { display, rawNames: Set }
    filteredRowsBySub.forEach(r => {
      if (!r.employee_name || r.is_open) return;
      const key = nameKeyAliased(r.employee_name);
      if (!key) return;
      if (!byKey.has(key)) {
        const displayCanonical = CANONICAL_DISPLAY[key] || normalizeName(r.employee_name);
        byKey.set(key, { display: displayCanonical, rawNames: new Set() });
      }
      byKey.get(key).rawNames.add(r.employee_name);
    });
    // Detecteer potentiële mismatches: zelfde voornaam OF achternaam maar andere key
    // Bouw 2 maps: voornaam → keys, achternaam → keys
    const byFirst = new Map();
    const byLast = new Map();
    Array.from(byKey.keys()).forEach(k => {
      const parts = k.split(' ');
      if (parts.length < 2) return;
      const first = parts[0], last = parts[parts.length - 1];
      if (!byFirst.has(first)) byFirst.set(first, []);
      byFirst.get(first).push(k);
      if (!byLast.has(last)) byLast.set(last, []);
      byLast.get(last).push(k);
    });
    const conflicts = []; // [{ key1, key2, reason }]
    byFirst.forEach((keys, first) => {
      if (keys.length > 1) {
        // zelfde voornaam, verschillende achternaam — alleen tonen als achternaam-deel partial overlap
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const a = keys[i], b = keys[j];
            // Check of de andere woorden overlappen (bv één van naam-woorden hetzelfde)
            const wordsA = new Set(a.split(' '));
            const wordsB = new Set(b.split(' '));
            const overlap = [...wordsA].filter(w => wordsB.has(w));
            if (overlap.length >= 2) { // voornaam + 1 ander woord = vermoedelijk zelfde persoon
              conflicts.push({ keys: [a, b], reason: `Voornaam '${first}' + overlap (${overlap.join(', ')})` });
            }
          }
        }
      }
    });
    byLast.forEach((keys, last) => {
      if (keys.length > 1) {
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            const a = keys[i], b = keys[j];
            const wordsA = new Set(a.split(' '));
            const wordsB = new Set(b.split(' '));
            const overlap = [...wordsA].filter(w => wordsB.has(w));
            if (overlap.length >= 2 && !conflicts.find(c => 
              (c.keys[0] === a && c.keys[1] === b) || (c.keys[0] === b && c.keys[1] === a))) {
              conflicts.push({ keys: [a, b], reason: `Achternaam '${last}' + overlap (${overlap.join(', ')})` });
            }
          }
        }
      }
    });
    return { byKey, conflicts };
  }, [filteredRowsBySub]);

  const employeeOptions = useMemo(() => {
    const sorted = Array.from(employeeOptionsData.byKey.values())
      .map(v => v.display)
      .sort();
    return ['__all__', ...sorted];
  }, [employeeOptionsData]);

  // Filter op medewerker — match via nameKey
  const filteredRowsByEmp = useMemo(() => {
    if (selectedEmployee === '__all__') return filteredRowsBySub;
    const targetKey = nameKeyAliased(selectedEmployee);
    return filteredRowsBySub.filter(r => nameKeyAliased(r.employee_name) === targetKey);
  }, [filteredRowsBySub, selectedEmployee]);

  // Helper: bepaal contractinfo voor een medewerker uit BU_EMPLOYEES
  function getContractInfo(empName) {
    const buEmps = BU_EMPLOYEES[selectedBU] || [];
    const k = nameKeyAliased(empName);
    if (!k) return null;
    const parts = k.split(' ');
    const first = parts[0], last = parts[parts.length - 1];
    for (const e of buEmps) {
      const ek = nameKeyAliased(e.name);
      if (ek === k) return e;
      const ep = ek.split(' ');
      if (ep[0] === first && ep[ep.length - 1] === last) return e;
    }
    return null;
  }

  // Pas contract-filter toe (alleen vast = filter rijen op medewerkers met Vast contract)
  const filteredRows = useMemo(() => {
    if (contractFilter === 'all') return filteredRowsByEmp;
    // Vast filter: alleen rijen van medewerkers met contract='Vast'
    return filteredRowsByEmp.filter(r => {
      const ci = getContractInfo(r.employee_name);
      return ci && ci.contract === 'Vast';
    });
  }, [filteredRowsByEmp, contractFilter, selectedBU]);

  // Som van contracturen van alle UNIEKE Vaste medewerkers in huidige selectie
  // (voor de groep-contracturen lijn in de grafiek)
  const groupContractHours = useMemo(() => {
    const buEmps = BU_EMPLOYEES[selectedBU] || [];
    if (buEmps.length === 0) return null;
    // Uniek per nameKey (zodat actual+planning duplicaten elkaar niet dubbeltellen)
    const uniqueEmps = new Set();
    filteredRowsByEmp.forEach(r => {
      const ci = getContractInfo(r.employee_name);
      if (ci && ci.contract === 'Vast') {
        // Filter ook op sub-afdeling als die in BU_EMPLOYEES staat (matching met huidige sub-filter)
        if (selectedSub === '__all__') {
          uniqueEmps.add(nameKeyAliased(r.employee_name));
        } else {
          // Match op sub: zit de medewerker in de geselecteerde sub volgens C16?
          if (ci.sub && normalizeSub(ci.sub, selectedBU) === selectedSub) {
            uniqueEmps.add(nameKeyAliased(r.employee_name));
          }
        }
      }
    });
    // Pak per unieke nameKey de contracturen
    let total = 0;
    for (const k of uniqueEmps) {
      const parts = k.split(' ');
      const first = parts[0], last = parts[parts.length - 1];
      for (const e of buEmps) {
        const ek = nameKeyAliased(e.name);
        if (ek === k || (ek.split(' ')[0] === first && ek.split(' ').slice(-1)[0] === last)) {
          if (e.contract === 'Vast' && e.contract_hours) {
            total += e.contract_hours;
          }
          break;
        }
      }
    }
    return total > 0 ? total : null;
  }, [filteredRowsByEmp, selectedBU, selectedSub]);

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

  // Overuren-data per week (vast + flex apart) - werkt OP filteredRowsByEmp dus contract-toggle wordt gerespecteerd
  // voor het vast-deel; flex altijd zichtbaar (er IS toch geen overuren-component voor flex meestal)
  const overtimeData = useMemo(() => {
    const out = {};
    for (let w = 1; w <= 53; w++) {
      out[w] = { week: w, vast: 0, flex: 0 };
    }
    filteredRowsByEmp.forEach(r => {
      if (!r.is_actual) return;
      const w = r.period_week;
      if (!out[w]) return;
      const ci = getContractInfo(r.employee_name);
      const ot = parseFloat(r.overtime_total) || 0;
      if (ci && ci.contract === 'Vast') out[w].vast += ot;
      else out[w].flex += ot;
    });
    return out;
  }, [filteredRowsByEmp, selectedBU]);

  // Variabele (Flex/Onbekend) data per week — alleen hours_worked (regulier + overuren)
  const variableData = useMemo(() => {
    const out = {};
    for (let w = 1; w <= 53; w++) {
      out[w] = { week: w, regular: 0, overtime: 0, hours_worked: 0 };
    }
    filteredRowsByEmp.forEach(r => {
      if (!r.is_actual) return;
      const w = r.period_week;
      if (!out[w]) return;
      const ci = getContractInfo(r.employee_name);
      if (ci && ci.contract === 'Vast') return; // skip vaste
      const hw = parseFloat(r.hours_worked) || 0;
      const ot = parseFloat(r.overtime_total) || 0;
      out[w].hours_worked += hw;
      out[w].overtime += ot;
      out[w].regular += (hw - ot);
    });
    return out;
  }, [filteredRowsByEmp, selectedBU]);

  // KPI's (respect viewMode: alleen weken >= STRUCTURE_START_WEEK in 'recent' mode)
  const kpis = useMemo(() => {
    let totalWork = 0, totalSick = 0, totalLeave = 0, totalOvertime = 0, totalHours = 0;
    let weeksWithActuals = 0;
    Object.values(weekData).forEach(w => {
      if (viewMode === 'recent' && w.week < STRUCTURE_START_WEEK) return;
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
  }, [weekData, viewMode]);

  // Contracturen voor selected employee
  const empContractInfo = useMemo(() => {
    if (selectedEmployee === '__all__') return null;
    const buEmps = BU_EMPLOYEES[selectedBU] || [];
    const targetKey = nameKeyAliased(selectedEmployee);
    const parts = targetKey.split(' ');
    if (parts.length < 2) return null;
    const first = parts[0], last = parts[parts.length - 1];
    for (const e of buEmps) {
      const ek = nameKeyAliased(e.name);
      if (ek === targetKey) return e;
      const ep = ek.split(' ');
      if (ep[0] === first && ep[ep.length - 1] === last) return e;
    }
    return null;
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
  const COLOR_OVERTIME_VAST = '#4a1f8c';  // donkerpaars (Vast)
  const COLOR_OVERTIME_FLEX = '#b284db';  // lichtpaars (Flex)
  const COLOR_SICK = '#a33225';       // rood
  const COLOR_LEAVE = '#9c978c';      // grijs
  const COLOR_PLANNED = '#cce5ff';    // licht blauw voor planning
  const COLOR_CONTRACT = '#1a1a18';

  // Vind max-waarde voor chart Y-as (alleen voor weken die getoond worden)
  const chartMax = useMemo(() => {
    let m = 0;
    Object.values(weekData).forEach(w => {
      if (viewMode === 'recent' && w.week < STRUCTURE_START_WEEK) return;
      const stack = w.regular + w.overtime + w.sick + w.leave;
      const plan = w.planned;
      m = Math.max(m, stack, plan);
    });
    return m * 1.15 || 50;
  }, [weekData, viewMode]);

  // Max voor overuren-grafiek
  const overtimeChartMax = useMemo(() => {
    let m = 0;
    Object.values(overtimeData).forEach(w => {
      if (viewMode === 'recent' && w.week < STRUCTURE_START_WEEK) return;
      const total = w.vast + w.flex;
      m = Math.max(m, total);
    });
    return m * 1.15 || 20;
  }, [overtimeData, viewMode]);

  // Max voor variabele-grafiek
  const variableChartMax = useMemo(() => {
    let m = 0;
    Object.values(variableData).forEach(w => {
      if (viewMode === 'recent' && w.week < STRUCTURE_START_WEEK) return;
      m = Math.max(m, w.hours_worked);
    });
    return m * 1.15 || 50;
  }, [variableData, viewMode]);

  // Weeks om te tonen: 1 t/m max(actual_count, planned_count) week
  const lastWeek = useMemo(() => {
    let last = 0;
    Object.values(weekData).forEach(w => {
      if (w.actual_count > 0 || w.planned_count > 0) last = Math.max(last, w.week);
    });
    return Math.max(last, currentISO.week);
  }, [weekData, currentISO.week]);

  const startWeek = viewMode === 'recent' ? STRUCTURE_START_WEEK : 1;
  const weeksToShow = Array.from({length: Math.max(0, lastWeek - startWeek + 1)}, (_, i) => startWeek + i);

  // SVG chart dimensies
  const chartHeight = 280;
  const chartTop = 20;
  const chartBottom = 40;
  const barWidth = 24;
  const barGap = 4;
  const chartWidth = weeksToShow.length * (barWidth + barGap) + 60;

  function yScale(v, max = chartMax) {
    return chartTop + (chartHeight - chartTop - chartBottom) * (1 - v / max);
  }

  // Contract-uren lijn (alleen voor specifieke medewerker)
  const contractH = empContractInfo?.contract_hours || null;

  // === STYLES ===
  const sectionStyle = {background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)'};

  // Loading-state (na alle hooks om consistente hook-volgorde te bewaren)
  if (loading) {
    return (
      <div style={{minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, fontFamily:"'DM Sans',sans-serif"}}>
        <img src="/logo.png" alt="Booming Solutions" style={{width:64, height:64, borderRadius:14, animation:'pulse 1.5s ease-in-out infinite'}} />
        <div style={{fontSize:13, color:'#6b6960', fontWeight:500}}>Overzicht laden...</div>
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.95)}}`}</style>
      </div>
    );
  }

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
            {subOptions.map(s => {
              if (s === '__sep__') return <option key={s} value="__sep__" disabled>──────────────</option>;
              return <option key={s} value={s}>{s === '__all__' ? '— Hele BU —' : s}</option>;
            })}
          </select>
        </div>
        <div>
          <label style={{display:'block', fontSize:10.5, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:6}}>Medewerker</label>
          <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} style={{padding:'8px 12px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13, minWidth:240}}>
            {employeeOptions.map(e => <option key={e} value={e}>{e === '__all__' ? '— Hele afdeling —' : e}</option>)}
          </select>
        </div>
      </div>

      {/* KPI's */}
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:6, flexWrap:'wrap', gap:8}}>
        <h2 style={{fontSize:13, fontWeight:600, margin:0, color:'#1a1a18'}}>
          KPI's <span style={{fontSize:11, fontWeight:400, color:'#9c978c'}}>
            {viewMode === 'recent' 
              ? '* vanaf week 13 (start nieuwe BU-structuur)' 
              : '* heel 2026 (let op: weken 1-12 hebben oude BU-structuur)'}
            {contractFilter === 'vast' && ' · alleen Vast contract'}
          </span>
        </h2>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, marginBottom:14}}>
        <KPIBlock label="Gewerkte uren*" value={kpis.totalWork.toFixed(0) + 'u'} sub={`${kpis.weeksWithActuals} weken`} color="#0056a3" />
        <KPIBlock label="Gem ziek %*" value={kpis.avgSickPct.toFixed(1) + '%'} sub={kpis.avgSickPct <= 1 ? 'Laag' : kpis.avgSickPct <= 5 ? 'Gemiddeld' : 'Hoog'} color={kpis.avgSickPct <= 1 ? '#3a5a2c' : kpis.avgSickPct <= 5 ? '#856404' : '#a33225'} />
        <KPIBlock label="Overuren*" value={kpis.totalOvertime.toFixed(0) + 'u'} sub={`${(kpis.totalOvertime / kpis.totalWork * 100 || 0).toFixed(1)}% van werk`} color="#6e3bb8" />
        <KPIBlock label="Verlof*" value={kpis.totalLeave.toFixed(0) + 'u'} sub={`${(kpis.totalLeave / (kpis.totalWork + kpis.totalLeave + kpis.totalSick) * 100 || 0).toFixed(1)}% van totaal`} color="#9c978c" />
        <KPIBlock label="Ziek*" value={kpis.totalSick.toFixed(0) + 'u'} sub="totaal" color="#a33225" />
      </div>

      {/* Contract uren info (alleen voor individuele medewerker) */}
      {empContractInfo && (
        <div style={{background:'#f5ebe0', border:'1px solid rgba(0,0,0,0.08)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#6b6960', marginBottom:14}}>
          Contract: <strong>{empContractInfo.contract}</strong> · Contracturen: <strong style={{fontFamily:"'JetBrains Mono',monospace"}}>{empContractInfo.contract_hours}u/wk</strong> · Sub-afdeling: <strong>{empContractInfo.sub}</strong>
        </div>
      )}

      {/* Conflict-banner: mogelijke dubbele namen die NIET zijn samengevoegd */}
      {employeeOptionsData.conflicts && employeeOptionsData.conflicts.length > 0 && (
        <div style={{background:'#fff3cd', border:'1px solid #856404', borderRadius:8, padding:'12px 16px', fontSize:12, color:'#856404', marginBottom:14}}>
          <div style={{fontWeight:600, marginBottom:6}}>⚠ Mogelijk dubbele namen — controleer of het dezelfde persoon is:</div>
          <ul style={{margin:'4px 0 4px 18px', padding:0}}>
            {employeeOptionsData.conflicts.slice(0, 10).map((c, i) => {
              const display1 = employeeOptionsData.byKey.get(c.keys[0])?.display || c.keys[0];
              const display2 = employeeOptionsData.byKey.get(c.keys[1])?.display || c.keys[1];
              return (
                <li key={i} style={{marginBottom:3}}>
                  <strong>{display1}</strong> ↔ <strong>{display2}</strong>{' '}
                  <span style={{color:'#9c978c', fontSize:11}}>({c.reason})</span>
                </li>
              );
            })}
            {employeeOptionsData.conflicts.length > 10 && (
              <li style={{color:'#9c978c'}}>... en nog {employeeOptionsData.conflicts.length - 10} meer</li>
            )}
          </ul>
          <div style={{marginTop:6, fontSize:11}}>Als het dezelfde persoon is, laat het me weten dan voeg ik ze samen in de mapping.</div>
        </div>
      )}

      {/* Hoofdgrafiek: stacked bar regulier + overwerk + ziek + verlof + planning */}
      <div style={{...sectionStyle}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10}}>
          <h2 style={{fontSize:14, fontWeight:600, margin:0}}>Uren per week (2026)</h2>
          <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
            <div style={{display:'inline-flex', background:'#f5ebe0', borderRadius:6, padding:2}}>
              <button onClick={() => setContractFilter('all')} style={{
                padding:'5px 12px', border:'none', background: contractFilter === 'all' ? '#1a1a18' : 'transparent',
                color: contractFilter === 'all' ? '#fff' : '#6b6960', borderRadius:4, fontSize:11, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit'
              }}>Alle medewerkers</button>
              <button onClick={() => setContractFilter('vast')} style={{
                padding:'5px 12px', border:'none', background: contractFilter === 'vast' ? '#1a1a18' : 'transparent',
                color: contractFilter === 'vast' ? '#fff' : '#6b6960', borderRadius:4, fontSize:11, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit'
              }}>Alleen Vast</button>
            </div>
            <div style={{display:'inline-flex', background:'#f5ebe0', borderRadius:6, padding:2}}>
              <button onClick={() => setViewMode('recent')} style={{
                padding:'5px 12px', border:'none', background: viewMode === 'recent' ? '#1a1a18' : 'transparent',
                color: viewMode === 'recent' ? '#fff' : '#6b6960', borderRadius:4, fontSize:11, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit'
              }}>Vanaf wk 13</button>
              <button onClick={() => setViewMode('all')} style={{
                padding:'5px 12px', border:'none', background: viewMode === 'all' ? '#1a1a18' : 'transparent',
                color: viewMode === 'all' ? '#fff' : '#6b6960', borderRadius:4, fontSize:11, fontWeight:600,
                cursor:'pointer', fontFamily:'inherit'
              }}>Heel 2026</button>
            </div>
            <div style={{display:'flex', gap:14, fontSize:11, color:'#6b6960'}}>
              <LegendItem color={COLOR_REGULAR} label="Regulier" />
              <LegendItem color={COLOR_OVERTIME} label="Overuren" />
              <LegendItem color={COLOR_SICK} label="Ziek" />
              <LegendItem color={COLOR_LEAVE} label="Verlof" />
              <LegendItem color={COLOR_PLANNED} label="Planning" stroke />
              {contractH && <LegendItem color={COLOR_CONTRACT} label={`Contract ${contractH}u`} line />}
              {!contractH && groupContractHours && contractFilter === 'vast' && <LegendItem color={COLOR_CONTRACT} label={`Contract Vast ${groupContractHours}u`} line />}
            </div>
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
              {/* Contract uren lijn (per persoon OF groep-som bij Vast filter) */}
              {contractH && (
                <line x1={40} y1={yScale(contractH)} x2={chartWidth} y2={yScale(contractH)} stroke={COLOR_CONTRACT} strokeWidth="1.5" strokeDasharray="5 3" />
              )}
              {!contractH && groupContractHours && contractFilter === 'vast' && groupContractHours <= chartMax && (
                <line x1={40} y1={yScale(groupContractHours)} x2={chartWidth} y2={yScale(groupContractHours)} stroke={COLOR_CONTRACT} strokeWidth="1.5" strokeDasharray="5 3" />
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

      {/* Grafiek 2: Overuren per week (stacked: Vast + Flex) */}
      <div style={{...sectionStyle}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10}}>
          <h2 style={{fontSize:14, fontWeight:600, margin:0}}>Overuren per week</h2>
          <div style={{display:'flex', gap:14, fontSize:11, color:'#6b6960'}}>
            <LegendItem color={COLOR_OVERTIME_VAST} label="Vast" />
            <LegendItem color={COLOR_OVERTIME_FLEX} label="Flex / Onbekend" />
          </div>
        </div>
        <div style={{overflowX:'auto', paddingBottom:8}}>
          <svg width={chartWidth} height={chartHeight} style={{display:'block', minWidth:'100%'}}>
            {/* Y-as gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map(fr => {
              const y = yScale(overtimeChartMax * fr, overtimeChartMax);
              return (
                <g key={fr}>
                  <line x1={40} y1={y} x2={chartWidth} y2={y} stroke="rgba(0,0,0,0.06)" strokeDasharray={fr === 0 ? '' : '2 3'} />
                  <text x={36} y={y + 3} textAnchor="end" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">
                    {(overtimeChartMax * fr).toFixed(0)}
                  </text>
                </g>
              );
            })}
            {weeksToShow.map((w, i) => {
              const x = 45 + i * (barWidth + barGap);
              const d = overtimeData[w];
              let yCursor = chartHeight - chartBottom;
              const segments = [];
              if (d.vast > 0) {
                const segH = (chartHeight - chartTop - chartBottom) * (d.vast / overtimeChartMax);
                segments.push(<rect key="v" x={x} y={yCursor - segH} width={barWidth} height={segH} fill={COLOR_OVERTIME_VAST}><title>{`Wk ${w} · Vast: ${d.vast.toFixed(1)}u`}</title></rect>);
                yCursor -= segH;
              }
              if (d.flex > 0) {
                const segH = (chartHeight - chartTop - chartBottom) * (d.flex / overtimeChartMax);
                segments.push(<rect key="f" x={x} y={yCursor - segH} width={barWidth} height={segH} fill={COLOR_OVERTIME_FLEX}><title>{`Wk ${w} · Flex: ${d.flex.toFixed(1)}u`}</title></rect>);
                yCursor -= segH;
              }
              return (
                <g key={w}>
                  {segments}
                  <text x={x + barWidth/2} y={chartHeight - chartBottom + 12} textAnchor="middle" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">{w}</text>
                </g>
              );
            })}
            <text x={chartWidth/2} y={chartHeight - 4} textAnchor="middle" fontSize="9" fill="#9c978c">Weeknummer</text>
          </svg>
        </div>
      </div>

      {/* Grafiek 3: Variabele uren per week (alleen Flex/Onbekend, regulier + overuren) */}
      <div style={{...sectionStyle}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10}}>
          <h2 style={{fontSize:14, fontWeight:600, margin:0}}>Variabele uren per week <span style={{fontSize:11, fontWeight:400, color:'#9c978c'}}>(alleen Flex / Onbekend contract)</span></h2>
          <div style={{display:'flex', gap:14, fontSize:11, color:'#6b6960'}}>
            <LegendItem color={COLOR_REGULAR} label="Regulier" />
            <LegendItem color={COLOR_OVERTIME} label="Overuren" />
          </div>
        </div>
        <div style={{overflowX:'auto', paddingBottom:8}}>
          <svg width={chartWidth} height={chartHeight} style={{display:'block', minWidth:'100%'}}>
            {[0, 0.25, 0.5, 0.75, 1].map(fr => {
              const y = yScale(variableChartMax * fr, variableChartMax);
              return (
                <g key={fr}>
                  <line x1={40} y1={y} x2={chartWidth} y2={y} stroke="rgba(0,0,0,0.06)" strokeDasharray={fr === 0 ? '' : '2 3'} />
                  <text x={36} y={y + 3} textAnchor="end" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">
                    {(variableChartMax * fr).toFixed(0)}
                  </text>
                </g>
              );
            })}
            {weeksToShow.map((w, i) => {
              const x = 45 + i * (barWidth + barGap);
              const d = variableData[w];
              let yCursor = chartHeight - chartBottom;
              const segments = [];
              if (d.regular > 0) {
                const segH = (chartHeight - chartTop - chartBottom) * (d.regular / variableChartMax);
                segments.push(<rect key="r" x={x} y={yCursor - segH} width={barWidth} height={segH} fill={COLOR_REGULAR}><title>{`Wk ${w} · Regulier: ${d.regular.toFixed(1)}u`}</title></rect>);
                yCursor -= segH;
              }
              if (d.overtime > 0) {
                const segH = (chartHeight - chartTop - chartBottom) * (d.overtime / variableChartMax);
                segments.push(<rect key="o" x={x} y={yCursor - segH} width={barWidth} height={segH} fill={COLOR_OVERTIME}><title>{`Wk ${w} · Overuren: ${d.overtime.toFixed(1)}u`}</title></rect>);
                yCursor -= segH;
              }
              return (
                <g key={w}>
                  {segments}
                  <text x={x + barWidth/2} y={chartHeight - chartBottom + 12} textAnchor="middle" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">{w}</text>
                </g>
              );
            })}
            <text x={chartWidth/2} y={chartHeight - 4} textAnchor="middle" fontSize="9" fill="#9c978c">Weeknummer</text>
          </svg>
        </div>
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
