/* ============================================================
   BESTAND: ap_match_bank_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/match/bank/page.js
   (nieuwe folder: match/bank/, hernoemen naar page.js)

   VEREIST: package.json moet "pdfjs-dist": "^4.0.379" hebben.
   Zonder die regel werkt de upload niet.

   Functie: upload MCB of RBC bank statement PDF → parseert →
   filtert uitgaande betalingen → matcht tegen openstaande
   facturen → toont resultaten → importeert kandidaten naar
   ap_match_candidates met source='bank_mcb' of 'bank_rbc'.

   PARSER STRATEGIE:
   - MCB: balans-tracking voor debit/credit detectie + filter
     EDC/MAESTRO/FEE/TAX ruis. Counterparty uit vervolgregels.
   - RBC: filter op "WireTfr Debit" en "Tfr Debit" patronen.
     Multi-line per transactie, counterparty + INV# in vervolg.
   ============================================================ */
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../../layout';
import Link from 'next/link';

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

// ====== HELPERS ======
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

// Parse "6.811,51" → 6811.51 (NL/Curaçao notation)
function parseMcbAmount(s) {
  if (!s) return 0;
  return parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
}
// Parse "6,811.51" → 6811.51 (RBC US notation)
function parseRbcAmount(s) {
  if (!s) return 0;
  return parseFloat(String(s).trim().replace(/,/g, ''));
}

