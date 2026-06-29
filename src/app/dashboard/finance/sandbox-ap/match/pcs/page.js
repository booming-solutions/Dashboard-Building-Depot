/* ============================================================
   BESTAND: sandbox_ap_match_pcs_page_v3.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/match/pcs/page.js
   (nieuwe sandbox-folders: match/pcs/, hernoemen naar page.js)
   🧪 SANDBOX-MIRROR van productie v3 — regel-voor-regel identiek aan live,
   alleen aangepast:
   - alle ap_*-tabellen           → sandbox_ap_*  (profiles blijft gedeeld)
   - route /dashboard/finance/ap  → /dashboard/finance/sandbox-ap


   VEREIST: npm install xlsx (in project root, eenmalig)

   Functie: upload Payment Control Sheet Excel → parseert →
   matcht tegen openstaande facturen → toont resultaten →
   importeert kandidaten naar ap_match_candidates.

   WIJZIGINGEN v3 (na nog steeds lage match-rate in v2):
   - 2-TIER matching:
     Tier 1: exact (vendor + invoice_number) — huidige logica
     Tier 2: fuzzy (vendor + bedrag + tijdsvenster) — NIEUW
   - Tijdsvenster Tier 2: betaaldatum binnen
     [invoice_date, invoice_date + 3mnd] of
     [invoice_date - 30d, due_date + 2mnd]
   - Bij meerdere fuzzy kandidaten voor 1 PCS row → "ambigu"
     (niet importeren, wel tonen voor handmatige review)
   - Conflict-detectie: portal-invoice die door tier 1 is geclaimd
     wordt niet meer aangeboden in tier 2

   WIJZIGINGEN v2 (na lage match-rate 17/695 in v1):
   - Vendor naam-matching aangescherpt: legal suffixes (B.V., LLC,
     LTD, NV) gestript, punctuation genormaliseerd, whitespace
     opgeschoond. Levert betere matches voor 339 PCS-rijen
     zonder vendor nummer.
   - Match ook tegen 'paid' invoices: PCS gaat juist om
     al-betaalde facturen. Wordt nu gecategoriseerd als
     "Al betaald in portal" ipv "geen match".
   - Reden-counts in unmatched: groepering per type met aantallen
     en cross-check (factuur wel bij ander vendor?).
   - Float .0 stripping en betere invoice# normalisatie.
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../../layout';
import Link from 'next/link';
import * as XLSX from 'xlsx';

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

// FX rates voor currency-conversie (PCS heeft factuur-currency, portal heeft XCG)
const FX_RATES = { 'XCG': 1.0, 'ANG': 1.0, 'USD': 1.82, 'EUR': 2.10 };

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}
function fmtNum(n) { return new Intl.NumberFormat('nl-NL').format(n); }

function isoDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function normalizeStr(s) {
  return String(s || '').trim().toLowerCase();
}

function normalizeInvNum(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  // Excel float coercion: "2026.0" → "2026", maar "2026.112" blijft
  s = s.replace(/\.0+$/, '');
  return s;
}

function normalizeName(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase()
    // Verwijder legal entity suffixes
    .replace(/\b(b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|s\.?a\.?|inc\.?|corp\.?|co\.?|company|gmbh)\b/gi, '')
    // Verwijder punctuation
    .replace(/[.,\-'"\(\)&\/]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

function computeMatchScore(pcsRow, invoice) {
  const pcsAmount = parseFloat(pcsRow.Totaalbedrag) || 0;
  const invAmount = parseFloat(invoice.original_amount) || Math.abs(parseFloat(invoice.balance)) || 0;
  const currency = (pcsRow.Currency || 'XCG').trim().toUpperCase();

  if (currency === 'XCG' || currency === 'ANG' || !currency) {
    const diff = Math.abs(invAmount - pcsAmount);
    const pct = pcsAmount > 0 ? diff / Math.abs(pcsAmount) : 0;
    if (diff < 0.5) return 100;
    if (pct < 0.01) return 95;
    if (pct < 0.05) return 80;
    return 60;
  }
  const rate = FX_RATES[currency] || 1.0;
  const expectedXcg = pcsAmount * rate;
  const diff = Math.abs(invAmount - expectedXcg);
  const pct = expectedXcg > 0 ? diff / expectedXcg : 0;
  if (pct < 0.02) return 88;
  if (pct < 0.10) return 70;
  return 50;
}

function tryFuzzyMatch(pcsRow, vid, invoicesByVendor, claimedInvoiceIds) {
  const invoices = invoicesByVendor[vid] ? Object.values(invoicesByVendor[vid]) : [];
  if (invoices.length === 0) return { type: 'no_invoices', candidates: [] };

  const pcsAmount = Math.abs(parseFloat(pcsRow.Totaalbedrag) || 0);
  if (pcsAmount <= 0) return { type: 'no_amount', candidates: [] };
  const currency = (pcsRow.Currency || 'XCG').trim().toUpperCase();
  const rate = FX_RATES[currency] || 1.0;
  const expectedXcg = pcsAmount * rate;
  const tolerance = (currency === 'XCG' || currency === 'ANG' || !currency) ? 0.01 : 0.06;

  const paymentDate = pcsRow.Datum ? new Date(pcsRow.Datum) : null;
  if (!paymentDate || isNaN(paymentDate.getTime())) return { type: 'no_paydate', candidates: [] };

  const candidates = [];
  for (const inv of invoices) {
    if (claimedInvoiceIds.has(inv.id)) continue;
    if (inv.status === 'paid') continue; // al gematched, niet opnieuw
    const invAmount = parseFloat(inv.original_amount) || Math.abs(parseFloat(inv.balance)) || 0;
    if (invAmount <= 0) continue;

    const amtDiff = Math.abs(invAmount - expectedXcg);
    const amtPct = expectedXcg > 0 ? amtDiff / expectedXcg : 1;
    if (amtPct > tolerance) continue;

    const invDate = inv.invoice_date ? new Date(inv.invoice_date) : null;
    const dueDate = inv.due_date ? new Date(inv.due_date) : null;
    if (!invDate && !dueDate) continue;

    // Window: betaaldatum binnen [invDate-30d, max(invDate+3mnd, dueDate+2mnd)]
    let earliest = invDate ? new Date(invDate.getTime() - 30 * 86400000) : new Date(dueDate.getTime() - 60 * 86400000);
    let latest = null;
    if (invDate) {
      const lim1 = new Date(invDate);
      lim1.setMonth(lim1.getMonth() + 3);
      latest = lim1;
    }
    if (dueDate) {
      const lim2 = new Date(dueDate);
      lim2.setMonth(lim2.getMonth() + 2);
      if (!latest || lim2 > latest) latest = lim2;
    }
    if (paymentDate < earliest || paymentDate > latest) continue;

    // Score: hoger bij scherper bedrag-match
    let score = 70;
    if (amtPct < 0.001) score = 85;
    else if (amtPct < 0.01) score = 78;
    else if (amtPct < 0.03) score = 72;

    candidates.push({ invoice: inv, score, amtPct });
  }

  if (candidates.length === 0) return { type: 'no_match', candidates: [] };
  if (candidates.length === 1) return { type: 'unique', candidates };
  // Multiple - sorteer op score desc
  candidates.sort((a, b) => b.score - a.score);
  return { type: 'ambiguous', candidates };
}


export default function PcsMatchPage() {
  const { actualProfile, effectiveRole } = useApRole();
  const supabase = createClient();
  const canImport = ['admin', 'cfo', 'ap_approver', 'ap_clerk'].includes(effectiveRole);

  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [matchResult, setMatchResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(null);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setMatchResult(null);
    setImportDone(null);
    setParsing(true);

    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });

      const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('payment')) || wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];

      // Header staat op rij 2 (index 1) — eerste rij is grouped categories
      const rows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: null });

      // Filter naar status='Paid' met geldige datum
      const paidRows = rows.filter(r =>
        r.Status === 'Paid' && r.Datum && r['Invoice#']
      );
      setParsedRows(paidRows);
      await runMatching(paidRows);
    } catch (e) {
      setError(`Fout bij lezen Excel: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  async function runMatching(rows) {
    setError(null);
    try {
      // 1. Vendors ophalen
      const vendors = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_vendors').select('vendor_id, vendor_name')
      );
      const vendorByName = {};
      for (const v of vendors) {
        const n = normalizeName(v.vendor_name);
        if (n) vendorByName[n] = v.vendor_id;
      }
      const vendorNamesList = Object.entries(vendorByName);

      // 2. ALLE invoices ophalen
      const invoices = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, balance, original_amount, currency, status, invoice_date, due_date')
      );

      const invByVendInv = {};
      const invByVendor = {};  // voor tier 2
      const invByInvOnly = {};
      for (const inv of invoices) {
        const vid = String(inv.vendor_id);
        const invNumKey = normalizeInvNum(inv.invoice_number);
        if (!invByVendInv[vid]) invByVendInv[vid] = {};
        invByVendInv[vid][invNumKey] = inv;
        if (!invByVendor[vid]) invByVendor[vid] = {};
        invByVendor[vid][inv.id] = inv;
        if (!invByInvOnly[invNumKey]) invByInvOnly[invNumKey] = [];
        invByInvOnly[invNumKey].push(inv);
      }

      // Existing PCS candidates (skip duplicates)
      const existing = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_match_candidates')
          .select('invoice_id, source, source_reference, status')
          .eq('source', 'pcs')
      );
      const existingKey = new Set(
        existing.filter(e => e.status !== 'rejected')
          .map(e => `${e.invoice_id}|${e.source_reference || ''}`)
      );

      // Resolve vendor per row
      function resolveVendor(row) {
        if (row.Nummer !== null && row.Nummer !== undefined && row.Nummer !== '') {
          return { vid: String(parseInt(row.Nummer)), method: 'id' };
        }
        if (!row.Naam) return { vid: null, method: null };
        const naamNorm = normalizeName(row.Naam);
        if (vendorByName[naamNorm]) return { vid: String(vendorByName[naamNorm]), method: 'name_exact' };
        if (naamNorm.length >= 3) {
          for (const [name, id] of vendorNamesList) {
            if (name.length >= 3 && (name.includes(naamNorm) || naamNorm.includes(name))) {
              return { vid: String(id), method: 'name_fuzzy' };
            }
          }
        }
        return { vid: null, method: null };
      }

      const tier1Matches = [];
      const tier1Failed = [];  // moeten naar tier 2
      const alreadyPaid = [];
      const claimedInvoiceIds = new Set();

      // === TIER 1: Exact vendor + invoice_number match ===
      for (const row of rows) {
        const { vid, method: vMethod } = resolveVendor(row);
        const invNumKey = normalizeInvNum(row['Invoice#']);

        if (!vid) {
          tier1Failed.push({ row, vid: null, vMethod: null, vendorIssue: true });
          continue;
        }
        const invoiceMap = invByVendInv[vid];
        if (!invoiceMap) {
          tier1Failed.push({ row, vid, vMethod, noVendorInvoices: true });
          continue;
        }
        const invoice = invoiceMap[invNumKey];
        if (!invoice) {
          tier1Failed.push({ row, vid, vMethod });
          continue;
        }
        // Match!
        if (invoice.status === 'paid') {
          alreadyPaid.push({ pcsRow: row, invoice, vMethod, tier: 1 });
          claimedInvoiceIds.add(invoice.id);
          continue;
        }
        const score = computeMatchScore(row, invoice);
        const confidence = score >= 90 ? 'exact' : 'fuzzy';
        const sourceRef = String(row['Regel#'] || '');
        const isDupe = existingKey.has(`${invoice.id}|${sourceRef}`);
        tier1Matches.push({ pcsRow: row, invoice, score, confidence, sourceRef, isDupe, tier: 1, vMethod });
        claimedInvoiceIds.add(invoice.id);
      }

      // === TIER 2: Fuzzy match op vendor + bedrag + tijdsvenster ===
      const tier2Matches = [];
      const ambiguous = [];
      const unmatched = [];
      const reasonCounts = {};
      function tally(r) { reasonCounts[r] = (reasonCounts[r] || 0) + 1; }

      for (const item of tier1Failed) {
        const { row, vid, vMethod, vendorIssue, noVendorInvoices } = item;

        if (vendorIssue) {
          // Geen vendor — check of invoice# wel ergens staat
          const invNumKey = normalizeInvNum(row['Invoice#']);
          const others = invByInvOnly[invNumKey];
          if (others && others.length > 0) {
            tally('Vendor onbekend, factuur wel bij andere vendor');
            unmatched.push({ row, reason: 'Vendor onbekend, factuur wel bij andere vendor', hint: `${others[0].vendor_name} (#${others[0].vendor_id})` });
          } else {
            tally('Vendor niet herkend');
            unmatched.push({ row, reason: 'Vendor niet herkend' });
          }
          continue;
        }

        // Vendor wel, factuurnummer niet exact: probeer Tier 2 fuzzy match
        const fuzzy = tryFuzzyMatch(row, vid, invByVendor, claimedInvoiceIds);

        if (fuzzy.type === 'unique') {
          const c = fuzzy.candidates[0];
          const sourceRef = String(row['Regel#'] || '');
          const isDupe = existingKey.has(`${c.invoice.id}|${sourceRef}`);
          tier2Matches.push({
            pcsRow: row, invoice: c.invoice, score: c.score, confidence: 'fuzzy',
            sourceRef, isDupe, tier: 2, vMethod, amtPct: c.amtPct,
          });
          claimedInvoiceIds.add(c.invoice.id);
        } else if (fuzzy.type === 'ambiguous') {
          tally('Meerdere mogelijke matches (ambigu)');
          ambiguous.push({ row, vid, candidates: fuzzy.candidates });
        } else if (noVendorInvoices) {
          tally('Vendor herkend, maar geen openstaande facturen');
          unmatched.push({ row, reason: 'Vendor herkend, maar geen openstaande facturen', vendor_id: vid });
        } else if (fuzzy.type === 'no_match') {
          tally('Vendor wel, geen factuur binnen bedrag/tijdsvenster');
          unmatched.push({ row, reason: 'Vendor wel, geen factuur binnen bedrag/tijdsvenster', vendor_id: vid });
        } else {
          tally(`Tier 2 skip: ${fuzzy.type}`);
          unmatched.push({ row, reason: `Tier 2 skip: ${fuzzy.type}`, vendor_id: vid });
        }
      }

      const matches = [...tier1Matches, ...tier2Matches];
      matches.sort((a, b) => b.score - a.score);

      setMatchResult({
        total: rows.length,
        matchesExact: tier1Matches.filter(m => m.confidence === 'exact' && !m.isDupe).length,
        matchesFuzzyTier1: tier1Matches.filter(m => m.confidence === 'fuzzy' && !m.isDupe).length,
        matchesFuzzyTier2: tier2Matches.filter(m => !m.isDupe).length,
        duplicates: matches.filter(m => m.isDupe).length,
        alreadyPaid: alreadyPaid.length,
        ambiguous: ambiguous.length,
        unmatchedCount: unmatched.length,
        matches,
        alreadyPaidRows: alreadyPaid,
        ambiguousRows: ambiguous,
        unmatched,
        reasonCounts,
      });
    } catch (e) {
      setError(`Fout bij matching: ${e.message}`);
    }
  }

  async function importMatches() {
    if (!matchResult) return;
    setImporting(true);
    setError(null);
    try {
      const toImport = matchResult.matches.filter(m => !m.isDupe);
      const rows = toImport.map(m => ({
        invoice_id: m.invoice.id,
        source: 'pcs',
        source_reference: m.sourceRef,
        matched_amount: parseFloat(m.pcsRow.Totaalbedrag) || null,
        matched_date: isoDate(m.pcsRow.Datum),
        matched_currency: m.pcsRow.Currency || 'XCG',
        confidence: m.confidence,
        match_score: m.score,
        match_meta: {
          tier: m.tier || 1,
          vendor_match_method: m.vMethod || null,
          pcs_row: m.pcsRow['Regel#'],
          pcs_vendor_name: m.pcsRow.Naam,
          pcs_vendor_nr: m.pcsRow.Nummer,
          pcs_invoice_nr: m.pcsRow['Invoice#'],
          pcs_total: m.pcsRow.Totaalbedrag,
          pcs_currency: m.pcsRow.Currency,
          pcs_opmerkingen: m.pcsRow.Opmerkingen,
          invoice_original_amount: m.invoice.original_amount,
          invoice_balance: m.invoice.balance,
          amount_pct_diff: m.amtPct || null,
        },
        status: 'pending',
        created_by: actualProfile.id,
      }));

      // Batch inserts (max 500 per call)
      let imported = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: insErr } = await supabase.from('sandbox_ap_match_candidates').insert(batch);
        if (insErr) throw insErr;
        imported += batch.length;
      }

      // Audit
      await supabase.from('sandbox_ap_audit_log').insert({
        action: 'pcs_imported',
        entity_type: 'match_candidates',
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: { imported, total_paid_rows: matchResult.total, unmatched: matchResult.unmatchedCount },
      });

      setImportDone({ imported });
    } catch (e) {
      setError(`Fout bij importeren: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  if (!canImport) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-[#1B3A5C]/60">Je hebt geen rechten om PCS te importeren.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
          <Link href="/dashboard/finance/sandbox-ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
          <span>›</span>
          <span>Afletteren</span>
          <span>›</span>
          <span>PCS Import</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Payment Control Sheet Import
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Upload de PCS Excel om handmatig gemarkeerde betalingen te matchen tegen openstaande facturen.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {/* File upload */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <label className="block text-[14px] font-semibold text-[#1B3A5C] mb-2">
          Selecteer Payment Control Sheet Excel
        </label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFile}
          disabled={parsing}
          className="text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#1B3A5C] file:text-white file:font-semibold file:cursor-pointer hover:file:bg-[#264a73]"
        />
        {file && (
          <p className="text-[11px] text-[#1B3A5C]/50 mt-2">
            Gekozen: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
        {parsing && (
          <div className="mt-3 text-[12px] text-[#1B3A5C]/60">
            <span className="inline-block w-4 h-4 border-2 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mr-2 align-middle" />
            Parseren en matchen...
          </div>
        )}
      </div>

      {/* Resultaten */}
      {matchResult && !importDone && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Totaal Paid rijen" value={matchResult.total} color="gray" />
            <StatCard label="Exact match" value={matchResult.matchesExact} color="emerald" sub="vendor + factuur#" />
            <StatCard label="Fuzzy (bedrag/tijd)" value={matchResult.matchesFuzzyTier2} color="amber" sub="vendor + bedrag + window" />
            <StatCard label="Al betaald" value={matchResult.alreadyPaid} color="purple" sub="in portal" />
            <StatCard label="Ambigu" value={matchResult.ambiguous || 0} color="blue" sub="meerdere mogelijk" />
            <StatCard label="Geen match" value={matchResult.unmatchedCount} color="rose" />
            {matchResult.duplicates > 0 && <StatCard label="Duplicaten" value={matchResult.duplicates} color="gray" sub="al geïmporteerd" />}
            {matchResult.matchesFuzzyTier1 > 0 && <StatCard label="Fuzzy Tier 1" value={matchResult.matchesFuzzyTier1} color="amber" sub="exact factuur, klein bedrag-diff" />}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div>
                <h2 className="text-[16px] font-bold text-[#1B3A5C]">Te importeren kandidaten</h2>
                <p className="text-[12px] text-[#1B3A5C]/60 mt-1">
                  {matchResult.matchesExact + matchResult.matchesFuzzy} nieuwe match-kandidaten worden toegevoegd aan de afletter-werklijst.
                  Daar kun je ze bevestigen of afwijzen.
                </p>
              </div>
              <button
                onClick={importMatches}
                disabled={importing || (matchResult.matchesExact + matchResult.matchesFuzzy) === 0}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50"
              >
                {importing ? 'Importeren...' : `✓ Importeer ${matchResult.matchesExact + matchResult.matchesFuzzy} kandidaten`}
              </button>
            </div>
            <MatchPreviewTable matches={matchResult.matches.filter(m => !m.isDupe).slice(0, 30)} />
            {(matchResult.matchesExact + matchResult.matchesFuzzy) > 30 && (
              <p className="text-[11px] text-[#1B3A5C]/50 mt-2 text-center">
                Eerste 30 getoond — de rest wordt ook geïmporteerd.
              </p>
            )}
          </div>

          {matchResult.ambiguous > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
              <p className="text-[13px] text-blue-900">
                <strong>{fmtNum(matchResult.ambiguous)} PCS-rijen ambigu</strong> — meerdere portal-facturen voldoen aan vendor + bedrag + tijdsvenster.
                Worden niet automatisch geïmporteerd om dubbele toewijzing te voorkomen. Beste oplossing: handmatig markeren via de werkstroom (methode 4).
              </p>
            </div>
          )}

          {matchResult.alreadyPaid > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
              <p className="text-[13px] text-purple-900">
                <strong>{fmtNum(matchResult.alreadyPaid)} facturen</strong> uit PCS staan al op &quot;betaald&quot; in portal.
                Geen actie nodig — ze zijn eerder afgeletterd.
              </p>
            </div>
          )}

          {matchResult.unmatched.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
              <h2 className="text-[16px] font-bold text-[#1B3A5C] mb-3">
                Geen match ({matchResult.unmatched.length})
              </h2>

              {/* Breakdown per reden */}
              {Object.keys(matchResult.reasonCounts || {}).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-[12px] font-semibold text-[#1B3A5C] mb-2">Verdeling per reden:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(matchResult.reasonCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => (
                        <div key={reason} className="flex items-center gap-2 text-[12px]">
                          <span className="px-1.5 py-0.5 rounded font-mono font-bold bg-rose-100 text-rose-700 min-w-[2.5rem] text-center">
                            {count}
                          </span>
                          <span className="text-[#1B3A5C]/70">{reason}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <UnmatchedTable rows={matchResult.unmatched.slice(0, 50)} />
              {matchResult.unmatched.length > 50 && (
                <p className="text-[11px] text-[#1B3A5C]/50 mt-2 text-center">Eerste 50 getoond — alle redenen in breakdown hierboven.</p>
              )}
            </div>
          )}
        </>
      )}

      {importDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
          <h2 className="text-[18px] font-bold text-emerald-800 mb-2">
            ✓ {fmtNum(importDone.imported)} kandidaten geïmporteerd
          </h2>
          <p className="text-[13px] text-emerald-900/80 mb-4">
            Open de afletter-werklijst om de kandidaten te bevestigen of af te wijzen.
          </p>
          <Link href="/dashboard/finance/sandbox-ap/match/worklist"
            className="inline-block px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700">
            → Ga naar afletter-werklijst
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  const colorMap = {
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    purple: 'bg-purple-50 text-purple-800 border-purple-200',
    rose: 'bg-rose-50 text-rose-800 border-rose-200',
  };
  return (
    <div className={`rounded-xl border p-3 ${colorMap[color]}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-[24px] font-bold mt-1">{fmtNum(value)}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}

function MatchPreviewTable({ matches }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Vendor</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Factuur</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">PCS bedrag</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Portal bedrag</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Betaaldatum</th>
            <th className="p-2 text-center font-semibold text-[#1B3A5C]/70">Score</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="p-2">
                <div className="font-semibold text-[#1B3A5C]">{m.invoice.vendor_name}</div>
                <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{m.invoice.vendor_id}</div>
              </td>
              <td className="p-2 font-mono text-[#1B3A5C]">{m.invoice.invoice_number}</td>
              <td className="p-2 text-right font-mono">
                <span>{fmtMoney(parseFloat(m.pcsRow.Totaalbedrag))}</span>
                <span className="ml-1 text-[10px] text-[#1B3A5C]/40">{m.pcsRow.Currency || 'XCG'}</span>
              </td>
              <td className="p-2 text-right font-mono text-[#1B3A5C]/70">
                {fmtMoney(parseFloat(m.invoice.original_amount) || Math.abs(parseFloat(m.invoice.balance)))} XCG
              </td>
              <td className="p-2 text-[#1B3A5C]/70">{fmtDate(m.pcsRow.Datum)}</td>
              <td className="p-2 text-center">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  m.confidence === 'exact' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {Math.round(m.score)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">PCS Regel</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Vendor</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Factuur</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Bedrag</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Reden / hint</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="p-2 text-[#1B3A5C]/60">{u.row['Regel#'] || '?'}</td>
              <td className="p-2">
                <div className="font-semibold text-[#1B3A5C]/80">{u.row.Naam || '—'}</div>
                {u.row.Nummer && <div className="text-[10px] font-mono text-[#1B3A5C]/40">#{u.row.Nummer}</div>}
              </td>
              <td className="p-2 font-mono text-[#1B3A5C]/70">{u.row['Invoice#'] || '—'}</td>
              <td className="p-2 text-right font-mono text-[#1B3A5C]/70">
                {fmtMoney(parseFloat(u.row.Totaalbedrag))} {u.row.Currency || ''}
              </td>
              <td className="p-2 text-rose-700/80 text-[11px]">
                {u.reason}
                {u.hint && <div className="text-[10px] text-[#1B3A5C]/50 italic">→ {u.hint}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
