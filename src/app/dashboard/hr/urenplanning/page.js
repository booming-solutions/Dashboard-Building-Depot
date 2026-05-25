/* ============================================================
   BESTAND: page-urenplanning.js (v8)
   KOPIEER NAAR: src/app/dashboard/hr/urenplanning/page.js

   WIJZIGINGEN v8 (vs v7):
   - Verleden-modus: gebruikt nu ECHTE week-data uit urenplanning_dyflexis (is_actual=true)
     i.p.v. maand-schatting. Banner aangepast.
   - Geen dag-cellen meer in verleden-modus, alleen week-totalen
   - Nieuwe kolommen in verleden-modus: Verlof, Ziek, Ziek %
   - Toekomst-modus heeft "Ziek %" kolom met 3-maands gemiddelde (uit actuals)
   - Kleurcodering: overuren=paarstinten, ziekte=roodtinten
   - Ziekte-codering: ≤1% groen, 1-5% geel, >5% rood
   - Overwerk-codering: ≤contract neutraal, 1-10% boven geel, >10% boven rood

   WIJZIGINGEN v7 (vs v6):
   - Verleden-modus: weken vóór huidige week tonen Actual data (uit ACTUALS embed)
   - Actuals geschat per dag uit maand-totalen (banner met disclaimer)
   - Nieuwe kolom "Gem 3 mnd": gemiddelde werk per week feb-apr 2026
   - Kleurcodering rij: groen ≤contract, geel 1-10% boven, rood >10% boven
   - Actuals tot 1 jan 2026 navigeerbaar (jan-apr 2026)
   - Open dienst rij verborgen in verleden-modus
   - Actuals-dagcellen in andere kleur (blauw) ipv zwart

   WIJZIGINGEN v6:
   - Read-only weergave van Dyflexis-data uit urenplanning_dyflexis
   - Geen handmatige invoer meer
   - Overuren-kolom, Open dienst rijen, target-balk
   - Sticky tabel-header, sortering
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// Medewerkers per BU — uit C16 voor contract-info (Vast/Flex, contracturen)
const BU_EMPLOYEES = {"BU Appliance/Houseware":[{"name":"Michanu Isenia","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Michelangelo Lourens","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Ruthlyn Comenencia Martina","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Shelah Janga","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Nilo  Grotestam","contract":"Flexibel","sub":"A/H Operations","contract_hours":null},{"name":"Sheila Lacrum Wawoe","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Francisco Doran","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Christopher Bakmeijer","contract":"Vast","sub":"A/H Operations","contract_hours":40.0},{"name":"Rudelly Mauricia","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Daniel Louman","contract":"Vast","sub":"A/H Management","contract_hours":40.0},{"name":"Kevin Djotaroeno","contract":"Onbekend","sub":"A/H Management","contract_hours":null}],"BU Building Materials":[{"name":"Niasotis Dandare Ellis","contract":"Vast","sub":"Building Materials Management","contract_hours":40.0}],"BU Hardware":[{"name":"Tercy Stewart","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shannon Martha","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marciela Andrea","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Gilbert Santiroma","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marshelon Janzen","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"John Candelaria","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Shuwender Rosini","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Keith Taylor","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Eliana  Dangond Pabon","contract":"Vast","sub":"Hardware Management","contract_hours":40.0},{"name":"Jowendrick Sillie","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Archel Presentacion","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Minguel Goedgedrag","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Javier Martis","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Noah Frankenberger","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Marlon Meyer","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Rishantely Jantje","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Christopher Bregita","contract":"Vast","sub":"Hardware Operations","contract_hours":24.0},{"name":"Jhonny Garves","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Noudimar Dorothea","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Tyshawn  Angela","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Raymi-Engelo Regina","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Vai-Ona Martines","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null},{"name":"Guishawn Wanga","contract":"Vast","sub":"Hardware Operations","contract_hours":40.0},{"name":"Dejuan Brown","contract":"Onbekend","sub":"Hardware Operations","contract_hours":null},{"name":"Rigchantely Da Costa Gomez","contract":"Flexibel","sub":"Hardware Operations","contract_hours":null}],"BU Living":[{"name":"Gijs Verkuijl","contract":"Onbekend","sub":"Living Management","contract_hours":null},{"name":"Franklin Domatilia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Ingerson Carmela","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Sus-Marianne Anastasia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Vianel Brazoban","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Laymine Zimmerman","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Sidmarelly Henriquez","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Tharinah Sophia","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Thysheliene Martiszoon","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Connelly  Lourens","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Dianne Meyer - Walle","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Nareelis Jakoba","contract":"Vast","sub":"Living Management","contract_hours":40.0},{"name":"Roberto Badaracco","contract":"Vast","sub":"Living Management","contract_hours":32.0},{"name":"Armigilda Kopra","contract":"Vast","sub":"Living Operations","contract_hours":28.0},{"name":"Hannah Perlaza","contract":"Onbekend","sub":"Living Operations","contract_hours":null},{"name":"Mariejela Rosinda Victor","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Dianni Colon","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Jair Mattheeuw","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Qiyazir Lake","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Carina Tidu","contract":"Vast","sub":"Living Operations","contract_hours":40.0},{"name":"Noemi-Eluzai Cijntje","contract":"Flexibel","sub":"Living Operations","contract_hours":null},{"name":"Zufreni Martis","contract":"Onbekend","sub":"Living Operations","contract_hours":null}],"BU Sanitair/Keuken":[{"name":"Michael Matroos","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Navin Ramdjas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Enoc Merkies","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Mireya Meyer Rojas","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Steven Rogers","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Vianaly Victor","contract":"Vast","sub":"S/K Operations","contract_hours":40.0},{"name":"Jamira Webster","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Ivo Proveniers","contract":"Vast","sub":"S/K Management","contract_hours":40.0},{"name":"Henk Van Veen","contract":"Vast","sub":"S/K Management","contract_hours":40.0}],"Smart Finance":[{"name":"Judith Petronilia","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Jacqueline  Schotborgh","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Ivaira Windster","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Coralisa Windt De - Verstijnen","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Dienca  Arneman, Van","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Sharesca Niebe","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Yurriene Gonzalez","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Melivienne Legrand","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Karla Valencia - Angarita","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Wilfried Ambrotius","contract":"Onbekend","sub":"Algemeen","contract_hours":null},{"name":"Lysandra Rafaela Becker","contract":"Onbekend","sub":"Algemeen","contract_hours":null}],"Logistiek":[{"name":"Ramsley Salome","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"John van den Berg","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Robin Hooi","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Norwin Andrea","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Eugene Antonio","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Ricardo Pierre","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shakur Bernadina","contract":"Vast","sub":"Tussenmagazijn","contract_hours":40.0},{"name":"Patrick Newton","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Aldrin Vlijtig","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Harvey  Raap","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Sandrey  Richardson","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Shairlyson  Sambo","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Joubert Pieters","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Xavier Werleman","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Naigelon  Clemensia","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Jurrandy Brandao","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Jurich Martina","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Hensley Sambo","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Marijke Antonia","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Ashneltrida Martis","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Herbert Pisas","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Benjamin Martijn","contract":"Vast","sub":"Transit","contract_hours":40.0},{"name":"Sharimar Faneite","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Germilson  Seintje","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Rowendry Martina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Gilma Coco","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Adrianus Zijlstra","contract":"Vast","sub":"Brievengat 02","contract_hours":40.0},{"name":"Reimy Ferero Abreu","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Lativa  Pieters","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Curtney Cicilia","contract":"Vast","sub":"Logistics coordinator","contract_hours":40.0},{"name":"Roderick Paulina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Urlick Romsina","contract":"Vast","sub":"Drive Thru","contract_hours":40.0},{"name":"Denzell Russel","contract":"Flexibel","sub":"Transit","contract_hours":null},{"name":"Timothy Newton","contract":"Flexibel","sub":"Brievengat 02","contract_hours":null},{"name":"Railison Daal","contract":"Onbekend","sub":"Brievengat 05","contract_hours":null},{"name":"Rujairo Ricao","contract":"Vast","sub":"Brievengat 05","contract_hours":40.0},{"name":"Fabian Mom","contract":"Onbekend","sub":"Supervisors Logistiek","contract_hours":null}],"Store Support":[{"name":"Giovanni Pinedo","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Orlando Reenis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Guadeloup Elisabeth","contract":"Flexibel","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Sidney T. Molina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Ludwina Casser","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Deborah Koeyers","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Nefertari Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"David Waaldijk","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Yeyson Marte Abreu","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Shahira Roberto","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Alvin D Silberie","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Zuneida Alvarez","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Ignaldaly Garcia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Shellany Constansia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":30.0},{"name":"Luisana Chirino","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Philonairis Maria","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Lyene  Daal","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Richinella Obia","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Ruthsarai Gallardo","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Keisha Martina","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Marielou  Alexander","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Handre Owens","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Stephanie  Girigori","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Adriana Martes Reyes","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Merugia Cathalina-Martis","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Rochendry Doran","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Dayanara Libinia","contract":"Vast","sub":"Inventory Controller","contract_hours":40.0},{"name":"Carlos De Franca","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Eldert Juliana","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Dianira Scherptong","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":40.0},{"name":"Renaisha Wijngaarden","contract":"Vast","sub":"B2B","contract_hours":40.0},{"name":"Jesseline Sebelon De Wind","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Brithney Garcia","contract":"Onbekend","sub":"Winkel > Store support Kassa","contract_hours":null},{"name":"Eduard Carolina","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Allan Pedro","contract":"Vast","sub":"Facilitair","contract_hours":40.0},{"name":"Rose Cenord Desrosiers","contract":"Vast","sub":"Store Support Schoonmaak","contract_hours":40.0},{"name":"Jonathan de Wolff","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Omar Requena","contract":"Vast","sub":"IT","contract_hours":40.0},{"name":"Alberto Betrian","contract":"Vast","sub":"Winkel > Store support Customer Service","contract_hours":40.0},{"name":"Chanarda Davis","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0},{"name":"Liselotte Rojer","contract":"Vast","sub":"Marketing","contract_hours":36.0},{"name":"Clifton Koeyers","contract":"Vast","sub":"Inventory Controller","contract_hours":20.0},{"name":"Jeandrelika Schoop","contract":"Flexibel","sub":"Winkel > Store support Customer Service","contract_hours":null},{"name":"Agnette Pedro - Trotman","contract":"Vast","sub":"Inventory Controller","contract_hours":32.0},{"name":"Marlon Atmodimedjo","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Luigino Kauw-A-Tjoe","contract":"Vast","sub":"Marketing","contract_hours":30.0},{"name":"Brittany Haase","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":16.0},{"name":"Quisheena Maduro","contract":"Vast","sub":"Winkel > Store support Kassa","contract_hours":10.0},{"name":"Franciscus van Kessel","contract":"Vast","sub":"B2B","contract_hours":20.0},{"name":"Franklin Quinones Echeverria","contract":"Onbekend","sub":"Facilitair","contract_hours":null},{"name":"Bobby Herder","contract":"Vast","sub":"Marketing","contract_hours":32.0},{"name":"Jundrick Jansen","contract":"Flexibel","sub":"Marketing","contract_hours":null},{"name":"Wendell Finies","contract":"Vast","sub":"Store support -Bewaking","contract_hours":40.0}]};


// Actuals per maand per BU per medewerker (jan-26 t/m apr-26)
// Bron: trend_data_v5.json uit Dyflexis maandelijkse exports
// Structuur: month -> bu -> [{n: name, w: work, ot: overtime, lv: leave, sk: sick}]
const ACTUALS = {"jan-26":{"BU Appliance/Houseware":[{"n":"Christopher Bakmeijer","w":173.8,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Francisco Doran","w":162.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Nilo  Grotestam","w":185.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Shelah Janga","w":156.8,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Michanu Isenia","w":182.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Ruthlyn Comenencia Martina","w":169.2,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Shaideney Lourens","w":141.0,"ot":0.0,"lv":8.0,"sk":24.0},{"n":"Sheila Lacrum Wawoe","w":156.5,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Rudelly Mauricia","w":137.5,"ot":0.0,"lv":37.0,"sk":0.0},{"n":"Daniel Louman","w":155.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Kevin Djotaroeno","w":165.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Michelangelo Lourens","w":59.4,"ot":0.0,"lv":8.0,"sk":119.6}],"BU Building Materials":[{"n":"Niasotis Dandare Ellis","w":0.0,"ot":0.0,"lv":16.0,"sk":160.0}],"BU Hardware":[{"n":"Noah Frankenberger","w":162.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Javier Martis","w":157.0,"ot":0.0,"lv":29.0,"sk":0.0},{"n":"Jhonny Garves","w":134.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jowendrick Sillie","w":147.2,"ot":0.0,"lv":28.0,"sk":0.0},{"n":"Marciela Andrea","w":153.8,"ot":0.0,"lv":24.0,"sk":16.0},{"n":"Marlon Meyer","w":130.6,"ot":0.0,"lv":17.2,"sk":8.0},{"n":"Minguel Goedgedrag","w":184.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Noudimar Dorothea","w":102.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Raymi-Engelo Regina","w":66.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Rishantely Jantje","w":111.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shannon Martha","w":141.7,"ot":0.0,"lv":16.0,"sk":24.0},{"n":"Shuwender Rosini","w":96.5,"ot":0.0,"lv":56.5,"sk":32.0},{"n":"Tyshawn  Angela","w":36.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Archel Presentacion","w":168.6,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Christopher Bregita","w":139.1,"ot":0.0,"lv":8.0,"sk":16.0},{"n":"Gilbert Santiroma","w":160.9,"ot":0.0,"lv":13.2,"sk":0.0},{"n":"Marshelon Janzen","w":115.7,"ot":0.0,"lv":64.0,"sk":0.0},{"n":"Eliana  Dangond Pabon","w":77.2,"ot":0.0,"lv":74.0,"sk":24.0},{"n":"John Candelaria","w":158.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Tercy Stewart","w":189.4,"ot":0.0,"lv":15.0,"sk":0.0},{"n":"Keith Taylor","w":160.6,"ot":0.0,"lv":24.0,"sk":0.0}],"BU Living":[{"n":"Dianne Meyer - Walle","w":110.2,"ot":0.0,"lv":61.5,"sk":0.0},{"n":"Nareelis Jakoba","w":158.8,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Gijs Verkuijl","w":168.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Vianel Brazoban","w":149.0,"ot":0.0,"lv":28.0,"sk":8.0},{"n":"Roberto Badaracco","w":130.0,"ot":0.0,"lv":23.0,"sk":0.0},{"n":"Ingerson Carmela","w":146.8,"ot":0.0,"lv":9.2,"sk":0.0},{"n":"Hannah Perlaza","w":61.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Zufreni Martis","w":152.5,"ot":0.0,"lv":17.0,"sk":8.0},{"n":"Armigilda Kopra","w":87.5,"ot":0.0,"lv":42.0,"sk":0.0},{"n":"Connelly  Lourens","w":164.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Dianni Colon","w":120.2,"ot":0.0,"lv":4.0,"sk":0.0},{"n":"Franklin Domatilia","w":162.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Jair Mattheeuw","w":40.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Laymine Zimmerman","w":186.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Sidmarelly Henriquez","w":167.0,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Sus-Marianne Anastasia","w":163.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Tharinah Sophia","w":120.0,"ot":0.0,"lv":68.0,"sk":8.0},{"n":"Thysheliene Martiszoon","w":100.5,"ot":0.0,"lv":88.0,"sk":0.0},{"n":"Qiyazir Lake","w":5.5,"ot":0.0,"lv":0.0,"sk":0.0}],"BU Sanitair/Keuken":[{"n":"Vianaly Victor","w":150.0,"ot":0.0,"lv":16.0,"sk":8.0},{"n":"Michael Matroos","w":119.2,"ot":0.0,"lv":26.0,"sk":40.0},{"n":"Mireya Meyer Rojas","w":175.2,"ot":0.0,"lv":20.0,"sk":0.0},{"n":"Navin Ramdjas","w":170.3,"ot":0.0,"lv":8.8,"sk":0.0},{"n":"Steven Rogers","w":156.8,"ot":0.0,"lv":32.2,"sk":0.0},{"n":"Ivo Proveniers","w":175.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Jamira Webster","w":79.0,"ot":0.0,"lv":96.0,"sk":0.0},{"n":"Enoc Merkies","w":197.3,"ot":0.0,"lv":8.0,"sk":0.0}],"Smart Finance":[{"n":"Coralisa Windt De - Verstijnen","w":167.7,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Dienca  Arneman, Van","w":104.0,"ot":0.0,"lv":40.0,"sk":24.0},{"n":"Ivaira Windster","w":179.6,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Jacqueline  Schotborgh","w":168.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Judith Petronilia","w":165.8,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Karla Valencia - Angarita","w":0.0,"ot":0.0,"lv":184.0,"sk":0.0},{"n":"Lysandra Rafaela Becker","w":141.7,"ot":0.0,"lv":7.0,"sk":0.0},{"n":"Melivienne Legrand","w":141.8,"ot":0.0,"lv":16.0,"sk":24.0},{"n":"Sharesca Niebe","w":159.0,"ot":0.0,"lv":17.0,"sk":0.0},{"n":"Wilfried Ambrotius","w":87.8,"ot":0.0,"lv":88.0,"sk":0.0},{"n":"Yurriene Gonzalez","w":144.0,"ot":0.0,"lv":16.0,"sk":16.0}],"Logistiek":[{"n":"Adrianus Zijlstra","w":153.0,"ot":0.0,"lv":16.0,"sk":6.2},{"n":"Ashneltrida Martis","w":168.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Eugene Antonio","w":172.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"John van den Berg","w":186.5,"ot":0.0,"lv":16.8,"sk":0.0},{"n":"Joubert Pieters","w":178.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Xavier Werleman","w":152.0,"ot":0.0,"lv":9.0,"sk":24.0},{"n":"Germilson  Seintje","w":166.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Gilma Coco","w":144.0,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Jurich Martina","w":170.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Marijke Antonia","w":80.0,"ot":0.0,"lv":56.0,"sk":40.0},{"n":"Shairlyson  Sambo","w":149.8,"ot":0.0,"lv":8.0,"sk":24.0},{"n":"Aldrin Vlijtig","w":156.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Benjamin Martijn","w":138.8,"ot":0.0,"lv":37.2,"sk":0.0},{"n":"Denzell Russel","w":91.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Naigelon  Clemensia","w":167.8,"ot":0.0,"lv":9.5,"sk":0.0},{"n":"Ricardo Pierre","w":165.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Sandrey  Richardson","w":170.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Ramsley Salome","w":159.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Robin Hooi","w":173.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Shakur Bernadina","w":178.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Harvey  Raap","w":183.8,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Hensley Sambo","w":184.8,"ot":0.0,"lv":14.2,"sk":0.0},{"n":"Herbert Pisas","w":163.2,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Jurrandy Brandao","w":170.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Norwin Andrea","w":181.5,"ot":0.0,"lv":25.0,"sk":0.0},{"n":"Patrick Newton","w":109.2,"ot":0.0,"lv":74.2,"sk":0.0},{"n":"Reimy Ferero Abreu","w":162.0,"ot":0.0,"lv":17.2,"sk":0.0},{"n":"Roderick Paulina","w":99.0,"ot":0.0,"lv":18.2,"sk":0.0},{"n":"Rowendry Martina","w":167.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Sharimar Faneite","w":168.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Urlick Romsina","w":105.5,"ot":0.0,"lv":78.0,"sk":0.0},{"n":"Curtney Cicilia","w":119.5,"ot":0.0,"lv":56.0,"sk":0.0},{"n":"Lativa  Pieters","w":161.5,"ot":0.0,"lv":12.0,"sk":0.0}],"Store Support":[{"n":"Carlos De Franca","w":160.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Franciscus van Kessel","w":80.0,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Renaisha Wijngaarden","w":168.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Rochendry Doran","w":120.0,"ot":0.0,"lv":56.0,"sk":0.0},{"n":"Allan Pedro","w":88.0,"ot":0.0,"lv":8.0,"sk":80.0},{"n":"Franklin Quinones Echeverria","w":123.0,"ot":0.0,"lv":32.0,"sk":21.0},{"n":"Agnette Pedro - Trotman","w":132.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Clifton Koeyers","w":122.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Dayanara Libinia","w":159.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Ignaldaly Garcia","w":150.8,"ot":0.0,"lv":16.5,"sk":0.0},{"n":"Merugia Cathalina-Martis","w":151.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Jonathan de Wolff","w":154.2,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Omar Requena","w":153.2,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Liselotte Rojer","w":136.8,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Luigino Kauw-A-Tjoe","w":100.8,"ot":0.0,"lv":19.0,"sk":0.0},{"n":"Marlon Atmodimedjo","w":123.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Adriana Martes Reyes","w":154.0,"ot":0.0,"lv":46.2,"sk":0.0},{"n":"Jesseline Sebelon De Wind","w":139.2,"ot":0.0,"lv":35.6,"sk":0.0},{"n":"Rose Cenord Desrosiers","w":111.5,"ot":0.0,"lv":72.0,"sk":0.0},{"n":"Yeyson Marte Abreu","w":173.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Alvin D Silberie","w":191.6,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Chanarda Davis","w":204.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"David Waaldijk","w":187.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Eduard Carolina","w":165.7,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Giovanni Pinedo","w":261.4,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Handre Owens","w":146.3,"ot":0.0,"lv":48.0,"sk":0.0},{"n":"Orlando Reenis","w":226.8,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Sidney T. Molina","w":167.4,"ot":0.0,"lv":16.0,"sk":8.0},{"n":"Zuneida Alvarez","w":181.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Alberto Betrian","w":161.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Eldert Juliana","w":119.5,"ot":0.0,"lv":8.0,"sk":40.0},{"n":"Jeandrelika Schoop","w":162.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Keisha Martina","w":169.2,"ot":0.0,"lv":9.5,"sk":8.0},{"n":"Ludwina Casser","w":69.0,"ot":0.0,"lv":120.0,"sk":0.0},{"n":"Luisana Chirino","w":118.0,"ot":0.0,"lv":56.0,"sk":0.0},{"n":"Philonairis Maria","w":174.2,"ot":0.0,"lv":11.0,"sk":0.0},{"n":"Shahira Roberto","w":159.2,"ot":0.0,"lv":10.0,"sk":16.0},{"n":"Brithney Garcia","w":169.6,"ot":0.0,"lv":16.0,"sk":8.0},{"n":"Brittany Haase","w":141.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Deborah Koeyers","w":168.8,"ot":0.0,"lv":28.0,"sk":0.0},{"n":"Dianira Scherptong","w":131.8,"ot":0.0,"lv":27.2,"sk":21.0},{"n":"Guadeloup Elisabeth","w":182.8,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Lyene  Daal","w":171.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Marielou  Alexander","w":142.2,"ot":0.0,"lv":12.8,"sk":30.0},{"n":"Nefertari Maduro","w":168.6,"ot":0.0,"lv":0.0,"sk":16.0},{"n":"Quisheena Maduro","w":110.4,"ot":0.0,"lv":13.0,"sk":8.0},{"n":"Richinella Obia","w":177.2,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Ruthsarai Gallardo","w":175.2,"ot":0.0,"lv":22.0,"sk":0.0},{"n":"Shellany Constansia","w":176.5,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Stephanie  Girigori","w":162.5,"ot":0.0,"lv":12.0,"sk":8.0}]},"feb-26":{"BU Appliance/Houseware":[{"n":"Christopher Bakmeijer","w":129.0,"ot":0.0,"lv":17.0,"sk":0.0},{"n":"Francisco Doran","w":55.0,"ot":0.0,"lv":104.0,"sk":0.0},{"n":"Nilo  Grotestam","w":153.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Shelah Janga","w":84.0,"ot":0.0,"lv":0.0,"sk":80.0},{"n":"Michanu Isenia","w":171.8,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Ruthlyn Comenencia Martina","w":165.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Sheila Lacrum Wawoe","w":84.0,"ot":0.0,"lv":7.5,"sk":64.0},{"n":"Rudelly Mauricia","w":127.5,"ot":0.0,"lv":23.0,"sk":0.0},{"n":"Daniel Louman","w":143.2,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Kevin Djotaroeno","w":141.0,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Michelangelo Lourens","w":94.5,"ot":0.0,"lv":8.0,"sk":73.0}],"BU Building Materials":[{"n":"Niasotis Dandare Ellis","w":35.2,"ot":0.0,"lv":8.0,"sk":116.8}],"BU Hardware":[{"n":"Noah Frankenberger","w":147.4,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Jowendrick Sillie","w":96.0,"ot":0.0,"lv":54.0,"sk":0.0},{"n":"Shannon Martha","w":156.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Javier Martis","w":128.2,"ot":0.0,"lv":10.0,"sk":16.0},{"n":"Jhonny Garves","w":118.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Marciela Andrea","w":161.2,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Marlon Meyer","w":119.2,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Minguel Goedgedrag","w":156.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Noudimar Dorothea","w":89.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shuwender Rosini","w":170.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Raymi-Engelo Regina","w":87.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Rishantely Jantje","w":98.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Tyshawn  Angela","w":45.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Archel Presentacion","w":142.0,"ot":0.0,"lv":13.0,"sk":0.0},{"n":"Christopher Bregita","w":0.0,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Gilbert Santiroma","w":115.2,"ot":0.0,"lv":34.5,"sk":8.0},{"n":"Marshelon Janzen","w":151.0,"ot":0.0,"lv":11.0,"sk":0.0},{"n":"Eliana  Dangond Pabon","w":126.0,"ot":0.0,"lv":13.0,"sk":16.0},{"n":"John Candelaria","w":135.5,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Tercy Stewart","w":164.6,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Keith Taylor","w":134.0,"ot":0.0,"lv":16.0,"sk":8.0}],"BU Living":[{"n":"Dianne Meyer - Walle","w":135.2,"ot":0.0,"lv":15.5,"sk":0.0},{"n":"Nareelis Jakoba","w":141.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Vianel Brazoban","w":150.2,"ot":0.0,"lv":17.0,"sk":0.0},{"n":"Roberto Badaracco","w":109.0,"ot":0.0,"lv":3.0,"sk":16.0},{"n":"Gijs Verkuijl","w":159.5,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Ingerson Carmela","w":134.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Hannah Perlaza","w":97.0,"ot":0.0,"lv":8.0,"sk":16.0},{"n":"Zufreni Martis","w":24.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Armigilda Kopra","w":115.2,"ot":0.0,"lv":6.0,"sk":0.0},{"n":"Connelly  Lourens","w":141.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Franklin Domatilia","w":126.8,"ot":0.0,"lv":36.0,"sk":0.0},{"n":"Jair Mattheeuw","w":26.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Laymine Zimmerman","w":69.0,"ot":0.0,"lv":80.0,"sk":0.0},{"n":"Mariejela Rosinda Victor","w":139.3,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Sidmarelly Henriquez","w":129.5,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Sus-Marianne Anastasia","w":147.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Tharinah Sophia","w":130.5,"ot":0.0,"lv":16.0,"sk":16.0},{"n":"Thysheliene Martiszoon","w":151.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Dianni Colon","w":80.0,"ot":0.0,"lv":0.0,"sk":0.0}],"BU Sanitair/Keuken":[{"n":"Henk Van Veen","w":72.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ivo Proveniers","w":146.8,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Jamira Webster","w":120.0,"ot":0.0,"lv":10.0,"sk":24.0},{"n":"Enoc Merkies","w":157.3,"ot":0.0,"lv":5.0,"sk":0.0},{"n":"Vianaly Victor","w":116.2,"ot":0.0,"lv":40.2,"sk":0.0},{"n":"Michael Matroos","w":172.0,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Mireya Meyer Rojas","w":70.0,"ot":0.0,"lv":80.5,"sk":0.0},{"n":"Navin Ramdjas","w":169.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Steven Rogers","w":122.6,"ot":0.0,"lv":45.2,"sk":0.0}],"Smart Finance":[{"n":"Coralisa Windt De - Verstijnen","w":137.2,"ot":0.0,"lv":9.0,"sk":16.0},{"n":"Dienca  Arneman, Van","w":145.8,"ot":0.0,"lv":14.0,"sk":0.0},{"n":"Ivaira Windster","w":124.6,"ot":0.0,"lv":38.0,"sk":8.0},{"n":"Jacqueline  Schotborgh","w":112.0,"ot":0.0,"lv":16.0,"sk":32.0},{"n":"Judith Petronilia","w":130.2,"ot":0.0,"lv":29.0,"sk":0.0},{"n":"Karla Valencia - Angarita","w":0.0,"ot":0.0,"lv":160.0,"sk":0.0},{"n":"Lysandra Rafaela Becker","w":127.7,"ot":0.0,"lv":10.5,"sk":0.0},{"n":"Melivienne Legrand","w":100.3,"ot":0.0,"lv":27.0,"sk":24.0},{"n":"Sharesca Niebe","w":113.2,"ot":0.0,"lv":47.0,"sk":0.0},{"n":"Wilfried Ambrotius","w":76.5,"ot":0.0,"lv":27.0,"sk":56.0},{"n":"Yurriene Gonzalez","w":127.2,"ot":0.0,"lv":23.5,"sk":8.0}],"Logistiek":[{"n":"Adrianus Zijlstra","w":134.8,"ot":0.0,"lv":25.0,"sk":0.0},{"n":"Ashneltrida Martis","w":145.0,"ot":0.0,"lv":21.0,"sk":0.0},{"n":"Eugene Antonio","w":168.0,"ot":0.0,"lv":13.0,"sk":0.0},{"n":"John van den Berg","w":168.2,"ot":0.0,"lv":11.0,"sk":0.0},{"n":"Joubert Pieters","w":158.0,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Xavier Werleman","w":64.5,"ot":0.0,"lv":39.0,"sk":56.0},{"n":"Germilson  Seintje","w":122.5,"ot":0.0,"lv":13.0,"sk":24.0},{"n":"Gilma Coco","w":126.8,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Jurich Martina","w":115.0,"ot":0.0,"lv":21.0,"sk":24.0},{"n":"Marijke Antonia","w":145.0,"ot":0.0,"lv":21.0,"sk":0.0},{"n":"Shairlyson  Sambo","w":83.8,"ot":0.0,"lv":8.0,"sk":74.2},{"n":"Aldrin Vlijtig","w":165.0,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Benjamin Martijn","w":132.2,"ot":0.0,"lv":26.0,"sk":0.0},{"n":"Denzell Russel","w":66.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Naigelon  Clemensia","w":158.0,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Ricardo Pierre","w":151.5,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Sandrey  Richardson","w":150.8,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Ramsley Salome","w":174.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Robin Hooi","w":164.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Shakur Bernadina","w":155.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Harvey  Raap","w":156.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Hensley Sambo","w":148.2,"ot":0.0,"lv":21.5,"sk":0.0},{"n":"Herbert Pisas","w":151.2,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Jurrandy Brandao","w":123.0,"ot":0.0,"lv":8.0,"sk":32.0},{"n":"Norwin Andrea","w":169.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Patrick Newton","w":156.5,"ot":0.0,"lv":8.5,"sk":0.0},{"n":"Reimy Ferero Abreu","w":123.8,"ot":0.0,"lv":32.5,"sk":0.0},{"n":"Roderick Paulina","w":126.2,"ot":0.0,"lv":18.5,"sk":8.0},{"n":"Rowendry Martina","w":139.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Sharimar Faneite","w":122.5,"ot":0.0,"lv":32.5,"sk":0.0},{"n":"Urlick Romsina","w":127.5,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Curtney Cicilia","w":137.8,"ot":0.0,"lv":17.0,"sk":0.0},{"n":"Lativa  Pieters","w":135.2,"ot":0.0,"lv":18.5,"sk":0.0}],"Store Support":[{"n":"Carlos De Franca","w":151.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Franciscus van Kessel","w":76.0,"ot":0.0,"lv":4.0,"sk":0.0},{"n":"Renaisha Wijngaarden","w":139.0,"ot":0.0,"lv":20.0,"sk":0.0},{"n":"Rochendry Doran","w":136.0,"ot":0.0,"lv":8.0,"sk":16.0},{"n":"Allan Pedro","w":152.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Franklin Quinones Echeverria","w":91.2,"ot":0.0,"lv":8.0,"sk":60.0},{"n":"Agnette Pedro - Trotman","w":114.0,"ot":0.0,"lv":11.0,"sk":0.0},{"n":"Clifton Koeyers","w":94.0,"ot":0.0,"lv":36.0,"sk":24.0},{"n":"Dayanara Libinia","w":147.0,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Ignaldaly Garcia","w":147.1,"ot":0.0,"lv":12.5,"sk":0.0},{"n":"Merugia Cathalina-Martis","w":145.8,"ot":0.0,"lv":13.5,"sk":0.0},{"n":"Jonathan de Wolff","w":142.8,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Omar Requena","w":141.2,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Liselotte Rojer","w":107.2,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Luigino Kauw-A-Tjoe","w":110.0,"ot":0.0,"lv":4.0,"sk":0.0},{"n":"Marlon Atmodimedjo","w":98.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Adriana Martes Reyes","w":134.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Jesseline Sebelon De Wind","w":125.0,"ot":0.0,"lv":17.0,"sk":16.0},{"n":"Rose Cenord Desrosiers","w":115.0,"ot":0.0,"lv":9.0,"sk":32.0},{"n":"Yeyson Marte Abreu","w":151.8,"ot":0.0,"lv":19.2,"sk":0.0},{"n":"Alvin D Silberie","w":150.7,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Chanarda Davis","w":54.0,"ot":0.0,"lv":56.0,"sk":0.0},{"n":"David Waaldijk","w":150.2,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Eduard Carolina","w":131.8,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Giovanni Pinedo","w":193.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Handre Owens","w":126.3,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Orlando Reenis","w":167.1,"ot":0.0,"lv":17.5,"sk":0.0},{"n":"Sidney T. Molina","w":175.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Zuneida Alvarez","w":148.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Alberto Betrian","w":122.0,"ot":0.0,"lv":14.0,"sk":16.0},{"n":"Eldert Juliana","w":145.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Jeandrelika Schoop","w":136.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Keisha Martina","w":134.0,"ot":0.0,"lv":8.0,"sk":16.0},{"n":"Ludwina Casser","w":148.2,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Luisana Chirino","w":157.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Philonairis Maria","w":146.0,"ot":0.0,"lv":21.0,"sk":0.0},{"n":"Shahira Roberto","w":137.5,"ot":0.0,"lv":25.5,"sk":0.0},{"n":"Brithney Garcia","w":131.0,"ot":0.0,"lv":0.0,"sk":16.0},{"n":"Brittany Haase","w":93.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Deborah Koeyers","w":133.2,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Dianira Scherptong","w":125.2,"ot":0.0,"lv":32.0,"sk":8.0},{"n":"Guadeloup Elisabeth","w":163.5,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Lyene  Daal","w":119.2,"ot":0.0,"lv":44.2,"sk":0.0},{"n":"Marielou  Alexander","w":158.0,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Nefertari Maduro","w":156.8,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Quisheena Maduro","w":63.8,"ot":0.0,"lv":21.0,"sk":0.0},{"n":"Richinella Obia","w":150.2,"ot":0.0,"lv":18.8,"sk":0.0},{"n":"Ruthsarai Gallardo","w":165.2,"ot":0.0,"lv":2.0,"sk":0.0},{"n":"Shellany Constansia","w":131.0,"ot":0.0,"lv":10.0,"sk":24.0},{"n":"Stephanie  Girigori","w":129.5,"ot":0.0,"lv":16.0,"sk":14.0}]},"mrt-26":{"BU Appliance/Houseware":[{"n":"Daniel Louman","w":171.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Kevin Djotaroeno","w":171.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Michelangelo Lourens","w":170.2,"ot":0.0,"lv":1.0,"sk":29.0},{"n":"Rudelly Mauricia","w":175.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Christopher Bakmeijer","w":167.8,"ot":0.0,"lv":5.0,"sk":0.0},{"n":"Francisco Doran","w":159.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Michanu Isenia","w":206.7,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Nilo  Grotestam","w":182.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ruthlyn Comenencia Martina","w":183.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Sheila Lacrum Wawoe","w":136.2,"ot":0.0,"lv":41.2,"sk":0.0},{"n":"Shelah Janga","w":179.9,"ot":0.0,"lv":0.0,"sk":0.0}],"BU Building Materials":[{"n":"Niasotis Dandare Ellis","w":167.2,"ot":0.0,"lv":8.0,"sk":0.0}],"BU Hardware":[{"n":"Eliana  Dangond Pabon","w":157.2,"ot":0.0,"lv":19.0,"sk":0.0},{"n":"John Candelaria","w":132.2,"ot":0.0,"lv":43.8,"sk":0.0},{"n":"Keith Taylor","w":152.1,"ot":0.0,"lv":2.0,"sk":16.0},{"n":"Tercy Stewart","w":184.2,"ot":0.0,"lv":4.0,"sk":0.0},{"n":"Shannon Martha","w":179.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Archel Presentacion","w":157.2,"ot":0.0,"lv":24.8,"sk":0.0},{"n":"Christopher Bregita","w":0.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Gilbert Santiroma","w":146.2,"ot":0.0,"lv":14.5,"sk":0.0},{"n":"Javier Martis","w":133.5,"ot":0.0,"lv":43.8,"sk":0.0},{"n":"Jhonny Garves","w":100.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jowendrick Sillie","w":71.8,"ot":0.0,"lv":0.0,"sk":104.0},{"n":"Marciela Andrea","w":181.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Marlon Meyer","w":137.2,"ot":0.0,"lv":0.0,"sk":16.0},{"n":"Marshelon Janzen","w":116.5,"ot":0.0,"lv":69.2,"sk":0.0},{"n":"Minguel Goedgedrag","w":164.9,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Noah Frankenberger","w":172.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Noudimar Dorothea","w":73.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Raymi-Engelo Regina","w":45.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Rishantely Jantje","w":112.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shuwender Rosini","w":149.0,"ot":0.0,"lv":28.2,"sk":0.0},{"n":"Tyshawn  Angela","w":54.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Vai-Ona Martines","w":37.7,"ot":0.0,"lv":0.0,"sk":0.0}],"BU Living":[{"n":"Qiyazir Lake","w":28.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Armigilda Kopra","w":114.5,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Connelly  Lourens","w":170.4,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Dianni Colon","w":100.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Franklin Domatilia","w":151.7,"ot":0.0,"lv":1.0,"sk":16.0},{"n":"Hannah Perlaza","w":104.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jair Mattheeuw","w":31.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Laymine Zimmerman","w":186.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Mariejela Rosinda Victor","w":183.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Sidmarelly Henriquez","w":161.0,"ot":0.0,"lv":22.5,"sk":0.0},{"n":"Sus-Marianne Anastasia","w":175.5,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Tharinah Sophia","w":175.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Thysheliene Martiszoon","w":112.0,"ot":0.0,"lv":8.0,"sk":56.0},{"n":"Dianne Meyer - Walle","w":170.1,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Gijs Verkuijl","w":188.0,"ot":0.0,"lv":17.5,"sk":0.0},{"n":"Ingerson Carmela","w":183.3,"ot":0.0,"lv":1.0,"sk":0.0},{"n":"Nareelis Jakoba","w":161.2,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Roberto Badaracco","w":148.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Vianel Brazoban","w":176.8,"ot":0.0,"lv":0.0,"sk":0.0}],"BU Sanitair/Keuken":[{"n":"Enoc Merkies","w":168.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Henk Van Veen","w":188.1,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ivo Proveniers","w":174.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jamira Webster","w":175.3,"ot":0.0,"lv":1.0,"sk":0.0},{"n":"Vianaly Victor","w":157.2,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Michael Matroos","w":199.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Mireya Meyer Rojas","w":193.4,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Navin Ramdjas","w":144.9,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Steven Rogers","w":172.0,"ot":0.0,"lv":5.9,"sk":0.0}],"Smart Finance":[{"n":"Coralisa Windt De - Verstijnen","w":168.7,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Dienca  Arneman, Van","w":167.1,"ot":0.0,"lv":8.2,"sk":0.0},{"n":"Ivaira Windster","w":118.8,"ot":0.0,"lv":8.0,"sk":64.0},{"n":"Jacqueline  Schotborgh","w":176.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Judith Petronilia","w":187.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Karla Valencia - Angarita","w":0.0,"ot":0.0,"lv":168.0,"sk":0.0},{"n":"Lysandra Rafaela Becker","w":122.1,"ot":0.0,"lv":0.0,"sk":19.0},{"n":"Melivienne Legrand","w":119.4,"ot":0.0,"lv":48.0,"sk":0.0},{"n":"Sharesca Niebe","w":175.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Wilfried Ambrotius","w":147.9,"ot":0.0,"lv":28.0,"sk":0.0},{"n":"Yurriene Gonzalez","w":166.8,"ot":0.0,"lv":8.0,"sk":0.0}],"Logistiek":[{"n":"Adrianus Zijlstra","w":175.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ashneltrida Martis","w":175.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Eugene Antonio","w":143.8,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"John van den Berg","w":202.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Joubert Pieters","w":186.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Timothy Newton","w":118.5,"ot":0.0,"lv":1.5,"sk":0.0},{"n":"Xavier Werleman","w":128.5,"ot":0.0,"lv":0.0,"sk":48.0},{"n":"Germilson  Seintje","w":178.0,"ot":5.0,"lv":0.0,"sk":0.0},{"n":"Gilma Coco","w":175.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jurich Martina","w":120.0,"ot":0.0,"lv":16.0,"sk":40.0},{"n":"Marijke Antonia","w":176.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Railison Daal","w":16.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shairlyson  Sambo","w":164.0,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Curtney Cicilia","w":172.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Lativa  Pieters","w":166.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Ricardo Pierre","w":188.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Aldrin Vlijtig","w":174.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Benjamin Martijn","w":136.0,"ot":0.0,"lv":16.0,"sk":24.0},{"n":"Denzell Russel","w":103.7,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Naigelon  Clemensia","w":160.0,"ot":0.0,"lv":0.0,"sk":16.0},{"n":"Sandrey  Richardson","w":175.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ramsley Salome","w":192.7,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Robin Hooi","w":186.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shakur Bernadina","w":178.8,"ot":8.0,"lv":12.0,"sk":0.0},{"n":"Harvey  Raap","w":145.5,"ot":0.0,"lv":0.0,"sk":38.0},{"n":"Hensley Sambo","w":181.3,"ot":0.0,"lv":4.7,"sk":0.0},{"n":"Herbert Pisas","w":173.2,"ot":0.0,"lv":1.0,"sk":0.0},{"n":"Jurrandy Brandao","w":175.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Norwin Andrea","w":194.8,"ot":3.0,"lv":1.5,"sk":0.0},{"n":"Patrick Newton","w":158.2,"ot":2.0,"lv":41.0,"sk":0.0},{"n":"Reimy Ferero Abreu","w":134.9,"ot":0.0,"lv":16.0,"sk":16.0},{"n":"Roderick Paulina","w":162.1,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Rowendry Martina","w":165.7,"ot":0.0,"lv":0.0,"sk":12.0},{"n":"Sharimar Faneite","w":181.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Urlick Romsina","w":127.2,"ot":0.0,"lv":41.5,"sk":0.0}],"Store Support":[{"n":"Carlos De Franca","w":174.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Franciscus van Kessel","w":79.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Renaisha Wijngaarden","w":165.2,"ot":0.0,"lv":1.0,"sk":8.0},{"n":"Rochendry Doran","w":173.8,"ot":0.0,"lv":1.0,"sk":0.0},{"n":"Allan Pedro","w":176.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Franklin Quinones Echeverria","w":143.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jonathan de Wolff","w":167.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Omar Requena","w":147.2,"ot":0.0,"lv":8.0,"sk":16.0},{"n":"Agnette Pedro - Trotman","w":144.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Clifton Koeyers","w":133.2,"ot":0.0,"lv":0.0,"sk":40.0},{"n":"Dayanara Libinia","w":145.5,"ot":0.0,"lv":6.0,"sk":24.0},{"n":"Ignaldaly Garcia","w":167.0,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Merugia Cathalina-Martis","w":36.0,"ot":0.0,"lv":4.0,"sk":136.0},{"n":"Bobby Herder","w":104.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jundrick Jansen","w":48.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Liselotte Rojer","w":136.9,"ot":0.0,"lv":0.0,"sk":24.0},{"n":"Luigino Kauw-A-Tjoe","w":127.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Marlon Atmodimedjo","w":138.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Adriana Martes Reyes","w":174.0,"ot":0.0,"lv":2.0,"sk":0.0},{"n":"Jesseline Sebelon De Wind","w":154.8,"ot":0.0,"lv":20.0,"sk":0.0},{"n":"Rose Cenord Desrosiers","w":146.0,"ot":0.0,"lv":10.2,"sk":8.0},{"n":"Yeyson Marte Abreu","w":142.5,"ot":0.0,"lv":37.5,"sk":0.0},{"n":"Alvin D Silberie","w":201.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Chanarda Davis","w":189.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"David Waaldijk","w":180.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Eduard Carolina","w":153.6,"ot":0.0,"lv":33.0,"sk":0.0},{"n":"Giovanni Pinedo","w":214.6,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Handre Owens","w":184.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Orlando Reenis","w":181.1,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Sidney T. Molina","w":169.7,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Zuneida Alvarez","w":169.8,"ot":0.0,"lv":5.0,"sk":0.0},{"n":"Alberto Betrian","w":142.8,"ot":0.0,"lv":21.8,"sk":8.0},{"n":"Eldert Juliana","w":173.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jeandrelika Schoop","w":170.7,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Keisha Martina","w":174.2,"ot":0.0,"lv":0.0,"sk":3.2},{"n":"Ludwina Casser","w":175.4,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Luisana Chirino","w":163.9,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Philonairis Maria","w":168.8,"ot":0.0,"lv":8.0,"sk":8.0},{"n":"Shahira Roberto","w":148.0,"ot":0.0,"lv":22.0,"sk":16.0},{"n":"Brithney Garcia","w":164.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Brittany Haase","w":117.7,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Deborah Koeyers","w":184.8,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Dianira Scherptong","w":153.2,"ot":0.0,"lv":5.0,"sk":3.4},{"n":"Guadeloup Elisabeth","w":192.1,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Lyene  Daal","w":135.2,"ot":0.0,"lv":4.0,"sk":40.0},{"n":"Marielou  Alexander","w":176.3,"ot":0.0,"lv":3.0,"sk":0.0},{"n":"Nefertari Maduro","w":167.7,"ot":0.0,"lv":26.8,"sk":0.0},{"n":"Quisheena Maduro","w":116.2,"ot":0.0,"lv":5.0,"sk":0.0},{"n":"Richinella Obia","w":178.1,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Ruthsarai Gallardo","w":150.1,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Shellany Constansia","w":186.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Stephanie  Girigori","w":160.4,"ot":0.0,"lv":8.0,"sk":16.0}]},"apr-26":{"BU Appliance/Houseware":[{"n":"Daniel Louman","w":102.0,"ot":0.0,"lv":56.0,"sk":0.0},{"n":"Kevin Djotaroeno","w":131.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Michelangelo Lourens","w":143.9,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Rudelly Mauricia","w":132.5,"ot":0.0,"lv":27.0,"sk":0.0},{"n":"Christopher Bakmeijer","w":146.8,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Francisco Doran","w":164.2,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Michanu Isenia","w":183.3,"ot":4.0,"lv":2.0,"sk":0.0},{"n":"Nilo  Grotestam","w":162.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Ruthlyn Comenencia Martina","w":148.2,"ot":4.0,"lv":10.0,"sk":0.0},{"n":"Sheila Lacrum Wawoe","w":166.0,"ot":0.0,"lv":15.2,"sk":0.0},{"n":"Shelah Janga","w":179.0,"ot":0.0,"lv":10.0,"sk":0.0}],"BU Building Materials":[{"n":"Niasotis Dandare Ellis","w":144.2,"ot":0.0,"lv":17.5,"sk":0.0}],"BU Hardware":[{"n":"Rishantely Jantje","w":102.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Tyshawn  Angela","w":55.9,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Archel Presentacion","w":138.6,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Christopher Bregita","w":0.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Dejuan Brown","w":68.8,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Gilbert Santiroma","w":165.2,"ot":0.0,"lv":23.2,"sk":0.0},{"n":"Guishawn Wanga","w":69.5,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Javier Martis","w":108.6,"ot":0.0,"lv":9.0,"sk":24.0},{"n":"Jhonny Garves","w":46.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jowendrick Sillie","w":7.8,"ot":0.0,"lv":24.0,"sk":136.0},{"n":"Marciela Andrea","w":132.3,"ot":0.0,"lv":32.5,"sk":0.0},{"n":"Marlon Meyer","w":4.0,"ot":0.0,"lv":20.0,"sk":125.0},{"n":"Marshelon Janzen","w":138.4,"ot":0.0,"lv":25.0,"sk":0.0},{"n":"Minguel Goedgedrag","w":126.2,"ot":0.0,"lv":19.5,"sk":0.0},{"n":"Noah Frankenberger","w":84.0,"ot":0.0,"lv":65.5,"sk":0.0},{"n":"Noudimar Dorothea","w":62.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Raymi-Engelo Regina","w":14.3,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Rigchantely Da Costa Gomez","w":13.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Shannon Martha","w":174.8,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Shuwender Rosini","w":130.9,"ot":0.0,"lv":0.5,"sk":24.0},{"n":"Vai-Ona Martines","w":25.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Eliana  Dangond Pabon","w":145.7,"ot":0.0,"lv":28.8,"sk":0.0},{"n":"John Candelaria","w":150.1,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Keith Taylor","w":139.1,"ot":0.0,"lv":30.0,"sk":0.0},{"n":"Tercy Stewart","w":195.2,"ot":0.0,"lv":13.0,"sk":0.0}],"BU Living":[{"n":"Ingerson Carmela","w":161.5,"ot":0.0,"lv":3.0,"sk":0.0},{"n":"Dianne Meyer - Walle","w":141.8,"ot":0.0,"lv":29.2,"sk":0.0},{"n":"Gijs Verkuijl","w":34.0,"ot":0.0,"lv":141.0,"sk":0.0},{"n":"Nareelis Jakoba","w":127.5,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Roberto Badaracco","w":124.8,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Vianel Brazoban","w":160.2,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Armigilda Kopra","w":113.8,"ot":0.0,"lv":13.5,"sk":0.0},{"n":"Carina Tidu","w":174.5,"ot":0.0,"lv":3.5,"sk":0.0},{"n":"Connelly  Lourens","w":152.1,"ot":0.0,"lv":23.2,"sk":0.0},{"n":"Dianni Colon","w":91.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Franklin Domatilia","w":130.2,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Hannah Perlaza","w":120.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Jair Mattheeuw","w":38.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Laymine Zimmerman","w":149.0,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Mariejela Rosinda Victor","w":8.0,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Noemi-Eluzai Cijntje","w":78.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Qiyazir Lake","w":3.2,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Sidmarelly Henriquez","w":166.4,"ot":0.0,"lv":4.3,"sk":0.0},{"n":"Sus-Marianne Anastasia","w":158.2,"ot":0.0,"lv":9.5,"sk":4.5},{"n":"Tharinah Sophia","w":134.4,"ot":0.0,"lv":27.0,"sk":16.0},{"n":"Thysheliene Martiszoon","w":90.3,"ot":0.0,"lv":0.0,"sk":80.1}],"BU Sanitair/Keuken":[{"n":"Enoc Merkies","w":156.9,"ot":0.0,"lv":12.8,"sk":0.0},{"n":"Henk Van Veen","w":156.5,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Ivo Proveniers","w":152.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Jamira Webster","w":140.5,"ot":0.0,"lv":31.2,"sk":0.0},{"n":"Michael Matroos","w":165.6,"ot":0.0,"lv":11.5,"sk":0.0},{"n":"Mireya Meyer Rojas","w":168.7,"ot":0.0,"lv":12.8,"sk":0.0},{"n":"Navin Ramdjas","w":161.7,"ot":0.0,"lv":14.2,"sk":0.0},{"n":"Steven Rogers","w":159.8,"ot":0.0,"lv":21.2,"sk":0.0},{"n":"Vianaly Victor","w":157.5,"ot":0.0,"lv":26.8,"sk":0.0}],"Smart Finance":[{"n":"Coralisa Windt De - Verstijnen","w":84.9,"ot":0.0,"lv":85.0,"sk":0.0},{"n":"Dienca  Arneman, Van","w":111.0,"ot":0.0,"lv":64.0,"sk":0.0},{"n":"Ivaira Windster","w":144.1,"ot":0.0,"lv":37.0,"sk":0.0},{"n":"Jacqueline  Schotborgh","w":175.4,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Judith Petronilia","w":158.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Karla Valencia - Angarita","w":0.0,"ot":0.0,"lv":72.0,"sk":104.0},{"n":"Lysandra Rafaela Becker","w":102.5,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Melivienne Legrand","w":148.5,"ot":0.0,"lv":10.5,"sk":16.0},{"n":"Sharesca Niebe","w":124.4,"ot":0.0,"lv":49.0,"sk":0.0},{"n":"Wilfried Ambrotius","w":143.8,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Yurriene Gonzalez","w":141.4,"ot":0.0,"lv":33.0,"sk":0.0}],"Logistiek":[{"n":"Adrianus Zijlstra","w":134.5,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Ashneltrida Martis","w":153.5,"ot":0.0,"lv":22.5,"sk":0.0},{"n":"Eugene Antonio","w":171.5,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"John van den Berg","w":157.2,"ot":0.0,"lv":24.0,"sk":8.0},{"n":"Joubert Pieters","w":144.8,"ot":0.0,"lv":36.0,"sk":0.0},{"n":"Timothy Newton","w":153.8,"ot":0.0,"lv":22.0,"sk":0.0},{"n":"Xavier Werleman","w":144.2,"ot":0.0,"lv":32.2,"sk":8.0},{"n":"Germilson  Seintje","w":141.4,"ot":0.0,"lv":34.0,"sk":0.0},{"n":"Gilma Coco","w":115.8,"ot":0.0,"lv":36.0,"sk":24.0},{"n":"Jurich Martina","w":110.0,"ot":0.0,"lv":28.0,"sk":48.0},{"n":"Marijke Antonia","w":123.0,"ot":0.0,"lv":21.0,"sk":32.0},{"n":"Railison Daal","w":143.8,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Rujairo Ricao","w":156.8,"ot":0.0,"lv":22.0,"sk":0.0},{"n":"Shairlyson  Sambo","w":154.5,"ot":0.0,"lv":31.5,"sk":0.0},{"n":"Curtney Cicilia","w":123.0,"ot":0.0,"lv":44.0,"sk":0.0},{"n":"Lativa  Pieters","w":127.0,"ot":0.0,"lv":40.0,"sk":0.0},{"n":"Fabian Mom","w":0.0,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Aldrin Vlijtig","w":159.5,"ot":10.0,"lv":25.0,"sk":0.0},{"n":"Benjamin Martijn","w":161.9,"ot":6.0,"lv":18.0,"sk":0.0},{"n":"Denzell Russel","w":29.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Naigelon  Clemensia","w":152.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Ricardo Pierre","w":183.0,"ot":20.5,"lv":16.5,"sk":0.0},{"n":"Sandrey  Richardson","w":161.5,"ot":10.0,"lv":24.0,"sk":0.0},{"n":"Ramsley Salome","w":199.0,"ot":16.0,"lv":19.0,"sk":0.0},{"n":"Robin Hooi","w":186.8,"ot":4.8,"lv":9.0,"sk":0.0},{"n":"Shakur Bernadina","w":163.8,"ot":16.8,"lv":9.0,"sk":0.0},{"n":"Harvey  Raap","w":176.9,"ot":2.0,"lv":11.0,"sk":0.0},{"n":"Hensley Sambo","w":113.0,"ot":0.0,"lv":60.0,"sk":0.0},{"n":"Herbert Pisas","w":169.8,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Jurrandy Brandao","w":170.4,"ot":0.0,"lv":16.0,"sk":0.0},{"n":"Norwin Andrea","w":184.5,"ot":10.0,"lv":9.0,"sk":0.0},{"n":"Patrick Newton","w":158.4,"ot":4.0,"lv":22.0,"sk":0.0},{"n":"Reimy Ferero Abreu","w":128.0,"ot":0.0,"lv":8.0,"sk":32.0},{"n":"Roderick Paulina","w":99.2,"ot":0.0,"lv":35.4,"sk":8.0},{"n":"Rowendry Martina","w":153.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Sharimar Faneite","w":162.5,"ot":0.0,"lv":11.5,"sk":0.0},{"n":"Urlick Romsina","w":124.0,"ot":0.0,"lv":37.4,"sk":0.0}],"Store Support":[{"n":"Carlos De Franca","w":151.5,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Franciscus van Kessel","w":8.0,"ot":0.0,"lv":80.0,"sk":0.0},{"n":"Renaisha Wijngaarden","w":139.8,"ot":0.0,"lv":35.0,"sk":0.0},{"n":"Rochendry Doran","w":151.5,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Allan Pedro","w":136.0,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Jonathan de Wolff","w":85.2,"ot":0.0,"lv":88.0,"sk":0.0},{"n":"Omar Requena","w":140.2,"ot":0.0,"lv":26.0,"sk":0.0},{"n":"Agnette Pedro - Trotman","w":112.5,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Clifton Koeyers","w":61.2,"ot":0.0,"lv":26.0,"sk":44.0},{"n":"Dayanara Libinia","w":143.8,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Ignaldaly Garcia","w":165.5,"ot":0.0,"lv":15.5,"sk":0.0},{"n":"Merugia Cathalina-Martis","w":0.0,"ot":0.0,"lv":24.0,"sk":152.0},{"n":"Bobby Herder","w":77.0,"ot":0.0,"lv":36.0,"sk":0.0},{"n":"Jundrick Jansen","w":131.3,"ot":0.0,"lv":22.0,"sk":0.0},{"n":"Liselotte Rojer","w":122.3,"ot":9.5,"lv":13.8,"sk":0.0},{"n":"Luigino Kauw-A-Tjoe","w":72.6,"ot":0.0,"lv":50.0,"sk":0.0},{"n":"Marlon Atmodimedjo","w":103.3,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Adriana Martes Reyes","w":162.9,"ot":0.0,"lv":18.0,"sk":0.0},{"n":"Jesseline Sebelon De Wind","w":129.1,"ot":0.0,"lv":43.8,"sk":0.0},{"n":"Rose Cenord Desrosiers","w":156.7,"ot":0.0,"lv":19.0,"sk":0.0},{"n":"Yeyson Marte Abreu","w":154.3,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Alvin D Silberie","w":109.5,"ot":0.0,"lv":48.0,"sk":0.0},{"n":"Chanarda Davis","w":161.3,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"David Waaldijk","w":148.9,"ot":0.0,"lv":27.0,"sk":0.0},{"n":"Eduard Carolina","w":143.1,"ot":0.0,"lv":10.9,"sk":16.0},{"n":"Giovanni Pinedo","w":211.8,"ot":0.0,"lv":9.6,"sk":0.0},{"n":"Handre Owens","w":132.7,"ot":0.0,"lv":32.0,"sk":0.0},{"n":"Orlando Reenis","w":172.6,"ot":0.0,"lv":8.2,"sk":8.0},{"n":"Sidney T. Molina","w":175.0,"ot":0.0,"lv":9.0,"sk":0.0},{"n":"Wendell Finies","w":178.5,"ot":0.0,"lv":10.6,"sk":0.0},{"n":"Alberto Betrian","w":98.2,"ot":0.0,"lv":52.0,"sk":0.0},{"n":"Eldert Juliana","w":136.0,"ot":0.0,"lv":24.0,"sk":8.0},{"n":"Jeandrelika Schoop","w":136.9,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Keisha Martina","w":140.6,"ot":0.0,"lv":19.8,"sk":24.0},{"n":"Ludwina Casser","w":184.5,"ot":0.0,"lv":11.5,"sk":0.0},{"n":"Luisana Chirino","w":158.5,"ot":0.0,"lv":21.0,"sk":0.0},{"n":"Philonairis Maria","w":148.5,"ot":0.0,"lv":24.0,"sk":0.0},{"n":"Shahira Roberto","w":145.8,"ot":0.0,"lv":18.0,"sk":16.0},{"n":"Zuneida Alvarez","w":170.5,"ot":0.0,"lv":12.0,"sk":0.0},{"n":"Brithney Garcia","w":142.8,"ot":0.0,"lv":0.0,"sk":8.0},{"n":"Brittany Haase","w":112.6,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Deborah Koeyers","w":116.5,"ot":0.0,"lv":57.2,"sk":0.0},{"n":"Dianira Scherptong","w":22.5,"ot":0.0,"lv":153.2,"sk":0.0},{"n":"Guadeloup Elisabeth","w":194.3,"ot":0.0,"lv":1.2,"sk":0.0},{"n":"Lyene  Daal","w":130.8,"ot":0.0,"lv":10.0,"sk":32.0},{"n":"Marielou  Alexander","w":151.8,"ot":0.0,"lv":16.4,"sk":0.0},{"n":"Nefertari Maduro","w":147.0,"ot":0.0,"lv":19.0,"sk":0.0},{"n":"Quisheena Maduro","w":79.3,"ot":0.0,"lv":0.0,"sk":0.0},{"n":"Richinella Obia","w":124.2,"ot":0.0,"lv":41.2,"sk":0.0},{"n":"Ruthsarai Gallardo","w":172.1,"ot":0.0,"lv":8.0,"sk":0.0},{"n":"Shellany Constansia","w":151.1,"ot":0.0,"lv":10.0,"sk":0.0},{"n":"Stephanie  Girigori","w":138.1,"ot":0.0,"lv":33.4,"sk":0.0}]}};

const ACTUAL_MONTHS = ['jan-26', 'feb-26', 'mrt-26', 'apr-26'];
const MONTH_NUMBER = { 'jan-26': 1, 'feb-26': 2, 'mrt-26': 3, 'apr-26': 4 };
const ACTUAL_LAST_DATE = new Date(Date.UTC(2026, 3, 30)); // 30 apr 2026

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

// Check of een week in het verleden zit
function isPastWeek(year, week) {
  const monday = getMondayOfISOWeek(year, week);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return sunday < todayUTC;
}

// Check of we actuals hebben voor die week (jan-26 t/m apr-26 = navigatie bedoeld)
function hasActualsForWeek(year, week) {
  if (year !== 2026) return false;
  const monday = getMondayOfISOWeek(year, week);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  // Week moet (gedeeltelijk) in jan-apr 2026 vallen
  const startOfYear = new Date(Date.UTC(2026, 0, 1));
  return sunday >= startOfYear && monday <= ACTUAL_LAST_DATE;
}

// Bepaal welke maand-key (jan-26..apr-26) een week bij hoort (gebruik maand van de donderdag)
function monthKeyForWeek(year, week) {
  const monday = getMondayOfISOWeek(year, week);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const m = thursday.getUTCMonth(); // 0-11
  const names = ['jan-26','feb-26','mrt-26','apr-26','mei-26','jun-26','jul-26','aug-26','sep-26','okt-26','nov-26','dec-26'];
  return names[m];
}

// Tel werkdagen (ma-za, geen zondag) in een maand
function workdaysInMonth(year, month0) {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(Date.UTC(year, month0, d)).getUTCDay();
    if (dow !== 0) count++; // niet zondag
  }
  return count;
}

// Bereken gemiddelde werk-uren per week voor een medewerker over feb-apr 2026
function calcAvg3Months(empName, bu) {
  const months = ['feb-26', 'mrt-26', 'apr-26'];
  let totalWork = 0;
  let found = false;
  for (const m of months) {
    const emps = ACTUALS[m]?.[bu] || [];
    for (const e of emps) {
      if (namesMatch(e.n, empName)) {
        totalWork += e.w || 0;
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  // 3 maanden = ~13 weken
  return totalWork / 13;
}

// Match twee namen via voornaam + laatste woord
function namesMatch(a, b) {
  if (!a || !b) return false;
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const an = norm(a), bn = norm(b);
  if (an === bn) return true;
  const ap = an.split(' '), bp = bn.split(' ');
  if (ap[0] !== bp[0]) return false;
  return ap[ap.length - 1] === bp[bp.length - 1];
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
  const [emp3MStats, setEmp3MStats] = useState({}); // employee_name → {sick_pct, avg_work}

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
    load3MStats();
  }, [selectedBU, currentWeek]);

  // Laad 3-maandsstats per medewerker (ziek %, gem werkuren)
  // Pak laatste 13 weken actuals voor deze BU; agg per employee
  async function load3MStats() {
    const today = new Date();
    const isoNow = getISOWeek(today);
    // Bereken 13 weken eerder
    const wkStart = shiftWeek(isoNow.year, isoNow.week, -13);
    const { data, error } = await supabase
      .from('urenplanning_dyflexis')
      .select('employee_name, hours_worked, sick_total, total_hours, period_year, period_week')
      .eq('bu', selectedBU)
      .eq('is_actual', true)
      .or(`and(period_year.eq.${wkStart.year},period_week.gte.${wkStart.week}),and(period_year.gt.${wkStart.year})`);
    if (error || !data) { setEmp3MStats({}); return; }
    const stats = {};
    data.forEach(r => {
      const n = r.employee_name;
      if (!stats[n]) stats[n] = { work_sum: 0, sick_sum: 0, total_sum: 0, weeks: 0 };
      stats[n].work_sum += parseFloat(r.hours_worked) || 0;
      stats[n].sick_sum += parseFloat(r.sick_total) || 0;
      stats[n].total_sum += parseFloat(r.total_hours) || 0;
      stats[n].weeks++;
    });
    const out = {};
    Object.entries(stats).forEach(([n, s]) => {
      out[n] = {
        sick_pct: s.total_sum > 0 ? (s.sick_sum / s.total_sum * 100) : 0,
        avg_work: s.weeks > 0 ? (s.work_sum / s.weeks) : 0,
      };
    });
    setEmp3MStats(out);
  }

  async function loadData() {
    setDataLoading(true);
    const inPast = isPastWeek(currentWeek.year, currentWeek.week);
    // Voor verleden-weken: laad actuals (is_actual=true)
    // Voor toekomst-weken: laad planning (is_actual=false of null)
    const query = supabase
      .from('urenplanning_dyflexis')
      .select('*')
      .eq('bu', selectedBU)
      .eq('period_year', currentWeek.year)
      .eq('period_week', currentWeek.week);
    if (inPast) {
      query.eq('is_actual', true);
    } else {
      query.or('is_actual.is.null,is_actual.eq.false');
    }
    const { data, error } = await query;
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

  // Bepaal modus: planning (toekomst/huidig) of actuals (verleden)
  const inPast = isPastWeek(currentWeek.year, currentWeek.week);
  const isActualMode = inPast;

  // Aggregate per medewerker
  const baseEmployees = BU_EMPLOYEES[selectedBU] || [];
  const empMap = {};
  const openDays = {1:0,2:0,3:0,4:0,5:0,6:0,7:0};
  let openTotal = 0;
  let weekVerlofTotal = 0;
  let weekZiekTotal = 0;
  let weekTotalAll = 0;

  if (isActualMode) {
    // === ACTUAL-MODUS: gebruik echte week-data uit Supabase (is_actual=true) ===
    rows.forEach(r => {
      const n = r.employee_name;
      const match = matchEmployee(n, baseEmployees) || matchEmployee(n.replace(/\s+/g, ' '), baseEmployees);
      const stats3M = emp3MStats[n] || {};
      const hours_worked = parseFloat(r.hours_worked) || 0;
      const leave = parseFloat(r.leave_total) || 0;
      const sick = parseFloat(r.sick_total) || 0;
      const overtime = parseFloat(r.overtime_total) || 0;
      const total = parseFloat(r.total_hours) || 0;
      const sick_pct = parseFloat(r.sick_percentage) || 0;
      weekVerlofTotal += leave;
      weekZiekTotal += sick;
      weekTotalAll += total;
      empMap[n] = {
        dyflexis_name: n,
        display_name: n,
        contract: match ? match.contract : 'Onbekend',
        contract_hours: match ? match.contract_hours : null,
        sub: match ? match.sub : (r.sub_afdeling || ''),
        days: {1:0,2:0,3:0,4:0,5:0,6:0,7:0},
        total: hours_worked,
        overtime,
        leave,
        sick,
        sick_pct,
        total_hours: total,
        avg3: stats3M.avg_work || null,
        sick_3m: stats3M.sick_pct ?? null,
        matched: !!match,
      };
    });
  } else {
    // === PLANNING-MODUS: gebruik dyflexis-data uit Supabase ===
    rows.forEach(r => {
      if (r.is_open) return;
      const key = r.employee_name;
      if (!empMap[key]) {
        const match = matchEmployee(r.employee_name, baseEmployees);
        const stats3M = emp3MStats[r.employee_name] || {};
        empMap[key] = {
          dyflexis_name: r.employee_name,
          display_name: normalizeName(r.employee_name),
          contract: match ? match.contract : 'Onbekend',
          contract_hours: match ? match.contract_hours : null,
          sub: match ? match.sub : (r.sub_afdeling || ''),
          days: {1:0,2:0,3:0,4:0,5:0,6:0,7:0},
          total: 0,
          overtime: 0,
          leave: 0,
          sick: 0,
          sick_pct: 0,
          avg3: stats3M.avg_work || null,
          sick_3m: stats3M.sick_pct ?? null,
          matched: !!match,
        };
      }
      empMap[key].days[r.day_of_week] += parseFloat(r.netto_hours) || 0;
      empMap[key].total += parseFloat(r.netto_hours) || 0;
    });

    // Open dienst aggregate (alleen in planning-modus)
    rows.forEach(r => {
      if (!r.is_open) return;
      openDays[r.day_of_week] += parseFloat(r.netto_hours) || 0;
      openTotal += parseFloat(r.netto_hours) || 0;
    });
  }

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
          {isActualMode && <span style={{background:'#cce5ff', color:'#0056a3', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:4, marginLeft:6, verticalAlign:'middle', letterSpacing:'.4px', textTransform:'uppercase'}}>Werkelijk</span>}
        </h1>
        <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>
          {isActualMode 
            ? 'Werkelijke uren — week-actuals uit Dyflexis.'
            : 'Read-only weergave uit Dyflexis. Plannings-data wordt automatisch geïmporteerd (zie Admin → Dyflexis Import).'
          }
        </p>
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

      {/* Banner verleden-modus */}
      {isActualMode && (
        <div style={{marginBottom:14, padding:'12px 16px', background:'#cce5ff', border:'1.5px solid #0056a3', borderRadius:8, fontSize:12.5, color:'#003d73', lineHeight:1.5}}>
          <strong>Werkelijke uren — week-actuals uit Dyflexis.</strong> Geen dag-detail (Dyflexis levert week-totalen). Per medewerker zie je gewerkte uren, verlof, ziekte en overuren voor deze specifieke week.
        </div>
      )}

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
                <th style={{...headerStyle, textAlign:'center', width:60}}>Contract</th>
                <th style={{...headerStyle, textAlign:'right', width:70}}>Contract uren</th>
                <th style={{...headerStyle, textAlign:'right', width:75, color:'#6b6960'}} title="Gemiddelde werk-uren per week over laatste 13 weken">Gem 3 mnd</th>
                <th style={{...headerStyle, textAlign:'right', width:65, color:'#6b6960'}} title={isActualMode ? 'Ziekte % deze week' : 'Gemiddeld ziekte % laatste 13 weken'}>
                  Ziek %
                </th>
                {!isActualMode && NL_DAYS.map((d, i) => (
                  <th key={i} style={{...headerStyle, textAlign:'center', padding:'10px 6px', width:55}}>
                    {d}<br/><span style={{fontSize:9, color:'#9c978c', fontWeight:400}}>{dayDates[i].getUTCDate()}-{dayDates[i].getUTCMonth()+1}</span>
                  </th>
                ))}
                <th style={{...headerStyle, textAlign:'right', width:65}}>Wk tot.</th>
                <th style={{...headerStyle, textAlign:'center', padding:'10px 6px', color:'#6e3bb8', width:75}} title="Uren boven contracturen (Vast contract)">Overuren</th>
                {isActualMode && <th style={{...headerStyle, textAlign:'right', width:60, color:'#6b6960'}}>Verlof</th>}
                {isActualMode && <th style={{...headerStyle, textAlign:'right', width:60, color:'#a33225'}}>Ziek</th>}
              </tr>
            </thead>
            <tbody>
              {employeeList.map(emp => {
                const contractColor = emp.contract === 'Flexibel' ? {bg:'#ffe5d6', col:'#a33225'} : emp.contract === 'Vast' ? {bg:'#e0e7d4', col:'#3a5a2c'} : {bg:'#e8e8e8', col:'#666'};
                const showContract = emp.contract === 'Vast' && emp.contract_hours !== null;
                const overuren = (showContract && emp.total > emp.contract_hours) ? emp.total - emp.contract_hours : 0;

                // Bepaal te tonen ziek % (verleden = die week, toekomst = 3M gemiddelde)
                const sickPctShown = isActualMode ? (emp.sick_pct ?? 0) : (emp.sick_3m ?? null);
                // Kleurcodering ziek-cel (roodtinten)
                let sickCellBg = '', sickCellColor = '#6b6960';
                if (sickPctShown !== null && sickPctShown !== undefined) {
                  if (sickPctShown <= 1) { sickCellBg = ''; sickCellColor = '#3a5a2c'; }
                  else if (sickPctShown <= 5) { sickCellBg = 'rgba(255, 211, 84, 0.25)'; sickCellColor = '#856404'; }
                  else { sickCellBg = 'rgba(214, 59, 26, 0.18)'; sickCellColor = '#a33225'; }
                }

                // Kleurcodering overuren-cel (paarstinten)
                let overCellBg = '', overCellColor = '#6e3bb8';
                if (overuren > 0 && showContract) {
                  const pct = (emp.total - emp.contract_hours) / emp.contract_hours * 100;
                  if (pct <= 10) { overCellBg = 'rgba(178, 132, 219, 0.18)'; }
                  else { overCellBg = 'rgba(110, 59, 184, 0.22)'; overCellColor = '#4a1f8c'; }
                }

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
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#9c978c'}}>
                      {emp.avg3 !== null && emp.avg3 !== undefined ? emp.avg3.toFixed(1) : '-'}
                    </td>
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11, background: sickCellBg, color: sickCellColor, fontWeight: sickPctShown > 1 ? 600 : 400}}>
                      {sickPctShown !== null && sickPctShown !== undefined ? sickPctShown.toFixed(1) + '%' : '-'}
                    </td>
                    {!isActualMode && NL_DAYS.map((_, i) => {
                      const day = i + 1;
                      const h = emp.days[day];
                      return (
                        <td key={day} style={{padding:'8px 6px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color: h > 0 ? '#1a1a18' : '#d4d4d0'}}>
                          {h > 0 ? h.toFixed(1) : '-'}
                        </td>
                      );
                    })}
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, color: isActualMode ? '#0056a3' : '#1a1a18'}}>
                      {emp.total > 0 ? emp.total.toFixed(1) : '-'}
                    </td>
                    <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, fontWeight:600, background: overCellBg, color: overCellColor}}>
                      {overuren > 0 ? '+' + overuren.toFixed(1) : '-'}
                    </td>
                    {isActualMode && (
                      <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#6b6960'}}>
                        {emp.leave > 0 ? emp.leave.toFixed(1) : '-'}
                      </td>
                    )}
                    {isActualMode && (
                      <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11, color: emp.sick > 0 ? '#a33225' : '#9c978c', fontWeight: emp.sick > 0 ? 600 : 400}}>
                        {emp.sick > 0 ? emp.sick.toFixed(1) : '-'}
                      </td>
                    )}
                  </tr>
                );
              })}
              {/* Open dienst rij - alleen in planning-modus */}
              {!isActualMode && openTotal > 0 && (
                <tr style={{background:'#f5ebe0'}}>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:12.5, fontWeight:600, color:'#6b6960'}}>
                    OPEN DIENST <span style={{fontSize:10, fontWeight:500, marginLeft:6, color:'#a33225'}}>nog in te plannen</span>
                  </td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'center', color:'#9c978c'}}>—</td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', color:'#9c978c'}}>—</td>
                  <td style={{padding:'10px', borderBottom:'1px solid rgba(0,0,0,0.08)', textAlign:'right', color:'#9c978c'}}>—</td>
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
                <td colSpan={isActualMode ? 5 : 5} style={{padding:'10px', fontWeight:700, fontSize:12}}>TOTAAL</td>
                {!isActualMode && dayTotals.map((t, i) => (
                  <td key={i} style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{t > 0 ? t.toFixed(1) : '-'}</td>
                ))}
                <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{weekGrandTotal.toFixed(1)}</td>
                <td style={{padding:'10px', textAlign:'center', fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:'#c8a8e9'}}>{overurenTotal > 0 ? '+' + overurenTotal.toFixed(1) : '-'}</td>
                {isActualMode && <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{weekVerlofTotal > 0 ? weekVerlofTotal.toFixed(1) : '-'}</td>}
                {isActualMode && <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:'#ff8a6c'}}>{weekZiekTotal > 0 ? weekZiekTotal.toFixed(1) : '-'}</td>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te lezen:</strong> Voor huidige/toekomstige weken (planning): geplande netto uren per dag uit Dyflexis Roosters. Voor weken in het verleden (actuals): werkelijk gewerkte uren per medewerker uit Dyflexis weekrapport. <strong>Gem 3 mnd</strong> = gem werk-uren per week (laatste 13 weken). <strong>Ziek %</strong> = die week (verleden) of 13-weeks gemiddelde (toekomst); ≤1% groen, 1-5% geel, &gt;5% rood. <strong>Overuren</strong> = uren boven contracturen (Vast contract), paars gekleurd.
      </div>
    </div>
  );
}
