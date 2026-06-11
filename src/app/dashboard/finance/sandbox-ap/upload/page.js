/* ============================================================
   BESTAND: sandbox_ap_upload_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/upload/page.js
   (overschrijft v2, hernoemen naar page.js bij upload)

   WIJZIGINGEN T.O.V. v2:
   - PROJECT CLEAN UP integratie: bij elke upload worden confirmed
     match candidates van invoices die uit de CSV verdwijnen
     automatisch op status='processed' gezet. AP clerks hoeven
     niets meer handmatig te markeren — als ze in Eagle hebben
     afgeletterd, ziet de portal dat bij de volgende upload.

   - Detecteert nu Eagle-sync van auto_matched facturen:
     als een voucher in status='auto_matched' niet meer in de
     nieuwe Compass-export staat, betekent dat Eagle de aflettering
     heeft verwerkt. Status wordt 'paid' met audit 'eagle_synced'.
   - Nieuwe stat-card in review: Eagle-synced

   Data Upload pagina voor AP:
   - Compass/Eagle CSV inlezen
   - Parsen met Type-anker fix voor duizend-separator bug
   - Vergelijken met DB: nieuwe / bestaande / verdwenen / eagle-synced
   - Auto-toewijzing AP Clerk via vendor → BUM
   - Nieuwe vendors automatisch toevoegen aan sandbox_ap_vendors
   - Bevestig → uitvoering + audit logging
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../layout';
import Link from 'next/link';

// =====================================================================
// COMPASS CSV PARSER (port van standalone HTML v1)
// =====================================================================
const TYPE_ANCHORS = new Set(['REGULAR TRX', 'CREDIT MEMO', 'DEBIT MEMO']);
const TYPE_COL_INDEX = 13;
const EXPECTED_COL_COUNT = 28;

async function fetchAllPaginated(queryBuilder, batchSize = 1000) {
  let allRows = [];
  let from = 0;
  while (true) {
    const q = queryBuilder().range(from, from + batchSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { fields.push(current); current = ''; }
      else current += c;
    }
  }
  fields.push(current);
  return fields;
}

function findTypeIndex(fields) {
  for (let i = 0; i < fields.length; i++) {
    if (TYPE_ANCHORS.has(fields[i])) return i;
  }
  return -1;
}

function parseDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = m[1].padStart(2, '0');
  const day = m[2].padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

function parseCompassCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return { rows: [], warnings: ['Bestand bevat geen data-regels'], stats: {} };
  }

  const rows = [];
  const warnings = [];
  let shiftFixCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawFields = parseCSVLine(lines[i]);
    if (rawFields.length < 14) {
      warnings.push(`Regel ${i + 1}: te weinig velden (${rawFields.length}) — overgeslagen`);
      continue;
    }

    const typeIdx = findTypeIndex(rawFields);
    if (typeIdx === -1) {
      warnings.push(`Regel ${i + 1}: geen Type-anker gevonden — overgeslagen`);
      continue;
    }

    const shift = typeIdx - TYPE_COL_INDEX;
    let row;
    if (shift > 0) {
      const balance = rawFields.slice(0, shift + 1).join(',');
      row = [balance, ...rawFields.slice(shift + 1)];
      shiftFixCount++;
    } else if (shift < 0) {
      warnings.push(`Regel ${i + 1}: Type op onverwachte positie — overgeslagen`);
      continue;
    } else {
      row = rawFields.slice();
    }
    while (row.length < EXPECTED_COL_COUNT) row.push('');

    const vendorIdStr = String(row[7] || '').trim();
    const vendorId = parseInt(vendorIdStr, 10);
    if (!Number.isFinite(vendorId)) {
      warnings.push(`Regel ${i + 1}: ongeldig vendor_id '${vendorIdStr}' — overgeslagen`);
      continue;
    }

    const invoiceNumber = String(row[1] || '').trim();
    if (!invoiceNumber) {
      warnings.push(`Regel ${i + 1}: leeg factuurnummer — overgeslagen`);
      continue;
    }

    const balanceStr = String(row[0] || '').replace(/,/g, '');
    const balance = parseFloat(balanceStr);
    if (!Number.isFinite(balance)) {
      warnings.push(`Regel ${i + 1}: ongeldige balance — overgeslagen`);
      continue;
    }

    const originalAmtStr = String(row[8] || '').replace(/,/g, '');

    rows.push({
      vendor_id: vendorId,
      vendor_name: String(row[6] || '').trim(),
      invoice_number: invoiceNumber,
      invoice_date: parseDate(row[2]),
      due_date: parseDate(row[10]),
      balance: balance,
      original_amount: parseFloat(originalAmtStr) || balance,
      currency: String(row[22] || '').trim() || 'XCG',
      reference: String(row[3] || '').trim(),
      po_number: String(row[4] || '').trim(),
      voucher: String(row[9] || '').trim(),
      type: String(row[13] || '').trim(),
      ap_account: String(row[14] || '').trim(),
      bank_code: String(row[25] || '').trim(),
    });
  }

  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const typeCount = {};
  for (const r of rows) typeCount[r.type] = (typeCount[r.type] || 0) + 1;

  return {
    rows,
    warnings,
    stats: {
      total_parsed: rows.length,
      total_balance: totalBalance,
      type_count: typeCount,
      shift_fix_count: shiftFixCount,
      unique_vendors: new Set(rows.map(r => r.vendor_id)).size,
    }
  };
}

// =====================================================================
// DIFF ENGINE
// =====================================================================
async function computeDiff(supabase, parsedInvoices) {
  // Voucher is Eagle's natuurlijke unieke key
  // Haal alle actieve én auto_matched rijen op (auto_matched moet ook gechecked
  // worden of Eagle ze inmiddels heeft afgewerkt)
  const { data: existing, error } = await supabase
    .from('sandbox_ap_invoices')
    .select('id, vendor_id, invoice_number, voucher, balance, status, assigned_ap_clerk')
    .not('status', 'in', '(paid,disappeared_from_export)');
  if (error) throw new Error(`Kan bestaande facturen niet laden: ${error.message}`);

  // Splitsen: actieve werkstroom-rijen vs auto_matched rijen
  const activeRows = existing.filter(r => r.status !== 'auto_matched');
  const autoMatchedRows = existing.filter(r => r.status === 'auto_matched');

  // Map op voucher voor actieve rijen
  const existingMap = new Map();
  for (const inv of activeRows) {
    if (inv.voucher) existingMap.set(inv.voucher, inv);
  }
  const parsedVouchers = new Set(parsedInvoices.map(p => p.voucher).filter(v => v));

  const newInvoices = [];
  const updatedInvoices = [];
  const unchanged = [];
  const skipped = [];

  for (const p of parsedInvoices) {
    if (!p.voucher) {
      skipped.push(p);
      continue;
    }
    const ex = existingMap.get(p.voucher);
    if (!ex) {
      newInvoices.push(p);
    } else {
      if (Math.abs(parseFloat(ex.balance) - p.balance) > 0.001) {
        updatedInvoices.push({ ...p, existing_id: ex.id, old_balance: parseFloat(ex.balance) });
      } else {
        unchanged.push({ ...p, existing_id: ex.id });
      }
    }
  }

  // Eagle-synced: auto_matched rijen die niet meer in CSV staan
  // = Eagle heeft de aflettering ook doorgevoerd → status wordt 'paid'
  const eagleSyncedInvoices = autoMatchedRows.filter(inv =>
    inv.voucher && !parsedVouchers.has(inv.voucher)
  );

  // Disappeared: actieve rijen in DB maar niet in nieuwe CSV
  // (auto_matched rijen vallen hier expliciet NIET onder)
  const disappearedInvoices = activeRows.filter(inv =>
    inv.voucher && !parsedVouchers.has(inv.voucher)
  );

  const { data: vendors, error: vErr } = await supabase
    .from('sandbox_ap_vendors')
    .select('vendor_id, vendor_name, assigned_bum');
  if (vErr) throw new Error(`Kan vendor master niet laden: ${vErr.message}`);

  const knownVendorIds = new Set(vendors.map(v => v.vendor_id));

  const newVendors = [];
  const seenNew = new Set();
  for (const p of parsedInvoices) {
    if (!knownVendorIds.has(p.vendor_id) && !seenNew.has(p.vendor_id)) {
      seenNew.add(p.vendor_id);
      newVendors.push({ vendor_id: p.vendor_id, vendor_name: p.vendor_name });
    }
  }

  // === PROJECT CLEAN UP: confirmed match candidates die uit CSV verdwijnen ===
  // Haal alle confirmed candidates op (klein aantal, ~100en)
  const confirmedCandidates = await fetchAllPaginated(() =>
    supabase.from('sandbox_ap_match_candidates')
      .select('id, invoice_id')
      .eq('status', 'confirmed')
  );

  // Voor ELKE confirmed candidate: check of bijbehorende invoice uit CSV verdwenen is.
  // De invoice kan al op 'paid' status staan (na confirm), of nog niet.
  // We hebben hun voucher nodig — extra fetch om die te krijgen.
  let processedCandidates = [];
  if (confirmedCandidates.length > 0) {
    const invIds = [...new Set(confirmedCandidates.map(c => c.invoice_id))];
    // Haal voucher op voor deze invoices
    const invsForCandidates = await fetchAllPaginated(() =>
      supabase.from('sandbox_ap_invoices')
        .select('id, voucher')
        .in('id', invIds.slice(0, 1000))  // safety limit
    );
    const voucherByInv = {};
    for (const inv of invsForCandidates) voucherByInv[inv.id] = inv.voucher;

    // Filter candidates wiens invoice voucher NIET in nieuwe CSV staat
    processedCandidates = confirmedCandidates.filter(c => {
      const voucher = voucherByInv[c.invoice_id];
      return voucher && !parsedVouchers.has(voucher);
    });
  }

  return { newInvoices, updatedInvoices, unchanged, disappearedInvoices, newVendors, skipped, eagleSyncedInvoices, processedCandidates };
}

// =====================================================================
// IMPORTER
// =====================================================================
async function executeImport(supabase, parsedInvoices, diff, currentUser, filename) {
  const errors = [];

  if (diff.newVendors.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = diff.newVendors.map(v => ({
      vendor_id: v.vendor_id,
      vendor_name: v.vendor_name,
      notes: `Auto-geïmporteerd ${today} uit ${filename}`,
    }));
    const { error } = await supabase.from('sandbox_ap_vendors').insert(rows);
    if (error) errors.push(`Vendor insert: ${error.message}`);
  }

  const { data: vendors } = await supabase.from('sandbox_ap_vendors').select('vendor_id, assigned_bum');
  const vendorBumMap = new Map(vendors.map(v => [v.vendor_id, v.assigned_bum]));

  const { data: clerks } = await supabase
    .from('profiles')
    .select('id, full_name, ap_assigned_bums')
    .eq('role', 'ap_clerk');
  const bumToClerk = new Map();
  for (const c of (clerks || [])) {
    for (const bum of (c.ap_assigned_bums || [])) {
      bumToClerk.set(bum, c.id);
    }
  }

  const { data: uploadRow, error: uploadErr } = await supabase
    .from('ap_uploads')
    .insert({
      filename,
      uploaded_by: currentUser.id,
      uploaded_by_name: currentUser.full_name,
      stats: {
        total_parsed: parsedInvoices.length,
        new_count: diff.newInvoices.length,
        updated_count: diff.updatedInvoices.length,
        unchanged_count: diff.unchanged.length,
        disappeared_count: diff.disappearedInvoices.length,
        new_vendors_count: diff.newVendors.length,
        eagle_synced_count: (diff.eagleSyncedInvoices || []).length,
      },
    })
    .select()
    .single();
  if (uploadErr) {
    errors.push(`Upload log: ${uploadErr.message}`);
    return { uploadRow: null, errors };
  }

  if (diff.newInvoices.length > 0) {
    const newRows = diff.newInvoices.map(p => {
      const bum = vendorBumMap.get(p.vendor_id);
      const clerkId = bum ? bumToClerk.get(bum) : null;
      return {
        vendor_id: p.vendor_id,
        invoice_number: p.invoice_number,
        vendor_name: p.vendor_name,
        balance: p.balance,
        original_amount: p.original_amount,
        currency: p.currency,
        invoice_date: p.invoice_date,
        due_date: p.due_date,
        voucher: p.voucher,
        reference: p.reference,
        po_number: p.po_number,
        type: p.type,
        ap_account: p.ap_account,
        bank_code: p.bank_code,
        status: 'open',
        assigned_ap_clerk: clerkId || null,
        upload_id: uploadRow.id,
        last_status_change: new Date().toISOString(),
        last_status_change_by: currentUser.id,
      };
    });
    const BATCH = 500;
    for (let i = 0; i < newRows.length; i += BATCH) {
      const batch = newRows.slice(i, i + BATCH);
      const { error } = await supabase.from('sandbox_ap_invoices').insert(batch);
      if (error) errors.push(`Invoice insert batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    }
  }

  for (const u of diff.updatedInvoices) {
    const { error } = await supabase
      .from('sandbox_ap_invoices')
      .update({ balance: u.balance, upload_id: uploadRow.id })
      .eq('id', u.existing_id);
    if (error) errors.push(`Update factuur ${u.invoice_number}: ${error.message}`);
  }

  if (diff.disappearedInvoices.length > 0) {
    const ids = diff.disappearedInvoices.map(d => d.id);
    const { error } = await supabase
      .from('sandbox_ap_invoices')
      .update({
        status: 'disappeared_from_export',
        disappeared_at: new Date().toISOString(),
      })
      .in('id', ids);
    if (error) errors.push(`Disappeared update: ${error.message}`);
  }

  // Eagle-synced: auto_matched rijen die nu uit Eagle weg zijn → status 'paid'
  if (diff.eagleSyncedInvoices && diff.eagleSyncedInvoices.length > 0) {
    const ids = diff.eagleSyncedInvoices.map(d => d.id);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('sandbox_ap_invoices')
      .update({
        status: 'paid',
        paid_at: now,
        last_status_change: now,
        last_status_change_by: currentUser.id,
      })
      .in('id', ids);
    if (error) errors.push(`Eagle-sync update: ${error.message}`);

    // Audit log per Eagle-synced rij
    const auditRows = diff.eagleSyncedInvoices.map(inv => ({
      action: 'eagle_synced',
      entity_type: 'invoice',
      entity_id: inv.id,
      user_id: currentUser.id,
      user_name: currentUser.full_name,
      user_role: currentUser.role,
      details: {
        voucher: inv.voucher,
        previous_status: 'auto_matched',
        new_status: 'paid',
        detected_via_upload: filename,
      },
    }));
    if (auditRows.length > 0) {
      await supabase.from('sandbox_ap_audit_log').insert(auditRows);
    }
  }

  // === PROJECT CLEAN UP: mark candidates as processed ===
  if (diff.processedCandidates && diff.processedCandidates.length > 0) {
    const candIds = diff.processedCandidates.map(c => c.id);
    const now2 = new Date().toISOString();
    const { error: pErr } = await supabase
      .from('sandbox_ap_match_candidates')
      .update({
        status: 'processed',
        processed_at: now2,
        processed_by: currentUser.id,
      })
      .in('id', candIds);
    if (pErr) errors.push(`Mark candidates processed: ${pErr.message}`);

    // Audit log per processed candidate
    const auditCands = diff.processedCandidates.map(c => ({
      action: 'match_auto_processed',
      entity_type: 'invoice',
      entity_id: c.invoice_id,
      user_id: currentUser.id,
      user_name: currentUser.full_name,
      user_role: currentUser.role,
      details: {
        candidate_id: c.id,
        previous_status: 'confirmed',
        new_status: 'processed',
        detected_via_upload: filename,
        note: 'Factuur verdwenen uit Compass CSV — AP clerk heeft Eagle-boeking voltooid',
      },
    }));
    if (auditCands.length > 0) {
      await supabase.from('sandbox_ap_audit_log').insert(auditCands);
    }
  }

  await supabase.from('sandbox_ap_audit_log').insert({
    action: 'upload_completed',
    entity_type: 'upload',
    entity_id: uploadRow.id,
    user_id: currentUser.id,
    user_name: currentUser.full_name,
    user_role: currentUser.role,
    details: {
      filename,
      new_invoices: diff.newInvoices.length,
      updated_invoices: diff.updatedInvoices.length,
      disappeared_invoices: diff.disappearedInvoices.length,
      new_vendors: diff.newVendors.length,
      processed_candidates: (diff.processedCandidates || []).length,
      eagle_synced: (diff.eagleSyncedInvoices || []).length,
    },
  });

  return { uploadRow, errors };
}

// =====================================================================
// UI HELPERS
// =====================================================================
function fmtMoney(amount) {
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}
function fmtNumber(n) {
  return new Intl.NumberFormat('nl-NL').format(n);
}

// =====================================================================
// PAGE COMPONENT
// =====================================================================
export default function UploadPage() {
  const { actualProfile, effectiveRole, isPlayingRole } = useApRole();
  const supabase = createClient();

  const currentUser = actualProfile;
  const canUpload = ['admin', 'cfo', 'ap_clerk'].includes(effectiveRole);

  const [stage, setStage] = useState('idle');
  const [filename, setFilename] = useState('');
  const [parsed, setParsed] = useState(null);
  const [diff, setDiff] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError(`Bestand moet een .csv zijn (geüpload: ${file.name})`);
      return;
    }
    setError(null);
    setFilename(file.name);
    setStage('parsing');

    try {
      const text = await file.text();
      const parsedResult = parseCompassCSV(text);
      if (parsedResult.rows.length === 0) {
        throw new Error('Geen geldige facturen gevonden in dit bestand');
      }
      setParsed(parsedResult);

      const diffResult = await computeDiff(supabase, parsedResult.rows);
      setDiff(diffResult);
      setStage('review');
    } catch (e) {
      setError(e.message || 'Onbekende fout bij verwerken');
      setStage('idle');
    }
  }, [supabase]);

  async function handleConfirm() {
    setStage('importing');
    setError(null);
    try {
      const result = await executeImport(supabase, parsed.rows, diff, currentUser, filename);
      setImportResult(result);
      setStage('done');
    } catch (e) {
      setError(e.message || 'Onbekende fout bij importeren');
      setStage('review');
    }
  }

  function handleReset() {
    setStage('idle');
    setFilename('');
    setParsed(null);
    setDiff(null);
    setImportResult(null);
    setError(null);
  }

  if (!canUpload) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader />
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-amber-900 mb-2">Niet beschikbaar voor jouw rol</h2>
          <p className="text-[13px] text-amber-800">
            Data uploaden is alleen toegankelijk voor AP Clerks, CFO en admins.
            {isPlayingRole && <> Wissel naar een rol met toegang via de Test-modus bovenaan.</>}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {stage === 'idle' && (
        <UploadZone onFile={handleFile} dragOver={dragOver} setDragOver={setDragOver} />
      )}

      {stage === 'parsing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Bezig met inlezen en vergelijken met database...</p>
        </div>
      )}

      {stage === 'review' && parsed && diff && (
        <ReviewStage parsed={parsed} diff={diff} filename={filename} onConfirm={handleConfirm} onCancel={handleReset} />
      )}

      {stage === 'importing' && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Bezig met opslaan in database...</p>
          <p className="text-[11px] text-[#1B3A5C]/50 mt-1">Dit kan 10-30 seconden duren bij grote uploads</p>
        </div>
      )}

      {stage === 'done' && importResult && diff && (
        <DoneStage result={importResult} diff={diff} filename={filename} onReset={handleReset} />
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
        <Link href="/dashboard/finance/sandbox-ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
        <span>›</span>
        <span>Data Upload</span>
      </div>
      <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        Data Upload
      </h1>
      <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
        Compass/Eagle CSV inlezen — vergelijken met database — bevestigen
      </p>
    </div>
  );
}

function UploadZone({ onFile, dragOver, setDragOver }) {
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`bg-white rounded-xl border-2 border-dashed p-12 text-center transition-all ${dragOver ? 'border-[#1B3A5C] bg-[#1B3A5C]/5' : 'border-gray-300'}`}
      >
        <div className="w-16 h-16 rounded-2xl bg-[#1B3A5C]/10 mx-auto mb-4 flex items-center justify-center">
          <span className="text-3xl">📥</span>
        </div>
        <p className="text-[16px] font-bold text-[#1B3A5C] mb-1">Sleep de Compass CSV hierheen</p>
        <p className="text-[13px] text-[#1B3A5C]/60 mb-4">of klik om te selecteren</p>
        <label className="inline-block">
          <span className="bg-[#1B3A5C] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg cursor-pointer hover:bg-[#152e4a] transition-colors">
            Bestand selecteren
          </span>
          <input type="file" accept=".csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4 shadow-sm">
        <h3 className="text-[13px] font-bold text-[#1B3A5C] mb-2">Voorbereiding</h3>
        <ul className="text-[12px] text-[#1B3A5C]/70 space-y-1 ml-4 list-disc">
          <li>Export &quot;Open AP Items&quot; uit Eagle/Compass als CSV-bestand</li>
          <li>Verwacht: 28 kolommen met Current Balance, Invoice, Vendor, Voucher, Type, etc.</li>
          <li>De duizend-separator bug wordt automatisch gefikst</li>
          <li>Bestaande facturen behouden hun werkstroom-status; alleen het saldo wordt bijgewerkt</li>
          <li>Facturen die niet meer in de export staan krijgen status &quot;Verdwenen uit Eagle&quot; voor handmatige bevestiging</li>
        </ul>
      </div>
    </div>
  );
}

function ReviewStage({ parsed, diff, filename, onConfirm, onCancel }) {
  const newCount = diff.newInvoices.length;
  const updatedCount = diff.updatedInvoices.length;
  const unchangedCount = diff.unchanged.length;
  const disappearedCount = diff.disappearedInvoices.length;
  const newVendorsCount = diff.newVendors.length;
  const eagleSyncedCount = (diff.eagleSyncedInvoices || []).length;

  return (
    <div className="space-y-4">
      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 px-4 py-3 flex items-center gap-3">
        <span className="text-base">📄</span>
        <div className="flex-1">
          <p className="text-[13px] text-[#1B3A5C]"><strong>{filename}</strong></p>
          <p className="text-[11px] text-[#1B3A5C]/60">
            {fmtNumber(parsed.stats.total_parsed)} facturen ingelezen ·
            XCG {fmtMoney(parsed.stats.total_balance)} totaal ·
            {parsed.stats.unique_vendors} vendors
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DiffCard label="Nieuwe facturen" count={newCount} color="green" />
        <DiffCard label="Bijgewerkt" count={updatedCount} color="blue" sublabel="saldo gewijzigd" />
        <DiffCard label="Ongewijzigd" count={unchangedCount} color="gray" />
        <DiffCard label="Verdwenen" count={disappearedCount} color="amber" sublabel="bevestigen als betaald" />
      </div>

      {diff.eagleSyncedInvoices && diff.eagleSyncedInvoices.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-emerald-900 mb-1">
            ✓ {diff.eagleSyncedInvoices.length} auto-matched {diff.eagleSyncedInvoices.length === 1 ? 'factuur' : 'facturen'} zijn nu in Eagle afgeletterd
          </p>
          <p className="text-[12px] text-emerald-800">
            Deze stonden in de portal op &quot;auto_matched&quot; en zijn niet meer in deze export aanwezig.
            Ze worden bij bevestiging automatisch op status &quot;Betaald&quot; gezet.
          </p>
        </div>
      )}

      {diff.processedCandidates && diff.processedCandidates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-amber-900 mb-1">
            🧹 {diff.processedCandidates.length} afletter-{diff.processedCandidates.length === 1 ? 'kandidaat' : 'kandidaten'} klaar voor verwerking
          </p>
          <p className="text-[12px] text-amber-800">
            Deze stonden in &quot;Te verwerken&quot; op de afletter-werklijst — de bijbehorende
            facturen zijn nu uit de Compass export verdwenen, dus de AP clerk heeft ze in
            Eagle afgeletterd. Bij bevestiging worden ze automatisch op &quot;Verwerkt&quot;
            gezet (Project Clean Up).
          </p>
        </div>
      )}

      {newVendorsCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-amber-900 mb-1">
            {newVendorsCount} nieuwe vendor{newVendorsCount === 1 ? '' : 's'} ontdekt
          </p>
          <p className="text-[12px] text-amber-800 mb-2">
            Deze vendors worden automatisch toegevoegd aan de master maar hebben nog geen BUM-toewijzing.
            Hun facturen verschijnen straks in de actielijst &quot;Vendors zonder BUM&quot;.
          </p>
          <details className="text-[11px] text-amber-800">
            <summary className="cursor-pointer font-semibold hover:text-amber-900">
              Toon alle {newVendorsCount} nieuwe vendors
            </summary>
            <ul className="mt-2 ml-4 list-disc space-y-0.5 max-h-40 overflow-y-auto">
              {diff.newVendors.map(v => (
                <li key={v.vendor_id}>
                  <span className="font-mono">{v.vendor_id}</span> — {v.vendor_name}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {parsed.warnings.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-orange-900 mb-1">
            {parsed.warnings.length} parse-waarschuwing{parsed.warnings.length === 1 ? '' : 'en'}
          </p>
          <details className="text-[11px] text-orange-800">
            <summary className="cursor-pointer font-semibold hover:text-orange-900">Bekijk waarschuwingen</summary>
            <ul className="mt-2 ml-4 list-disc space-y-0.5 max-h-40 overflow-y-auto">
              {parsed.warnings.slice(0, 50).map((w, i) => <li key={i}>{w}</li>)}
              {parsed.warnings.length > 50 && (
                <li className="italic">... en nog {parsed.warnings.length - 50} meer</li>
              )}
            </ul>
          </details>
        </div>
      )}

      {disappearedCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-[13px] font-semibold text-amber-900 mb-1">
            {disappearedCount} facturen verdwenen uit deze export
          </p>
          <p className="text-[12px] text-amber-800">
            Deze stonden nog op een actieve status en zijn nu uit Compass weg. Ze krijgen status
            &quot;Verdwenen uit Eagle&quot; en moeten in een aparte werklijst bevestigd worden als betaald.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-lg bg-white border border-gray-300 text-[13px] font-semibold text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:border-[#1B3A5C]/30 transition-all"
        >
          Annuleren
        </button>
        <button
          onClick={onConfirm}
          className="px-6 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:bg-[#152e4a] transition-all shadow-sm"
        >
          Bevestig import ({fmtNumber(newCount + updatedCount + disappearedCount + eagleSyncedCount)} wijzigingen)
        </button>
      </div>
    </div>
  );
}

function DiffCard({ label, count, color, sublabel }) {
  const colors = {
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  };
  return (
    <div className={`${colors[color]} border rounded-xl p-4`}>
      <p className="text-[11px] uppercase tracking-wider font-semibold opacity-70">{label}</p>
      <p className="text-[28px] font-bold mt-1" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        {fmtNumber(count)}
      </p>
      {sublabel && <p className="text-[10px] opacity-70 mt-0.5">{sublabel}</p>}
    </div>
  );
}

function DoneStage({ result, diff, filename, onReset }) {
  const hasErrors = result.errors && result.errors.length > 0;
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-6 ${hasErrors ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">{hasErrors ? '⚠️' : '✅'}</span>
          <h2 className={`text-[18px] font-bold ${hasErrors ? 'text-amber-900' : 'text-emerald-900'}`}>
            {hasErrors ? 'Import voltooid met fouten' : 'Import succesvol voltooid'}
          </h2>
        </div>
        <p className={`text-[13px] ${hasErrors ? 'text-amber-800' : 'text-emerald-800'}`}>
          {fmtNumber(diff.newInvoices.length)} nieuwe facturen toegevoegd ·
          {' '}{fmtNumber(diff.updatedInvoices.length)} bijgewerkt ·
          {' '}{fmtNumber(diff.disappearedInvoices.length)} verdwenen
          {diff.eagleSyncedInvoices && diff.eagleSyncedInvoices.length > 0 && (
            <> · {fmtNumber(diff.eagleSyncedInvoices.length)} Eagle-synced</>
          )}
          {diff.newVendors.length > 0 && <> · {fmtNumber(diff.newVendors.length)} nieuwe vendors</>}
        </p>
        {hasErrors && (
          <details className="mt-3 text-[12px] text-amber-800">
            <summary className="cursor-pointer font-semibold">Bekijk fouten</summary>
            <ul className="mt-2 ml-4 list-disc space-y-1">
              {result.errors.map((e, i) => <li key={i} className="font-mono text-[11px]">{e}</li>)}
            </ul>
          </details>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onReset}
          className="px-4 py-2.5 rounded-lg bg-white border border-gray-300 text-[13px] font-semibold text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:border-[#1B3A5C]/30 transition-all"
        >
          Nieuwe upload
        </button>
        <Link
          href="/dashboard/finance/sandbox-ap"
          className="px-4 py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:bg-[#152e4a] transition-all"
        >
          Terug naar AP Dashboard
        </Link>
      </div>
    </div>
  );
}