function normalizeName(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase()
    .replace(/\b(b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|s\.?a\.?|inc\.?|corp\.?|co\.?|company|gmbh)\b/gi, '')
    .replace(/[.,\-'"\(\)&\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ====== PDF EXTRACTIE ======
async function readPdfLines(file) {
  // Dynamic import — pdfjs-dist is alleen op de client beschikbaar
  const pdfjsLib = await import('pdfjs-dist');
  // Worker URL via CDN (matched aan de geinstalleerde versie)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allLines = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Groepeer items per y-coordinaat (regel) en sorteer x binnen elke regel
    const yGrouped = {};
    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!yGrouped[y]) yGrouped[y] = [];
      yGrouped[y].push({ x: item.transform[4], text: item.str });
    }
    // Y desc (top eerst); x asc per regel
    const ys = Object.keys(yGrouped).map(Number).sort((a, b) => b - a);
    for (const y of ys) {
      const items = yGrouped[y].sort((a, b) => a.x - b.x);
      const line = items.map(it => it.text).join(' ').replace(/\s+/g, ' ').trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

// ====== MCB PARSER ======
function parseMcbStatement(lines) {
  // Jaar uit "Statement Period JUNE 02 2026"
  let year = new Date().getFullYear();
  for (const line of lines) {
    const m = line.match(/Statement Period.*?(\d{4})/i);
    if (m) { year = parseInt(m[1]); break; }
  }

  let prevBalance = null;
  const transactions = [];
  let current = null;

  for (const line of lines) {
    // Previous balance
    const prevM = line.match(/PREVIOUS BALANCE\s+([\d.]+,\d{2})CR/i);
    if (prevM) {
      prevBalance = parseMcbAmount(prevM[1]);
      continue;
    }

    // Transactie eerste regel: DD/MM REF DESC AMOUNT BALANCE_CR
    const txM = line.match(/^(\d{2})\/(\d{2})\s+(\S+)\s+(.+?)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})CR$/);
    if (txM) {
      const [, dd, mm, ref, desc, amt, bal] = txM;
      const amount = parseMcbAmount(amt);
      const balance = parseMcbAmount(bal);
      const isDebit = prevBalance !== null && (balance + 0.005) < prevBalance;
      prevBalance = balance;
      current = {
        bank: 'mcb',
        date: `${year}-${mm}-${dd}`,
        ref,
        description: desc.trim(),
        amount,
        balance,
        type: isDebit ? 'debit' : 'credit',
        extraLines: [],
      };
      transactions.push(current);
      continue;
    }
    // Vervolgregel
    if (current && line.length > 0 && !/^Please examine|^\s*XCG -|^Page \d|^DATE|^Customer Service/i.test(line)) {
      current.extraLines.push(line);
    }
  }
  return transactions;
}

function isMcbNoise(tx) {
  const d = tx.description.toUpperCase();
  // Card settlements en kaart-fees
  if (/\bEDC\b|\bMAESTRO\b|\bBTC#|\bTID#|\bMCDT\b|\bMMDT\b|\bMUDT\b|\bVSDC\b|\bVISA\b/.test(d)) return true;
  // Interest, fees, transactiekosten
  if (/COMM\.|NAOB TAX|MCBDIRECT|TRANSACTN FEE|INTEREST/.test(d)) return true;
  return false;
}

function extractMcbVendor(tx) {
  // Als description = "BANCO DI CARIBE", echte counterparty in vervolgregel
  const isBancoDiCaribe = /BANCO DI CARIBE/i.test(tx.description);
  if (isBancoDiCaribe && tx.extraLines.length > 0) {
    // Eerste vervolgregel is doorgaans de counterparty
    return tx.extraLines[0];
  }
  return tx.description;
}

function extractMcbReference(tx) {
  // Zoek "REF. NNNNN" of "INV NNNN" of "Estimate NNNN" in vervolgregels
  for (const ln of tx.extraLines) {
    const m = ln.match(/(?:REF\.?|INV(?:OICE)?|ESTIMATE)\s*:?\s*(\S+)/i);
    if (m) return m[1];
  }
  return null;
}

// ====== RBC PARSER ======
function parseRbcStatement(lines) {
  // Jaar uit "From: 02/06/2026"
  let year = new Date().getFullYear();
  for (const line of lines) {
    const m = line.match(/From:?\s*\d{2}\/\d{2}\/(\d{4})/i);
    if (m) { year = parseInt(m[1]); break; }
  }

  const transactions = [];
  let current = null;

  for (const line of lines) {
    // Eerste regel: MMDD MMDD DESC AMOUNT (DR|CR) BALANCE
    const txM = line.match(/^(\d{4})\s+(\d{4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(DR|CR)\s+([\d,]+\.\d{2})$/);
    if (txM) {
      const [, bookDate, , desc, amt, drcr, bal] = txM;
      const mm = bookDate.substring(0, 2);
      const dd = bookDate.substring(2, 4);
      const amount = Math.abs(parseRbcAmount(amt));
      const balance = parseRbcAmount(bal);
      current = {
        bank: 'rbc',
        date: `${year}-${mm}-${dd}`,
        description: desc.trim(),
        amount,
        balance,
        type: drcr === 'DR' ? 'debit' : 'credit',
        extraLines: [],
      };
      transactions.push(current);
      continue;
    }
    if (current && line.length > 0 && !/^Account Number|^Statement Period|^TRANSACTION DETAIL|^BOOK|^\d+ of \d+|^___|^Earn up to/i.test(line)) {
      current.extraLines.push(line);
    }
  }
  return transactions;
}

function isRbcVendorPayment(tx) {
  if (tx.type !== 'debit') return false;
  const d = tx.description;
  // Alleen echte uitgaande betalingen
  return /WireTfr Debit|InternetBanking Tfr Debit/i.test(d);
}

function extractRbcVendor(tx) {
  // Counterparty: meestal een hoofdletter-regel zonder cijfers/punctuatie als IBAN/SWIFT
  for (const ln of tx.extraLines) {
    // Skip referentie-codes (PI, CMS REF, NL36INGB, INGBNL2A, etc)
    if (/^(PI\d|CMS\sREF|NL\d{2}|[A-Z]{6,8}$|[A-Z]+NL\d|\d{6,})/i.test(ln)) continue;
    // Skip adres-regels
    if (/^\d{4}\s[A-Z]{2}\s/i.test(ln)) continue;
    if (/^(NL|US|GB|DE|FR|BE)$/i.test(ln)) continue;
    // Skip INV ref (alleen pure invoice-reference)
    if (/^INV\s/i.test(ln)) continue;
    // Eerste plausibele bedrijfsnaam
    if (/[A-Z]{2,}/.test(ln) && !/\d{3,}/.test(ln)) return ln;
  }
  return tx.extraLines[1] || tx.extraLines[0] || tx.description;
}

function extractRbcReference(tx) {
  for (const ln of tx.extraLines) {
    const m = ln.match(/^INV\s+([A-Z0-9]+)/i);
    if (m) return m[1];
  }
  return null;
}

// ====== MATCHING ENGINE (vrijwel identiek aan PCS Tier 2) ======
function tryMatchInvoice(tx, vendorId, invoicesByVendor, claimedIds) {
  const invoices = invoicesByVendor[vendorId] ? Object.values(invoicesByVendor[vendorId]) : [];
  if (invoices.length === 0) return { type: 'no_invoices', candidates: [] };

  const txAmount = Math.abs(tx.amount);
  if (txAmount <= 0) return { type: 'no_amount', candidates: [] };

  const txDate = tx.date ? new Date(tx.date) : null;
  if (!txDate || isNaN(txDate.getTime())) return { type: 'no_date', candidates: [] };

  const candidates = [];
  for (const inv of invoices) {
    if (claimedIds.has(inv.id)) continue;
    if (inv.status === 'paid') continue;
    const invAmount = parseFloat(inv.original_amount) || Math.abs(parseFloat(inv.balance)) || 0;
    if (invAmount <= 0) continue;

    // Bedrag tolerantie: 1% voor XCG, 6% voor non-XCG (FX-marge)
    const isXcg = !inv.currency || inv.currency === 'XCG' || inv.currency === 'ANG';
    const tol = isXcg ? 0.01 : 0.06;
    const diff = Math.abs(invAmount - txAmount);
    const pct = invAmount > 0 ? diff / invAmount : 1;
    if (pct > tol) continue;

    // Tijdsvenster
    const invDate = inv.invoice_date ? new Date(inv.invoice_date) : null;
    const dueDate = inv.due_date ? new Date(inv.due_date) : null;
    if (!invDate && !dueDate) continue;
    const earliest = invDate ? new Date(invDate.getTime() - 30 * 86400000) :
      new Date(dueDate.getTime() - 60 * 86400000);
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
    if (txDate < earliest || txDate > latest) continue;

    let score = 70;
    if (pct < 0.001) score = 88;
    else if (pct < 0.01) score = 80;
    else if (pct < 0.03) score = 75;

    candidates.push({ invoice: inv, score, amtPct: pct });
  }

  if (candidates.length === 0) return { type: 'no_match', candidates: [] };
  if (candidates.length === 1) return { type: 'unique', candidates };
  candidates.sort((a, b) => b.score - a.score);
  return { type: 'ambiguous', candidates };
}

// ====== HOOFD COMPONENT ======
export default function BankMatchPage() {
  const { actualProfile, effectiveRole } = useApRole();
  const supabase = createClient();
  const canImport = ['admin', 'cfo', 'ap_approver', 'ap_clerk'].includes(effectiveRole);

  const [bank, setBank] = useState('mcb');
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [transactions, setTransactions] = useState([]);
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
      const lines = await readPdfLines(f);
      let txs = bank === 'mcb' ? parseMcbStatement(lines) : parseRbcStatement(lines);
      // Filter ruis + alleen debits (uitgaande betalingen)
      txs = txs.filter(t => {
        if (t.type !== 'debit') return false;
        if (bank === 'mcb') return !isMcbNoise(t);
        if (bank === 'rbc') return isRbcVendorPayment(t);
        return false;
      });
      setTransactions(txs);
      await runMatching(txs);
    } catch (e) {
      console.error(e);
      setError(`Fout bij lezen PDF: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  async function runMatching(txs) {
    setError(null);
    try {
      // Vendors ophalen
      const vendors = await fetchAllPaginated(() =>
        supabase.from('ap_vendors').select('vendor_id, vendor_name')
      );
      const vendorByName = {};
      for (const v of vendors) {
        const n = normalizeName(v.vendor_name);
        if (n) vendorByName[n] = v.vendor_id;
      }
      const vendorNamesList = Object.entries(vendorByName);

      // Alle invoices
      const invoices = await fetchAllPaginated(() =>
        supabase.from('ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, balance, original_amount, currency, status, invoice_date, due_date')
      );
      const invByVendor = {};
      for (const inv of invoices) {
        const vid = String(inv.vendor_id);
        if (!invByVendor[vid]) invByVendor[vid] = {};
        invByVendor[vid][inv.id] = inv;
      }

      // Bestaande candidates
      const sourceKey = bank === 'mcb' ? 'bank_mcb' : 'bank_rbc';
      const existing = await fetchAllPaginated(() =>
        supabase.from('ap_match_candidates')
          .select('invoice_id, source_reference, status')
          .eq('source', sourceKey)
      );
      const existingKey = new Set(
        existing.filter(e => e.status !== 'rejected')
          .map(e => `${e.invoice_id}|${e.source_reference || ''}`)
      );

      const matches = [];
      const ambiguous = [];
      const unmatched = [];
      const claimedIds = new Set();
      const reasonCounts = {};
      function tally(r) { reasonCounts[r] = (reasonCounts[r] || 0) + 1; }

      for (const tx of txs) {
        const vendorName = bank === 'mcb' ? extractMcbVendor(tx) : extractRbcVendor(tx);
        const reference = bank === 'mcb' ? extractMcbReference(tx) : extractRbcReference(tx);

        // Vendor zoek
        const nameNorm = normalizeName(vendorName);
        let vid = null;
        if (nameNorm && vendorByName[nameNorm]) {
          vid = String(vendorByName[nameNorm]);
        } else if (nameNorm.length >= 3) {
          for (const [name, id] of vendorNamesList) {
            if (name.length >= 3 && (name.includes(nameNorm) || nameNorm.includes(name))) {
              vid = String(id);
              break;
            }
          }
        }

        if (!vid) {
          tally('Vendor niet herkend');
          unmatched.push({ tx, vendorName, reference, reason: 'Vendor niet herkend' });
          continue;
        }

        const match = tryMatchInvoice(tx, vid, invByVendor, claimedIds);
        const sourceRef = `${tx.date}_${Math.round(tx.amount * 100)}`;

        if (match.type === 'unique') {
          const c = match.candidates[0];
          const isDupe = existingKey.has(`${c.invoice.id}|${sourceRef}`);
          matches.push({ tx, vendorName, reference, invoice: c.invoice, score: c.score, sourceRef, isDupe, vid });
          claimedIds.add(c.invoice.id);
        } else if (match.type === 'ambiguous') {
          tally('Meerdere mogelijke matches');
          ambiguous.push({ tx, vendorName, reference, candidates: match.candidates, vid });
        } else if (match.type === 'no_invoices') {
          tally('Vendor herkend, geen openstaande facturen');
          unmatched.push({ tx, vendorName, reference, reason: 'Vendor herkend, geen openstaande facturen' });
        } else {
          tally('Geen factuur binnen bedrag/tijdsvenster');
          unmatched.push({ tx, vendorName, reference, reason: 'Geen factuur binnen bedrag/tijdsvenster' });
        }
      }

      setMatchResult({
        total: txs.length,
        matches: matches.filter(m => !m.isDupe).length,
        duplicates: matches.filter(m => m.isDupe).length,
        ambiguous: ambiguous.length,
        unmatchedCount: unmatched.length,
        matchList: matches,
        ambiguousList: ambiguous,
        unmatched,
        reasonCounts,
      });
    } catch (e) {
      console.error(e);
      setError(`Matching fout: ${e.message}`);
    }
  }

  async function importMatches() {
    if (!matchResult) return;
    setImporting(true);
    setError(null);
    try {
      const sourceKey = bank === 'mcb' ? 'bank_mcb' : 'bank_rbc';
      const toImport = matchResult.matchList.filter(m => !m.isDupe);
      const rows = toImport.map(m => ({
        invoice_id: m.invoice.id,
        source: sourceKey,
        source_reference: m.sourceRef,
        matched_amount: m.tx.amount,
        matched_date: m.tx.date,
        matched_currency: 'XCG',
        confidence: 'fuzzy',
        match_score: m.score,
        match_meta: {
          bank,
          tx_description: m.tx.description,
          tx_extra_lines: m.tx.extraLines,
          tx_amount: m.tx.amount,
          tx_balance: m.tx.balance,
          extracted_vendor: m.vendorName,
          extracted_reference: m.reference,
          invoice_original_amount: m.invoice.original_amount,
          invoice_balance: m.invoice.balance,
        },
        status: 'pending',
        created_by: actualProfile.id,
      }));

      let imported = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: insErr } = await supabase.from('ap_match_candidates').insert(batch);
        if (insErr) throw insErr;
        imported += batch.length;
      }

      await supabase.from('ap_audit_log').insert({
        action: `${sourceKey}_imported`,
        entity_type: 'match_candidates',
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: { imported, bank, file: file?.name },
      });

      setImportDone({ imported });
    } catch (e) {
      console.error(e);
      setError(`Import fout: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  if (!canImport) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-[#1B3A5C]/60">Geen rechten voor bank-import.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
          <Link href="/dashboard/finance/ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
          <span>›</span><span>Afletteren</span><span>›</span><span>Bank Statement</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Bank Statement Import
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Upload MCB of RBC PDF om uitgaande betalingen te matchen tegen openstaande facturen.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {/* Bank kiezer + file upload */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <label className="block text-[14px] font-semibold text-[#1B3A5C] mb-2">Bank</label>
        <div className="flex gap-2 mb-4">
          {[
            { key: 'mcb', label: 'MCB (Maduro & Curiel\'s Bank)', icon: '🏦' },
            { key: 'rbc', label: 'RBC (Royal Bank of Canada)', icon: '🏛️' },
          ].map(b => (
            <button key={b.key} onClick={() => { setBank(b.key); setFile(null); setMatchResult(null); }}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium ${
                bank === b.key
                  ? 'bg-[#1B3A5C] text-white'
                  : 'bg-white border border-gray-200 text-[#1B3A5C]/70 hover:border-[#1B3A5C]/30'
              }`}>
              {b.icon} {b.label}
            </button>
          ))}
        </div>

        <label className="block text-[14px] font-semibold text-[#1B3A5C] mb-2">
          Selecteer {bank === 'mcb' ? 'MCB' : 'RBC'} statement PDF
        </label>
        <input type="file" accept=".pdf" onChange={handleFile} disabled={parsing}
          className="text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#1B3A5C] file:text-white file:font-semibold file:cursor-pointer hover:file:bg-[#264a73]" />
        {file && (
          <p className="text-[11px] text-[#1B3A5C]/50 mt-2">
            Gekozen: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
        {parsing && (
          <div className="mt-3 text-[12px] text-[#1B3A5C]/60">
            <span className="inline-block w-4 h-4 border-2 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mr-2 align-middle" />
            PDF parseren en matchen...
          </div>
        )}
      </div>

      {/* Resultaten */}
      {matchResult && !importDone && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <StatCard label="Uitgaande betalingen" value={matchResult.total} color="gray" sub="na ruisfilter" />
            <StatCard label="Match" value={matchResult.matches} color="emerald" />
            <StatCard label="Ambigu" value={matchResult.ambiguous} color="blue" sub="meerdere mogelijk" />
            <StatCard label="Geen match" value={matchResult.unmatchedCount} color="rose" />
            {matchResult.duplicates > 0 && <StatCard label="Duplicaten" value={matchResult.duplicates} color="gray" sub="al ingelezen" />}
          </div>

          {matchResult.matches > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <div>
                  <h2 className="text-[16px] font-bold text-[#1B3A5C]">Te importeren kandidaten</h2>
                  <p className="text-[12px] text-[#1B3A5C]/60 mt-1">
                    Worden toegevoegd aan de afletter-werklijst (status: te bevestigen).
                  </p>
                </div>
                <button onClick={importMatches} disabled={importing}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50">
                  {importing ? 'Importeren...' : `✓ Importeer ${matchResult.matches} kandidaten`}
                </button>
              </div>
              <MatchTable matches={matchResult.matchList.filter(m => !m.isDupe).slice(0, 30)} />
              {matchResult.matches > 30 && (
                <p className="text-[11px] text-[#1B3A5C]/50 mt-2 text-center">
                  Eerste 30 getoond — alle {matchResult.matches} worden geïmporteerd.
                </p>
              )}
            </div>
          )}

          {matchResult.ambiguous > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
              <p className="text-[13px] text-blue-900 mb-2">
                <strong>{fmtNum(matchResult.ambiguous)} betalingen ambigu</strong> — meerdere portal-facturen voldoen aan vendor + bedrag + tijdsvenster.
                Niet auto-geïmporteerd. Handmatig oppakken via Werkstroom &quot;Markeer extern betaald&quot;.
              </p>
            </div>
          )}

          {matchResult.unmatchedCount > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
              <h2 className="text-[16px] font-bold text-[#1B3A5C] mb-3">
                Geen match ({matchResult.unmatchedCount})
              </h2>
              {Object.keys(matchResult.reasonCounts || {}).length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-[12px] font-semibold text-[#1B3A5C] mb-2">Per reden:</p>
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
            </div>
          )}
        </>
      )}

      {importDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
          <h2 className="text-[18px] font-bold text-emerald-800 mb-2">
            ✓ {fmtNum(importDone.imported)} kandidaten geïmporteerd
          </h2>
          <Link href="/dashboard/finance/ap/match/worklist"
            className="inline-block px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700">
            → Naar afletter-werklijst
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

function MatchTable({ matches }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Datum</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank vendor</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Portal vendor</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Factuur</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Bedrag bank</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Bedrag portal</th>
            <th className="p-2 text-center font-semibold text-[#1B3A5C]/70">Score</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="p-2 text-[#1B3A5C]/70">{fmtDate(m.tx.date)}</td>
              <td className="p-2 text-[11px] text-[#1B3A5C]/80" title={m.tx.description}>
                {m.vendorName}
                {m.reference && <div className="text-[10px] text-[#1B3A5C]/40 font-mono">ref: {m.reference}</div>}
              </td>
              <td className="p-2">
                <div className="font-semibold text-[#1B3A5C]">{m.invoice.vendor_name}</div>
                <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{m.invoice.vendor_id}</div>
              </td>
              <td className="p-2 font-mono text-[#1B3A5C]">{m.invoice.invoice_number}</td>
              <td className="p-2 text-right font-mono">{fmtMoney(m.tx.amount)}</td>
              <td className="p-2 text-right font-mono text-[#1B3A5C]/70">
                {fmtMoney(parseFloat(m.invoice.original_amount) || Math.abs(parseFloat(m.invoice.balance)))}
              </td>
              <td className="p-2 text-center">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
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
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Datum</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Geëxtraheerde vendor</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank beschrijving</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Bedrag</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Reden</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="p-2 text-[#1B3A5C]/70 whitespace-nowrap">{fmtDate(u.tx.date)}</td>
              <td className="p-2 text-[11px] text-[#1B3A5C]/80">{u.vendorName || '—'}</td>
              <td className="p-2 text-[11px] text-[#1B3A5C]/60" title={u.tx.extraLines.join(' | ')}>
                {u.tx.description}
              </td>
              <td className="p-2 text-right font-mono">{fmtMoney(u.tx.amount)}</td>
              <td className="p-2 text-rose-700/80 text-[11px]">{u.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
