/* ============================================================
   BESTAND: route_email_v26.js
   KOPIEER NAAR: src/app/api/email-upload/route.js

   WIJZIGING v26:
   - Nieuw file type 'invoice_ledger' toegevoegd voor het Compass-rapport
     "AI Open and Paid Items last 12M" dat per mail binnenkomt.
     Kwam eerder binnen als 'unknown' → HTTP 400 → niet verwerkt.
     Kolommen: Vendor Code, Vendor Name, Date, Measure, Value,
     Invoice Number Header, Fully Paid, Balance, Fully Paid Date,
     PO Header, PO Create Date, PO Number, Account Number, Voucher Number
   - Detectie + parselogica staan in src/lib/ledgerImport.js
     (vervangt de handmatige uploadpagina finance/ledger-upload).
   - detectFileType() accepteert nu ook filename, zodat naam-detectie
     ("open and paid") vóór kolom-detectie kan gaan.
   - Vereist SQL: kolom invoice_ledger.first_seen_at + tabel ledger_load_log.

   CRITICAL BUGFIX v25:
   - Vercel Serverless Functions hebben 4.5MB body limit.
     De Cloudflare Email Worker stuurde base64-encoded attachments
     direct in JSON body. Voor grote emails (5MB+, na base64 +33%)
     → HTTP 413 FUNCTION_PAYLOAD_TOO_LARGE, upload gefaald.
     Gevolg: alle grote Compass exports (Daniel/Gijs/John CUR/BON)
     kwamen sinds 8 juli niet meer binnen.
   
   - Fix: nieuwe Cloudflare Worker v2 uploadt attachments naar
     Supabase Storage bucket 'email-attachments' en stuurt alleen
     de storage_path naar deze endpoint (kleine JSON body).
     Deze endpoint downloadt uit Storage en verwerkt normaal.
   
   - BACKWARD COMPATIBLE: als request body 'data' bevat (oude Worker
     of directe forward), blijft de legacy inline base64 path werken.
   
   - Vereist bucket 'email-attachments' (private) in Supabase Storage.

   WIJZIGING v24:
   - Compass exports voor Daniel, John, Gijs (nieuw naamgevingsformaat
     "AI Voorraden <Naam> <REGIO>") werden niet herkend als buying_data
     omdat ze geen "Department Group" kolom hebben.
     Gevolg: sinds ~mei 2026 alleen Henk en Pascal (Ivo) worden ververst;
     Daniel/John/Gijs data was verouderd.
   - Fix 1: detectFileType herkent nu ook buying files zonder "Department
     Group" (alternatieve signatuur: Store Group + Sales Units + Item Number
     + Quantity on Hand + geen "now"/"month" kolom)
   - Fix 2: processBuying accepteert nu filename en leidt BUM daaruit af
     als "Department Group" kolom ontbreekt.
     Mapping: pascal/ivo → PASCAL, henk → HENK, john → JOHN,
              daniel → DANIEL, gijs → GIJS

   WIJZIGING v23:
   - processBuying leest nu de kolom "MFG Part #" en slaat op
     in nieuwe buying_data.mfg_part_number kolom
   - SQL vereist (vooraf draaien):
       ALTER TABLE buying_data ADD COLUMN mfg_part_number text;
   - Detectie tolerant voor varianten: "MFG Part #", "MFG#",
     "Manufacturer Part", etc.
   - BUGFIX processPoDeliveries: dateKey pattern matchte per ongeluk
     op de "PO Detail" kolom omdat 'eta' substring is van 'detail'.
     Pattern 'eta' verwijderd; alleen specifieke patterns als
     'date expected' / 'expected date' / 'eta date' worden geaccepteerd.
     Gevolg eerder: PO-nummer (bv. 17381) werd als jaartal opgeslagen
     (date_expected = 17381-01-01) → "1/1" in UI.
   - Extra: jaar-sanity-check 2020-2035 in processPoDeliveries.
     Rijen met out-of-range jaar worden geskipt + gelogd.
   WIJZIGING v22:
   - processNosSnapshot schrijft naast nos_coverage_snapshots óók
     naar nieuwe tabel nos_coverage_snapshots_dept (per dept_code)
   - Vereist nieuwe Supabase tabel (SQL elders aangeleverd)
   - buying_data SELECT uitgebreid met dept_code, dept_name
   - Per (bum, region, dept_code) wordt in/refilling/uncovered geteld
   - Ook 'Total' rij per (bum, dept_code) als rollup CUR+BON
   WIJZIGING v21:
   - Nieuw file type 'po_deliveries' toegevoegd
     * Detectie via kolommen: PO Detail + Item Number + Date Expected
     * processPoDeliveries: TRUNCATE + INSERT in chunks van 1000
     * Vult tabel po_deliveries (gebruikt door Stock Risk Alert)
   - po_deliveries detectie staat VOOR negative_inventory en
     price_changes om early-match te voorkomen
   WIJZIGING v20:
   - BUGFIX: 6 plekken in de code gebruikten nog 'supabase' (zonder
     getSupabase()) terwijl v19 die globale variabele had verwijderd.
     Gevolg: processInventory crashte met "ReferenceError: supabase
     is not defined" sinds 11 mei → geen nieuwe inventory data meer.
     Ook processNegativeInventory (first_seen reads + upsert + snapshot
     delete) en processNosSnapshot waren stiekem stuk.
   - Alle bare 'supabase' calls vervangen door getSupabase().
   WIJZIGING v19:
   - Build fix: Supabase client wordt nu lazy gemaakt via getSupabase()
     ipv top-level. Voorkomt 'supabaseKey is required' error tijdens
     Vercel build die optreedt na het sensitive markeren van env vars.
   - dynamic = 'force-dynamic' en runtime = 'nodejs' toegevoegd
   - Functionaliteit identiek aan v18.
   WIJZIGING v18:
   - Nieuwe file type 'price_changes' toegevoegd:
     * Detectie via 'Date Of Last Sale' kolom (uniek voor deze file)
     * processPriceChanges schrijft naar price_snapshots tabel
     * Gebruikt vandaag als snapshot_date
     * Delete-then-insert per (regio × snapshot_date)
   WIJZIGING v17:
   - processBuying schrijft 'regio' kolom (CUR/BON) i.p.v. mapping naar store_number
   WIJZIGING v10:
   - processInventory filtert nu lege rijen en 'GRAND SUMMARIES' weg
   - Niet-numerieke dept codes (FA/FC/FE/FF/XX) samengevoegd tot 'OTHER'
   WIJZIGING v9:
   - processInventory gebruikt nu weer NOW kolom als "vandaag"
   WIJZIGING v7:
   - processBuying roept nu processNosSnapshot aan na succesvolle insert
   - Nieuwe functie processNosSnapshot: schrijft per (BUM × regio × datum)
     hoeveel NOS items in_stock / refilling / uncovered zijn naar
     nos_coverage_snapshots tabel (voor trendgrafiek Stock Risk Alert)
   WIJZIGING v6:
   - processNegativeInventory schrijft nu naar de ECHTE kolomnamen
     van negative_inventory: qty_on_hand, inv_value (i.p.v. qoh/cost)
   - Vult ook class_code, class_name, store_short_name,
     avg_cost_per_unit, report_date
   - Oorzaak bug: alle inserts faalden silently omdat kolomnamen
     niet matchten → tabel bleef leeg → Detail-tab leeg
   WIJZIGING v5:
   - processNegativeInventory schrijft nu ook BUM (Department Group) weg
   - Upsert naar negative_inventory_first_seen tabel
   WIJZIGING v4:
   - detectFileType herkent nu "Quantity on Hand"
   - Niet-numerieke dept codes samenvoegen tot 'OTHER'
   ============================================================ */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { isInvoiceLedgerFile, processInvoiceLedger } from '@/lib/ledgerImport';

