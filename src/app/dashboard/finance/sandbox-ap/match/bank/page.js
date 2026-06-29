/* ============================================================
   BESTAND: sandbox_ap_match_bank_page_v6.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/match/bank/page.js
   (nieuwe sandbox-folder: match/bank/, hernoemen naar page.js)
   🧪 SANDBOX-MIRROR van productie v6 — regel-voor-regel identiek aan live,
   alleen aangepast:
   - alle ap_*-tabellen           → sandbox_ap_*  (profiles blijft gedeeld)
   - route /dashboard/finance/ap  → /dashboard/finance/sandbox-ap


   VEREIST: package.json moet "pdfjs-dist": "^4.0.379" hebben.
   Zonder die regel werkt de upload niet.

   Functie: upload MCB of RBC bank statement PDF → parseert →
   filtert uitgaande betalingen → matcht tegen openstaande
   facturen → toont resultaten → importeert kandidaten naar
   ap_match_candidates met source='bank_mcb' of 'bank_rbc'.

   v6 WIJZIGINGEN:
   - Vendor alias-groepen leest uit database (ap_vendors.alias_group_id)
     ipv hardcoded constants. Werkt voor alle huidige + toekomstige
     groepen die admin via SQL of UI (komt nog) toevoegt.
   - Vereist eerst ap_schema_v11.sql gedraaid in Supabase.

   v5 WIJZIGINGEN:
   - VENDOR ALIAS-GROEPEN:
     · Naam-paar: "Axselo" en "Comacord" tellen als 1 bedrijf.
     · Prefix-groep: alle vendors die met "BDMM" beginnen worden
       behandeld als 1 groep (8 vendors in portal).
   - Bij matching wordt over alle vendor_ids binnen de alias-groep
     gezocht, niet alleen tegen 1 specifieke vendor_id.
   - Resolutie: bank-vendor "AXSELO" → vindt Comacord in portal.
     Bank-vendor "BDMM FOO" → kan matchen tegen elke BDMM-vendor.
   - "🔗 alias" badge in match-tabel als match via alias-groep
     is gemaakt (transparantie voor AP clerk).

   v4 WIJZIGINGEN:
   - Per-rij checkbox bij te importeren kandidaten.
     Default alle aangevinkt; lage scores kun je makkelijk uitvinken.
   - Master checkbox + "vink alles uit / vink alles aan" knoppen.
   - Snelle filters: alleen score >= 70 / 85 selecteren.
   - Import knop gebruikt alleen aangevinkte kandidaten.

   v3 WIJZIGINGEN:
   - Tolerantie verhoogd tot 30% verschil (was 1% XCG / 6% FX).
     Curaçao realiteit: FX, bank fees, credit memo verrekeningen
     en gedeeltelijke betalingen geven vaak 5-15% afwijking.
   - Score-gradient (92 voor exact, 55 voor 15-30% verschil).
     AP Clerk ziet score en beslist of het accepteren.
   - CREDIT MEMOs uit primary matching gefilterd. Combinatie met
     andere facturen kan in latere versie.
   - Diagnose-hint bij "geen match": dichtstbijzijnde portal-factuur
     wordt getoond met %verschil voor handmatige review.
   - Auto-pick bij top-gap >= 10 punten: duidelijke winnaar telt
     als unique match in plaats van ambiguous.

   v2 WIJZIGINGEN:
   - MULTI-FILE upload (50+ PDFs in één batch).
   - Auto-detect bank per PDF — geen handmatige bank-keuze meer.
   - Per-file status (✓/✗) met counts en error meldingen.
   - Dedup binnen batch: zelfde transactie in twee PDFs telt maar
     één keer.
   - Eén match-run over alle transacties tegelijk.

   PARSER STRATEGIE:
   - MCB: balans-tracking voor debit/credit detectie + filter
     EDC/MAESTRO/FEE/TAX ruis. Counterparty uit vervolgregels.
   - RBC: filter op "WireTfr Debit" en "Tfr Debit" patronen.
     Multi-line per transactie, counterparty + INV# in vervolg.
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useState, useEffect } from 'react';
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

function getMatchKey(m) {
  return `${m.tx.bank}_${m.sourceRef}_${m.invoice.id}`;
}

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

// ====== VENDOR ALIAS-GROEPEN (uit database) ======
// Vendors hebben een alias_group_id; alle vendors met dezelfde
// group_id horen bij hetzelfde bedrijf. Wordt centraal beheerd
// via ap_vendor_alias_groups tabel (admin via SQL of UI).

// Bouw vendor_id → Set(vendor_ids) map van vendors uit DB query.
// Vendors zonder alias_group_id zitten alleen in hun eigen "groep".
function buildAliasGroups(vendors) {
  const groups = {};  // vendor_id → Set
  const groupMembers = {};  // alias_group_id → Set van vendor_ids

  // Verzamel per alias_group_id alle vendor_ids
  for (const v of vendors) {
    const vid = String(v.vendor_id);
    if (v.alias_group_id) {
      if (!groupMembers[v.alias_group_id]) groupMembers[v.alias_group_id] = new Set();
      groupMembers[v.alias_group_id].add(vid);
    }
  }

  // Per vendor: pak de full group set, of jezelf
  for (const v of vendors) {
    const vid = String(v.vendor_id);
    if (v.alias_group_id && groupMembers[v.alias_group_id]) {
      groups[vid] = groupMembers[v.alias_group_id];
    } else {
      groups[vid] = new Set([vid]);
    }
  }

  return groups;
}

// Bepaal vendor-id en alias-groep o.b.v. bank-vendor naam.
// Returns: { vid, groupIds: Set, method, aliasGroupName }
// De groupIds bevat ALLE vendors in de alias-groep (kan 1 zijn als geen alias).
function resolveVendorAndGroup(name, vendorByName, vendorNamesList, aliasGroups, vendorById, externalNameIndex) {
  const norm = normalizeName(name);
  if (!norm) return null;

  function wrap(vid, method) {
    const vidStr = String(vid);
    const groupIds = aliasGroups[vidStr] || new Set([vidStr]);
    const viaAlias = groupIds.size > 1 || method === 'external_alias';
    let aliasGroupName = null;
    if (viaAlias && vendorById) {
      const names = [];
      for (const gid of groupIds) {
        if (vendorById[gid]?.vendor_name) names.push(vendorById[gid].vendor_name);
      }
      aliasGroupName = names.slice(0, 3).join(' / ') + (names.length > 3 ? ` +${names.length - 3} meer` : '');
    }
    return { vid: vidStr, groupIds, method, viaAlias, aliasGroupName };
  }

  // 1. Direct match (exact normalized name)
  if (vendorByName[norm]) return wrap(vendorByName[norm], 'direct');

  // 2. Substring beide kanten op
  if (norm.length >= 3) {
    for (const [vname, id] of vendorNamesList) {
      if (vname.length >= 3 && (vname.includes(norm) || norm.includes(vname))) {
        return wrap(id, 'substring');
      }
    }
  }

  // 3. External names: bank-naam ("axselo") in groep's external_names → vind eerste portal-vendor in die groep
  if (externalNameIndex) {
    for (const [extName, groupVendorId] of externalNameIndex) {
      if (norm.includes(extName) || extName.includes(norm)) {
        return wrap(groupVendorId, 'external_alias');
      }
    }
  }

  return null;
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

function detectBank(lines) {
  // Bekijk eerste 40 regels van de PDF voor bank-identificatie
  const head = lines.slice(0, 40).join(' ');
  if (/Maduro.*Curiel|\bMCB\b|MCBKCWCU|XCG - CURRENT ACCOUNT/i.test(head)) return 'mcb';
  if (/Royal\s*Bank|RBC\b|InternetBanking|BOOK\s+VALUE\s+DESCRIPTION/i.test(head)) return 'rbc';
  return null;
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

// ====== MATCHING ENGINE v5 (alias-groep aware) ======
function tryMatchInvoice(tx, groupIds, invoicesByVendor, claimedIds) {
  // Verzamel invoices van ALLE vendor_ids in de alias-groep
  const invoices = [];
  for (const vid of groupIds) {
    if (invoicesByVendor[vid]) {
      for (const inv of Object.values(invoicesByVendor[vid])) {
        invoices.push(inv);
      }
    }
  }
  if (invoices.length === 0) return { type: 'no_invoices', candidates: [] };

  const txAmount = Math.abs(tx.amount);
  if (txAmount <= 0) return { type: 'no_amount', candidates: [] };

  const txDate = tx.date ? new Date(tx.date) : null;
  if (!txDate || isNaN(txDate.getTime())) return { type: 'no_date', candidates: [] };

  const candidates = [];
  for (const inv of invoices) {
    if (claimedIds.has(inv.id)) continue;
    if (inv.status === 'paid') continue;
    // Skip CREDIT MEMOs uit primaire matching — die zijn negatief saldo
    if (inv.type === 'CREDIT MEMO') continue;
    const invBalance = parseFloat(inv.balance) || 0;
    // Alleen positive balances (echte schuld); skip credit memos via balance ook
    if (invBalance <= 0) continue;
    const invAmount = invBalance;

    // Verbrede tolerantie: tot 30%, met score-gradient
    const diff = Math.abs(invAmount - txAmount);
    const pct = invAmount > 0 ? diff / invAmount : 1;
    if (pct > 0.30) continue;

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

    // Score-gradient — scherper = hoger
    let score;
    if (pct < 0.001) score = 92;
    else if (pct < 0.01) score = 85;
    else if (pct < 0.05) score = 75;
    else if (pct < 0.15) score = 60;
    else score = 45;

    candidates.push({ invoice: inv, score, amtPct: pct });
  }

  if (candidates.length === 0) return { type: 'no_match', candidates: [] };
  candidates.sort((a, b) => b.score - a.score);

  // Auto-pick: bij meerdere kandidaten, als top wint met >=5 punten
  if (candidates.length === 1) return { type: 'unique', candidates };
  const gap = candidates[0].score - candidates[1].score;
  if (gap >= 5) return { type: 'unique', candidates: [candidates[0]] };
  return { type: 'ambiguous', candidates };
}

function findNearestInvoice(tx, groupIds, invoicesByVendor) {
  const invoices = [];
  for (const vid of groupIds) {
    if (invoicesByVendor[vid]) {
      for (const inv of Object.values(invoicesByVendor[vid])) {
        invoices.push(inv);
      }
    }
  }
  if (invoices.length === 0) return null;
  const txAmount = Math.abs(tx.amount);
  let best = null;
  let bestPct = Infinity;
  for (const inv of invoices) {
    if (inv.status === 'paid') continue;
    if (inv.type === 'CREDIT MEMO') continue;
    const bal = parseFloat(inv.balance) || 0;
    if (bal <= 0) continue;
    const pct = Math.abs(bal - txAmount) / bal;
    if (pct < bestPct) { bestPct = pct; best = { invoice: inv, pct }; }
  }
  return best;
}

// ====== HOOFD COMPONENT ======
export default function BankMatchPage() {
  const { actualProfile, effectiveRole } = useApRole();
  const supabase = createClient();
  const canImport = ['admin', 'cfo', 'ap_approver', 'ap_clerk'].includes(effectiveRole);

  const [files, setFiles] = useState([]);
  const [fileStatuses, setFileStatuses] = useState([]);  // [{name, status, bank, count, dupes, error}]
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [matchResult, setMatchResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState(new Set());
  const [visibleCount, setVisibleCount] = useState(200);
  // Voor ambigue: per-tx welke kandidaat is gekozen (invoice_id of '__skip__')
  const [ambigChoice, setAmbigChoice] = useState({});  // {txKey: invoice_id|'__skip__'}
  const [importDone, setImportDone] = useState(null);
  const [error, setError] = useState(null);

  async function handleFiles(e) {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;
    setFiles(fileList);
    setError(null);
    setMatchResult(null);
    setImportDone(null);
    setParseProgress(0);

    // Init statuses
    const statuses = fileList.map(f => ({
      name: f.name, size: f.size, status: 'pending',
      bank: null, count: 0, dupes: 0, error: null,
    }));
    setFileStatuses(statuses);
    setParsing(true);

    const allTxs = [];
    const seen = new Set();  // dedup keys

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      statuses[i] = { ...statuses[i], status: 'parsing' };
      setFileStatuses([...statuses]);
      setParseProgress(i);

      try {
        const lines = await readPdfLines(f);
        const fileBank = detectBank(lines);
        if (!fileBank) {
          statuses[i] = { ...statuses[i], status: 'error', error: 'Bank niet herkend (geen MCB of RBC)' };
          setFileStatuses([...statuses]);
          continue;
        }
        let txs = fileBank === 'mcb' ? parseMcbStatement(lines) : parseRbcStatement(lines);
        txs = txs.filter(t => {
          if (t.type !== 'debit') return false;
          if (fileBank === 'mcb') return !isMcbNoise(t);
          if (fileBank === 'rbc') return isRbcVendorPayment(t);
          return false;
        });

        let added = 0, dupes = 0;
        for (const tx of txs) {
          // Dedup-key: bank + datum + bedrag (op 2 decimalen)
          const key = `${fileBank}|${tx.date}|${Math.round(tx.amount * 100)}|${tx.description.substring(0, 40)}`;
          if (seen.has(key)) { dupes++; continue; }
          seen.add(key);
          tx.bank = fileBank;
          tx.sourceFile = f.name;
          allTxs.push(tx);
          added++;
        }

        statuses[i] = { ...statuses[i], status: 'done', bank: fileBank, count: added, dupes };
        setFileStatuses([...statuses]);
      } catch (err) {
        console.error('Parse error voor', f.name, err);
        statuses[i] = { ...statuses[i], status: 'error', error: err.message };
        setFileStatuses([...statuses]);
      }
    }

    setParseProgress(fileList.length);
    setTransactions(allTxs);
    if (allTxs.length > 0) await runMatching(allTxs);
    setParsing(false);
  }

  async function runMatching(txs) {
    setError(null);
    try {
      const vendors = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_vendors').select('vendor_id, vendor_name, alias_group_id')
      );
      const vendorByName = {};
      const vendorById = {};
      for (const v of vendors) {
        const n = normalizeName(v.vendor_name);
        if (n) vendorByName[n] = v.vendor_id;
        vendorById[String(v.vendor_id)] = v;
      }
      const vendorNamesList = Object.entries(vendorByName);

      const invoices = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, balance, original_amount, currency, status, invoice_date, due_date')
      );
      const invByVendor = {};
      for (const inv of invoices) {
        const vid = String(inv.vendor_id);
        if (!invByVendor[vid]) invByVendor[vid] = {};
        invByVendor[vid][inv.id] = inv;
      }

      // Bouw alias-groepen
      const aliasGroups = buildAliasGroups(vendors);

      // Bouw external_names index: [normalized_external_name, first_vendor_id_in_group]
      const { data: groupRows } = await supabase
        .from('sandbox_ap_vendor_alias_groups')
        .select('id, external_names');
      const externalNameIndex = [];
      for (const g of (groupRows || [])) {
        if (!g.external_names || g.external_names.length === 0) continue;
        const firstVendor = vendors.find(v => v.alias_group_id === g.id);
        if (!firstVendor) continue;
        for (const ext of g.external_names) {
          const normExt = normalizeName(ext);
          if (normExt) externalNameIndex.push([normExt, String(firstVendor.vendor_id)]);
        }
      }

      // Existing candidates voor BEIDE banken
      const existing = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_match_candidates')
          .select('invoice_id, source, source_reference, status')
          .in('source', ['bank_mcb', 'bank_rbc'])
      );
      const existingKey = new Set(
        existing.filter(e => e.status !== 'rejected')
          .map(e => `${e.source}|${e.invoice_id}|${e.source_reference || ''}`)
      );

      const matches = [];
      const ambiguous = [];
      const unmatched = [];
      const claimedIds = new Set();
      const reasonCounts = {};
      function tally(r) { reasonCounts[r] = (reasonCounts[r] || 0) + 1; }

      for (const tx of txs) {
        const txBank = tx.bank;
        const sourceKey = txBank === 'mcb' ? 'bank_mcb' : 'bank_rbc';
        const vendorName = txBank === 'mcb' ? extractMcbVendor(tx) : extractRbcVendor(tx);
        const reference = txBank === 'mcb' ? extractMcbReference(tx) : extractRbcReference(tx);

        const resolved = resolveVendorAndGroup(vendorName, vendorByName, vendorNamesList, aliasGroups, vendorById, externalNameIndex);
        if (!resolved) {
          tally('Vendor niet herkend');
          unmatched.push({ tx, vendorName, reference, reason: 'Vendor niet herkend' });
          continue;
        }
        const { vid, groupIds, method: vMethod, viaAlias, aliasGroupName } = resolved;
        const aliasInfo = viaAlias ? `Groep: ${aliasGroupName}` : null;

        const m = tryMatchInvoice(tx, groupIds, invByVendor, claimedIds);
        const sourceRef = `${tx.date}_${Math.round(tx.amount * 100)}`;

        if (m.type === 'unique') {
          const c = m.candidates[0];
          const isDupe = existingKey.has(`${sourceKey}|${c.invoice.id}|${sourceRef}`);
          matches.push({ tx, vendorName, reference, invoice: c.invoice, score: c.score, sourceRef, isDupe, vid, sourceKey, vMethod, aliasInfo });
          claimedIds.add(c.invoice.id);
        } else if (m.type === 'ambiguous') {
          tally('Meerdere mogelijke matches');
          ambiguous.push({ tx, vendorName, reference, candidates: m.candidates, vid, vMethod, aliasInfo });
        } else if (m.type === 'no_invoices') {
          tally('Vendor herkend, geen openstaande facturen');
          unmatched.push({ tx, vendorName, reference, reason: 'Vendor herkend, geen openstaande facturen', aliasInfo });
        } else {
          const nearest = findNearestInvoice(tx, groupIds, invByVendor);
          let hint = null;
          if (nearest) {
            const pct = Math.round(nearest.pct * 100);
            const amt = parseFloat(nearest.invoice.balance);
            hint = `${nearest.invoice.vendor_name} · ${nearest.invoice.invoice_number} · ${amt.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}% verschil)`;
          }
          tally('Geen factuur binnen bedrag/tijdsvenster');
          unmatched.push({ tx, vendorName, reference, reason: 'Geen factuur binnen bedrag/tijdsvenster', hint, aliasInfo });
        }
      }

      const result = {
        total: txs.length,
        matches: matches.filter(m => !m.isDupe).length,
        duplicates: matches.filter(m => m.isDupe).length,
        ambiguous: ambiguous.length,
        unmatchedCount: unmatched.length,
        matchList: matches,
        ambiguousList: ambiguous,
        unmatched,
        reasonCounts,
      };
      console.log('[bank-match] result:', {
        total: result.total,
        matches: result.matches,
        ambiguous: result.ambiguous,
        unmatched: result.unmatchedCount,
        duplicates: result.duplicates,
      });
      try {
        setMatchResult(result);
        setVisibleCount(200);
        const defaultKeys = matches.filter(m => !m.isDupe).map(getMatchKey);
        setSelectedMatches(new Set(defaultKeys));
        // Default ambig: kies top-kandidaat per tx
        const ambigDefaults = {};
        ambiguous.forEach((a, i) => {
          const txKey = `ambig_${i}_${a.tx.bank}_${a.tx.date}_${Math.round(a.tx.amount * 100)}`;
          ambigDefaults[txKey] = String(a.candidates[0].invoice.id);
        });
        setAmbigChoice(ambigDefaults);
        console.log('[bank-match] ambig defaults set:', Object.keys(ambigDefaults).length);
      } catch (setErr) {
        console.error('[bank-match] setMatchResult failed:', setErr);
        setError(`UI fout bij weergeven resultaten: ${setErr.message}`);
      }
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
      // 1. Unique matches (zoals voorheen)
      const toImport = matchResult.matchList.filter(m => !m.isDupe && selectedMatches.has(getMatchKey(m)));

      // 2. Ambigue waar gebruiker een kandidaat heeft gekozen (niet '__skip__')
      const ambigToImport = [];
      (matchResult.ambiguousList || []).forEach((a, i) => {
        const txKey = `ambig_${i}_${a.tx.bank}_${a.tx.date}_${Math.round(a.tx.amount * 100)}`;
        const choice = ambigChoice[txKey];
        if (!choice || choice === '__skip__') return;
        const cand = a.candidates.find(c => String(c.invoice.id) === choice);
        if (!cand) return;
        const sourceKey = a.tx.bank === 'mcb' ? 'bank_mcb' : 'bank_rbc';
        const sourceRef = `${a.tx.date}_${Math.round(a.tx.amount * 100)}`;
        ambigToImport.push({
          tx: a.tx, vendorName: a.vendorName, reference: a.reference,
          invoice: cand.invoice, score: cand.score, sourceRef, sourceKey,
          vMethod: a.vMethod || 'manual_ambig_pick',
          aliasInfo: a.aliasInfo,
        });
      });

      console.log('[bank-match] importing:', { unique: toImport.length, ambig: ambigToImport.length });
      const allImports = [...toImport, ...ambigToImport];
      const rows = allImports.map(m => ({
        invoice_id: m.invoice.id,
        source: m.sourceKey,
        source_reference: m.sourceRef,
        matched_amount: m.tx.amount,
        matched_date: m.tx.date,
        matched_currency: 'XCG',
        confidence: 'fuzzy',
        match_score: m.score,
        match_meta: {
          bank: m.tx.bank,
          source_file: m.tx.sourceFile || null,
          tx_description: m.tx.description,
          tx_extra_lines: m.tx.extraLines,
          tx_amount: m.tx.amount,
          tx_balance: m.tx.balance,
          extracted_vendor: m.vendorName,
          extracted_reference: m.reference,
          vendor_match_method: m.vMethod,
          alias_info: m.aliasInfo,
          invoice_original_amount: m.invoice.original_amount,
          invoice_balance: m.invoice.balance,
        },
        status: 'pending',
        created_by: actualProfile.id,
      }));

      let imported = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: insErr } = await supabase.from('sandbox_ap_match_candidates').insert(batch);
        if (insErr) throw insErr;
        imported += batch.length;
      }

      const fileList = files.map(f => f.name);
      const mcbCount = rows.filter(r => r.source === 'bank_mcb').length;
      const rbcCount = rows.filter(r => r.source === 'bank_rbc').length;
      await supabase.from('sandbox_ap_audit_log').insert({
        action: 'bank_statements_imported',
        entity_type: 'match_candidates',
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: { imported, mcb: mcbCount, rbc: rbcCount, files: fileList },
      });

      setImportDone({ imported, mcb: mcbCount, rbc: rbcCount, fromAmbig: ambigToImport.length });
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
          <Link href="/dashboard/finance/sandbox-ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
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

      {/* Multi-file upload */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <label className="block text-[14px] font-semibold text-[#1B3A5C] mb-2">
          Selecteer bank statement PDF(s)
        </label>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Selecteer één of meerdere MCB- of RBC-statements tegelijk (Ctrl/Cmd-klik voor meerdere).
          Bank wordt per bestand automatisch gedetecteerd.
        </p>
        <input type="file" accept=".pdf" multiple onChange={handleFiles} disabled={parsing}
          className="text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#1B3A5C] file:text-white file:font-semibold file:cursor-pointer hover:file:bg-[#264a73]" />

        {parsing && (
          <div className="mt-3 text-[12px] text-[#1B3A5C]/70 font-medium">
            <span className="inline-block w-4 h-4 border-2 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mr-2 align-middle" />
            Bestand {parseProgress + 1} van {files.length} verwerken...
          </div>
        )}

        {fileStatuses.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold text-[#1B3A5C]/70 mb-2">
              Bestanden ({fileStatuses.length}):
            </p>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {fileStatuses.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-gray-50 last:border-0">
                  <span className="w-5 flex-shrink-0">
                    {s.status === 'pending' && <span className="text-gray-400">⌛</span>}
                    {s.status === 'parsing' && <span className="text-blue-600 animate-pulse">⏳</span>}
                    {s.status === 'done' && <span className="text-emerald-600">✓</span>}
                    {s.status === 'error' && <span className="text-rose-600">✗</span>}
                  </span>
                  <span className="flex-1 truncate text-[#1B3A5C]/80" title={s.name}>{s.name}</span>
                  {s.status === 'done' && (
                    <span className="text-[10px] text-[#1B3A5C]/50 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded font-bold mr-1 ${
                        s.bank === 'mcb' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>{s.bank?.toUpperCase()}</span>
                      {s.count} betalingen
                      {s.dupes > 0 && <span className="text-[#1B3A5C]/40 ml-1">({s.dupes} dup)</span>}
                    </span>
                  )}
                  {s.status === 'error' && (
                    <span className="text-[10px] text-rose-700 max-w-[200px] truncate" title={s.error}>{s.error}</span>
                  )}
                </div>
              ))}
            </div>
            {fileStatuses.filter(s => s.status === 'done').length > 0 && (
              <div className="mt-2 text-[11px] text-[#1B3A5C]/60 flex items-center gap-3">
                <span>Klaar: {fileStatuses.filter(s => s.status === 'done').length}/{fileStatuses.length}</span>
                <span className="text-[10px]">
                  MCB: {fileStatuses.filter(s => s.bank === 'mcb').length} ·
                  RBC: {fileStatuses.filter(s => s.bank === 'rbc').length} ·
                  Fout: {fileStatuses.filter(s => s.status === 'error').length}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resultaten */}
      {matchResult && !importDone && (
        <>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4 text-[12px] text-[#1B3A5C]/80">
            <strong>Resultaat:</strong> {matchResult.total} uitgaande betalingen geanalyseerd —
            {' '}{matchResult.matches} match,
            {' '}{matchResult.ambiguous} ambigu,
            {' '}{matchResult.unmatchedCount} geen match
            {matchResult.duplicates > 0 && `, ${matchResult.duplicates} duplicaten`}.
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <StatCard label="Uitgaande betalingen" value={matchResult.total} color="gray" sub="na ruisfilter" />
            <StatCard label="Match" value={matchResult.matches} color="emerald" />
            <StatCard label="Ambigu" value={matchResult.ambiguous} color="blue" sub="meerdere mogelijk" />
            <StatCard label="Geen match" value={matchResult.unmatchedCount} color="rose" />
            {matchResult.duplicates > 0 && <StatCard label="Duplicaten" value={matchResult.duplicates} color="gray" sub="al ingelezen" />}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-[11px] text-[#1B3A5C]/80">
            <strong>Score uitleg:</strong>
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">85+</span> exact
            </span>
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">70-84</span> bedrag ~5% af (FX/fees)
            </span>
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-bold">55-69</span> bedrag 5-15% af (partial / credit memo)
            </span>
            <span className="inline-flex items-center gap-1 ml-2">
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">45-54</span> bedrag 15-30% af (review nodig)
            </span>
          </div>

          {matchResult.matches === 0 && matchResult.ambiguous > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[13px] text-blue-900">
                Geen unique matches — maar {matchResult.ambiguous} ambigue transacties zijn klaar om te importeren
                (top-kandidaat per regel). Bekijk hieronder, pas eventueel keuzes aan, en klik:
              </p>
              <button onClick={importMatches}
                disabled={importing || Object.values(ambigChoice).filter(v => v && v !== '__skip__').length === 0}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50">
                {importing ? 'Importeren...' : `✓ Importeer ${Object.values(ambigChoice).filter(v => v && v !== '__skip__').length} ambigue keuzes`}
              </button>
            </div>
          )}

          {matchResult.matches === 0 && matchResult.ambiguous === 0 && matchResult.total > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4">
              <p className="text-[13px] text-rose-900 mb-1">
                <strong>Geen matches en geen ambigue gevallen.</strong>
              </p>
              <p className="text-[12px] text-rose-800">
                Alle transacties vielen in &quot;geen match&quot;. Bekijk de redenen-breakdown hieronder.
                Mogelijk worden bank-vendors niet herkend — uitbreiding van alias-groepen kan helpen.
              </p>
            </div>
          )}

          {matchResult.matches > 0 && (() => {
            const allMatches = matchResult.matchList.filter(m => !m.isDupe);
            const selectedCount = allMatches.filter(m => selectedMatches.has(getMatchKey(m))).length;
            const ambigPickedCount = Object.values(ambigChoice).filter(v => v && v !== '__skip__').length;
            const allSelected = selectedCount === allMatches.length;
            const someSelected = selectedCount > 0 && selectedCount < allMatches.length;

            function toggleAll() {
              if (allSelected || someSelected) setSelectedMatches(new Set());
              else setSelectedMatches(new Set(allMatches.map(getMatchKey)));
            }
            function toggleOne(key) {
              const next = new Set(selectedMatches);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              setSelectedMatches(next);
            }
            function selectByScore(minScore) {
              setSelectedMatches(new Set(allMatches.filter(m => m.score >= minScore).map(getMatchKey)));
            }

            return (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h2 className="text-[16px] font-bold text-[#1B3A5C]">Te importeren kandidaten</h2>
                    <p className="text-[12px] text-[#1B3A5C]/60 mt-1">
                      Vink uit wat je niet wilt — alleen aangevinkte regels worden geïmporteerd.
                    </p>
                  </div>
                  <button onClick={importMatches} disabled={importing || (selectedCount === 0 && ambigPickedCount === 0)}
                    className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50">
                    {importing ? 'Importeren...' : `✓ Importeer ${selectedCount + ambigPickedCount} ${(selectedCount + ambigPickedCount) === 1 ? 'kandidaat' : 'kandidaten'}`}
                  </button>
                </div>

                {/* Snelle selectie-knoppen */}
                <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px]">
                  <span className="text-[#1B3A5C]/60">Snelle selectie:</span>
                  <button onClick={() => setSelectedMatches(new Set(allMatches.map(getMatchKey)))}
                    className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-[#1B3A5C]/80 font-semibold">
                    Alles ({allMatches.length})
                  </button>
                  <button onClick={() => selectByScore(85)}
                    className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-semibold">
                    Alleen score 85+ ({allMatches.filter(m => m.score >= 85).length})
                  </button>
                  <button onClick={() => selectByScore(70)}
                    className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold">
                    Score 70+ ({allMatches.filter(m => m.score >= 70).length})
                  </button>
                  <button onClick={() => setSelectedMatches(new Set())}
                    className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold">
                    Niets
                  </button>
                  <span className="ml-auto text-[#1B3A5C]/50">
                    {selectedCount} van {allMatches.length} geselecteerd
                  </span>
                </div>

                <MatchTable
                  matches={allMatches.slice(0, visibleCount)}
                  selectedKeys={selectedMatches}
                  onToggle={toggleOne}
                  onToggleAll={toggleAll}
                  allSelected={allSelected}
                  someSelected={someSelected}
                />
                {allMatches.length > visibleCount && (
                  <div className="mt-3 text-center">
                    <button onClick={() => setVisibleCount(c => c + 200)}
                      className="px-4 py-1.5 rounded-lg bg-blue-100 text-blue-800 text-[12px] font-semibold hover:bg-blue-200">
                      Toon volgende 200 ({allMatches.length - visibleCount} verborgen)
                    </button>
                    <p className="text-[10px] text-[#1B3A5C]/40 mt-1">
                      Niet-getoonde rijen zijn nog steeds geselecteerd voor import.
                      Filter op score om de set te beperken.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {matchResult.ambiguous > 0 && matchResult.ambiguousList && (
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-4">
              <div className="mb-3">
                <h2 className="text-[16px] font-bold text-[#1B3A5C]">
                  Ambigue transacties ({matchResult.ambiguous})
                </h2>
                <p className="text-[12px] text-[#1B3A5C]/60 mt-1">
                  Voor deze transacties zijn meerdere portal-facturen mogelijk. Standaard staat
                  de top-kandidaat geselecteerd; je kunt per regel een ander kiezen of skippen.
                  Worden samen met de unique matches geïmporteerd.
                </p>
              </div>
              <AmbigTable
                ambigList={matchResult.ambiguousList}
                ambigChoice={ambigChoice}
                onChoice={(txKey, val) => setAmbigChoice(prev => ({ ...prev, [txKey]: val }))}
              />
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
          <p className="text-[13px] text-emerald-900 mb-3">
            MCB: {fmtNum(importDone.mcb)} · RBC: {fmtNum(importDone.rbc)}
            {importDone.fromAmbig > 0 && ` · ${fmtNum(importDone.fromAmbig)} uit ambigue keuzes`}
          </p>
          <Link href="/dashboard/finance/sandbox-ap/match/worklist"
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

function MatchTable({ matches, selectedKeys, onToggle, onToggleAll, allSelected, someSelected }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="w-10 p-2">
              <input type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
                onChange={onToggleAll}
                className="cursor-pointer" />
            </th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank</th>
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
          {matches.map((m, i) => {
            const key = getMatchKey(m);
            const checked = selectedKeys.has(key);
            return (
              <tr key={i} onClick={() => onToggle(key)}
                className={`border-b border-gray-100 cursor-pointer transition-all ${
                  checked ? 'bg-blue-50/40' : 'bg-gray-50/30 hover:bg-gray-50/60'
                }`}>
                <td className="p-2" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(key)} className="cursor-pointer" />
                </td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    m.tx.bank === 'mcb' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>{m.tx.bank?.toUpperCase()}</span>
                </td>
                <td className="p-2 text-[#1B3A5C]/70">{fmtDate(m.tx.date)}</td>
                <td className="p-2 text-[11px] text-[#1B3A5C]/80" title={m.tx.description}>
                  {m.vendorName}
                  {m.reference && <div className="text-[10px] text-[#1B3A5C]/40 font-mono">ref: {m.reference}</div>}
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="font-semibold text-[#1B3A5C]">{m.invoice.vendor_name}</div>
                    {m.aliasInfo && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 cursor-help"
                        title={m.aliasInfo}>
                        🔗 alias
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{m.invoice.vendor_id}</div>
                </td>
                <td className="p-2 font-mono text-[#1B3A5C]">{m.invoice.invoice_number}</td>
                <td className="p-2 text-right font-mono">{fmtMoney(m.tx.amount)}</td>
                <td className="p-2 text-right font-mono text-[#1B3A5C]/70">
                  {fmtMoney(parseFloat(m.invoice.original_amount) || Math.abs(parseFloat(m.invoice.balance)))}
                </td>
                <td className="p-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    m.score >= 85 ? 'bg-emerald-100 text-emerald-700' :
                    m.score >= 70 ? 'bg-amber-100 text-amber-700' :
                    m.score >= 55 ? 'bg-orange-100 text-orange-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {Math.round(m.score)}
                  </span>
                </td>
              </tr>
            );
          })}
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
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank</th>
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
              <td className="p-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  u.tx.bank === 'mcb' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                }`}>{u.tx.bank?.toUpperCase()}</span>
              </td>
              <td className="p-2 text-[#1B3A5C]/70 whitespace-nowrap">{fmtDate(u.tx.date)}</td>
              <td className="p-2 text-[11px] text-[#1B3A5C]/80">{u.vendorName || '—'}</td>
              <td className="p-2 text-[11px] text-[#1B3A5C]/60" title={u.tx.extraLines.join(' | ')}>
                {u.tx.description}
              </td>
              <td className="p-2 text-right font-mono">{fmtMoney(u.tx.amount)}</td>
              <td className="p-2 text-rose-700/80 text-[11px]">
                {u.reason}
                {u.hint && <div className="text-[10px] text-[#1B3A5C]/60 italic mt-0.5">→ {u.hint}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function AmbigTable({ ambigList, ambigChoice, onChoice }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Datum</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Bank vendor</th>
            <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Bedrag</th>
            <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Kies portal-factuur</th>
          </tr>
        </thead>
        <tbody>
          {ambigList.map((a, i) => {
            const txKey = `ambig_${i}_${a.tx.bank}_${a.tx.date}_${Math.round(a.tx.amount * 100)}`;
            const choice = ambigChoice[txKey] || '__skip__';
            return (
              <tr key={i} className={`border-b border-gray-100 ${choice !== '__skip__' ? 'bg-emerald-50/30' : 'bg-gray-50/30'}`}>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    a.tx.bank === 'mcb' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>{a.tx.bank?.toUpperCase()}</span>
                </td>
                <td className="p-2 text-[#1B3A5C]/70 whitespace-nowrap">{fmtDate(a.tx.date)}</td>
                <td className="p-2 text-[11px] text-[#1B3A5C]/80" title={a.tx.description}>
                  {a.vendorName}
                </td>
                <td className="p-2 text-right font-mono">{fmtMoney(a.tx.amount)}</td>
                <td className="p-2">
                  <select value={choice} onChange={e => onChoice(txKey, e.target.value)}
                    className="px-2 py-1 rounded border border-gray-200 text-[11px] bg-white max-w-[420px]">
                    <option value="__skip__">— skip (niet importeren)</option>
                    {a.candidates.map((c, ci) => (
                      <option key={ci} value={String(c.invoice.id)}>
                        {c.invoice.invoice_number} · {fmtMoney(parseFloat(c.invoice.balance))} {c.invoice.currency || ''} · {c.invoice.invoice_date || '?'} · score {Math.round(c.score)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