// Service role for deletes (RLS bypass)
// Lazy initialization: create client only when needed (not at module load)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _supabase;
}

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* ── Helper: find column by partial name match ── */
function findCol(keys, patterns) {
  return keys.find(function(k) {
    var kl = k.toLowerCase();
    return patterns.some(function(p) { return kl.includes(p); });
  });
}

/* ── Detect file type based on column headers ── */
function detectFileType(columns, filename) {
  var cols = columns.map(function(c) { return c.toLowerCase(); });

  // v26: AP invoice ledger ("AI Open and Paid Items last 12M").
  // Staat bovenaan: dit bestand heeft geen Item Number / Store Group /
  // Net Sales, dus er is geen overlap met de types hieronder.
  if (isInvoiceLedgerFile(columns, filename)) {
    return 'invoice_ledger';
  }

  // Inventory file: has "Store Group" + "Department Code" + "Budget" + "NOW"
  if (cols.some(function(c) { return c.includes('store group'); }) &&
      cols.some(function(c) { return c.includes('department code'); }) &&
      cols.some(function(c) { return c === 'now' || c.includes('month'); })) {
    return 'inventory';
  }

  // Buying data: has "Item Number" + "Quantity on Hand" + "Sales Units" + "Department Group"
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('sales units'); }) &&
      cols.some(function(c) { return c.includes('department group'); })) {
    return 'buying';
  }

  // Alt buying data (nieuwere "AI Voorraden" exports, sinds ~mei 2026):
  // heeft geen "Department Group" kolom meer, maar wel dezelfde structuur.
  // Signatuur: Item Number + Quantity on Hand + Sales Units + Store Group (i.p.v. Department Group)
  // BUM moet dan uit filename komen (gebeurt in processBuying).
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('sales units'); }) &&
      cols.some(function(c) { return c.includes('store group'); }) &&
      !cols.some(function(c) { return c === 'now' || c.includes('month'); })) {
    return 'buying';
  }

  // PO Deliveries: has "PO Detail" + "Item Number" + "Date Expected" + "QOO Rounded Quantity"
  // Moet voor negative_inventory en price_changes worden geprobeerd om early match te voorkomen
  if (cols.some(function(c) { return c.includes('po detail') || c.includes('po number'); }) &&
      cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('date expected') || c.includes('eta'); })) {
    return 'po_deliveries';
  }

  // Price changes: has "Item Number" + "Quantity on Hand" + "Store Group" + "Date Of Last Sale"
  // Moet voor negative_inventory worden geprobeerd want anders matcht dat eerst
  if (cols.some(function(c) { return c.includes('item number'); }) &&
      cols.some(function(c) { return c.includes('quantity on hand'); }) &&
      cols.some(function(c) { return c.includes('store group'); }) &&
      cols.some(function(c) { return c.includes('date of last sale') || c.includes('last sale'); })) {
    return 'price_changes';
  }

  // Negative inventory: has "Item Number" + "Quantity on Hand" + "Inventory Value"
  // (distinguishable from buying by absence of 'sales units')
  if (cols.some(function(c) { return c.includes('item number'); }) &&