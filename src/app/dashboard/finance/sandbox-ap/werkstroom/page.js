/* ============================================================
   BESTAND: sandbox_ap_werkstroom_page_v23.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/werkstroom/page.js
   (overschrijft sandbox v22, hernoemen naar page.js)
   🧪 SANDBOX-MIRROR van productie v23 — regel-voor-regel identiek aan live,
   alleen aangepast:
   - alle ap_*-tabellen           → sandbox_ap_*  (profiles blijft gedeeld)
   - route /dashboard/finance/ap  → /dashboard/finance/sandbox-ap


   v23 WIJZIGINGEN:
   - Tab-label 'Klaar voor betaling' → 'Verzenden naar bank'.
   - Modal-bevestigknop 'Maak batch' → 'In bank gezet'.

   v22 WIJZIGINGEN:
   - BankPromptModal gebouwd: "Naar bank" opent nu een modal met bank-keuze
     (MCB / RBC / RBC_USD / BC / Multimart / RBC_Bonaire) i.p.v. direct te
     falen op de ontbrekende extra.bank. Bevestigen maakt de batch en zet
     de facturen door naar batch_pending_1 (Bij goedkeurder 1).

   v21 WIJZIGINGEN:
   - Tab-knoppen worden grijs/gedimmed voor rollen die in die tab geen actie
     kunnen doen. Klikken werkt nog wel — kijken is altijd toegestaan.
   - Migreerde records (oud approver_review) zonder batch_id worden nu correct
     getoond in tab "Bij goedkeurder 1". Eerder kon de UI niet om met NULL batch.
   - Migratie van 1x oude approver_review record: batch_id krijgt nu een
     placeholder zodat hij in de UI verschijnt.

   v20 WIJZIGINGEN (BELANGRIJK):
   - Nieuwe rolverdeling: ap_clerk, ap_approver, ap_bank, admin
   - 7-staps werkstroom met 4-OGEN principe:
     1. Openstaand (clerk)
     2. Verzenden naar bank (clerk)
     3. Bij goedkeurder 1 (approver)
     4. Bij goedkeurder 2 (bank)
     5. Vrijgegeven (clerk gaat naar bank)
     6. Betaald in bank (clerk markeert na afschrift)
     7. Afgeletterd (via Eagle agent)
   - Quick-Pay knoppen verschoven naar 'ap_bank' + 'admin'
   - assigned_ap_clerk filter VERWIJDERD — alle clerks zien alles
   - 4-eyes check: goedkeurder #2 mag niet zelfde zijn als #1
     batch_created_by mag niet beide goedkeuringen geven
   - Batch-concept: bij "Naar bank" krijgt elke factuur batch_id + batch_bank
   - VEREIST: migrate_v2_productie.sql moet eerst gedeployd zijn

   v19 WIJZIGINGEN:
   - source='manual' (constraint-veilig). Bank-info naar match_meta JSON.
   - notes kolom niet meer in insert (bestaat niet altijd).

   v18 WIJZIGINGEN:
   - confidence is TEXT in DB (ARRAY['exact','fuzzy','manual']) — alle
     handmatige acties gebruiken nu 'manual' i.p.v. numerieke waarde.

   v17 WIJZIGINGEN:
   - 'Markeer extern betaald' krijgt nu ook een bank-select (verplicht,
     net als bij MCB/RBC direct). Reden wordt optioneel.
   - Confidence-waarde voor match_candidate insert is 0.99 i.p.v. 1.0
     (de CHECK constraint is < 1.0 strikt — 1.0 zelf wordt geweigerd).
   - Bij silent failures van candidate-insert verschijnt nu een waarschuwing
     in de UI in plaats van alleen console.error.

   v16 WIJZIGINGEN:
   - Quick-Pay knoppen "💳 MCB direct" en "💳 RBC direct" voor admin/CFO
     op tab Openstaand: factuur in 1 klik op status 'paid' zetten met
     bank + datum (default vandaag), enter bevestigt.
   - Nieuwe kolom: paid_bank (run ap_schema_v13_paid_bank.sql eerst).
   - Bij direct-pay: automatisch een match_candidate aangemaakt met
     source 'direct_pay_mcb' / 'direct_pay_rbc' en status 'confirmed'.
     AP clerk vindt dit in afletterlijst om af te wikkelen in Eagle.

   v15 WIJZIGINGEN:
   - Partial payment ondersteuning: bij selectie op 'Openstaand' tab
     verschijnt rechts een input-veld met standaard de volledige balance.
     AP Clerk kan dit aanpassen naar het werkelijke te betalen bedrag.
   - Nieuw veld in database: selected_amount (kolom op ap_invoices).
     Vereist run van ap_schema_v12_selected_amount.sql.
   - Doorgegeven aan vervolgfases: approver ziet aangepast bedrag.

   v14 WIJZIGINGEN:
   - Elke fase is terug te draaien naar de voorgaande fase door de
     functionaris die hem heeft uitgevoerd OF door admin.
     Knoppen "↶ Trek terug" verschijnen op elk tabblad:
       · Bij goedkeurder → terug naar Klaar voor indiening  (door indiener / admin)
       · Goedgekeurd     → terug naar Bij goedkeurder       (door goedkeurder / admin)
       · Bij bank        → terug naar Goedgekeurd           (alleen admin)
       · Betaald         → terug naar Bij bank              (door CFO / admin)
   - Audit-log entry per terugdraai (action: 'rolled_back_*')

   v13 WIJZIGINGEN:
   - ALLE tabel-kolommen klikbaar om te sorteren (was: 4 van 11).
     Factuur, Referentie, PO Nummer, Type, Origineel bedrag,
     Ingediend door en Goedgekeurd door komen erbij.
   - Tweede klik op een actieve kolom draait de sortering om.
   - Voor "Origineel" / "Saldo": default groot→klein.

   v12 WIJZIGINGEN:
   - Datum-filter prominenter: eigen blok onder de filters,
     duidelijk zichtbaar met betere styling.
   - Quick presets: "Na 1/1/2026", "Recent 30 dagen", "Verlopen",
     "Lopende maand", "Wis datums".
   - Default veld is "Factuurdatum" (vaker gebruikt dan vervaldatum).

   v11 WIJZIGINGEN:
   - Multi-select voor vendors (search + checkboxes); handig bij
     BDMM/alias-groepen (typ "bdmm", selecteer alle 8 in 1 klik).
   - Klikbare kolom-headers voor sorteren: Vendor / Factuurdatum
     / Origineel / Saldo / Vervaldatum. Klik op header → sorteer,
     klik nogmaals → omdraaien. Bedrag standaard groot→klein.
   - Excel export-knop bovenaan voor huidige (gefilterde) lijst.
     Vereist "xlsx" in package.json (al aanwezig).

   v10: ROLLBACK match-indicator op tab "Openstaand" — gaf bij Jeroen
     'ReferenceError: matchCandidate is not defined' in production build,
     mogelijk door Vercel build-cache van eerdere bug.
     Match-feature komt terug in latere versie (apart geïsoleerd).
     Methode 4 (Markeer extern betaald) blijft behouden.

   WIJZIGINGEN T.O.V. v8:
   - "🎯 Match" badge op tab "Openstaand" voor facturen die een
     pending/confirmed match candidate hebben. Toont bron (PCS/MCB
     etc) + score. AP Clerk ziet direct welke facturen waarschijnlijk
     al betaald zijn.
   - Hover op badge toont datum + bedrag van match.
   
   WIJZIGINGEN T.O.V. v7:
   - Methode 4 toegevoegd: bulk-actie "Markeer extern betaald"
     voor admin/cfo op tab "Openstaand". Modal voor datum + reden.
     Maakt match_candidate met source='manual', status='confirmed'
     in één keer. Plus status='paid' op de invoice.
   
   WIJZIGINGEN T.O.V. v6:
   - Vendor dropdown: aparte selectie ipv typen (browser-native
     keyboard nav + scroll). Geen filter-trigger bij elke toets.
   - Debounced search: filter wacht 300ms na laatste toetsaanslag
     voordat hij zoekt. Veel sneller en niet meer laggy bij typen.
   - clearFilters wist ook vendor-selectie en search input.
   
   WIJZIGINGEN T.O.V. v5:
   - Extra kolommen in tabel: Invoice Date, Reference, PO Number,
     Original Amount (naast Current Balance)
   - Datum-range filter: kies veld (Vervaldatum/Factuurdatum) +
     van/tot datums
   - Verbeterde zoekbox: ook in reference en PO
   - "Wis filters" knop om snel terug naar default
   
   WIJZIGINGEN T.O.V. v4:
   - WERKSTROOM CORRECTIE:
     · Tab "In batch" verwijderd, "Bij bank" toegevoegd (status='at_bank')
     · AP Clerk actie op "Goedgekeurd": "Markeer verzonden naar bank"
     · CFO/Admin actie op "Bij bank": "Bevestig betaald"
   - PERFORMANCE:
     · Per-tab fetching: alleen rijen voor actieve tab geladen
     · Tab-counts via 5 parallelle COUNT queries (Promise.all)
     · Optimistic updates: UI past direct aan na actie
     · Caching: switchen tussen tabs is instant na eerste load
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useApRole } from '../layout';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
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

const STATUS_TABS = [
  { key: 'open',                 label: 'Openstaand',           color: 'gray' },
  { key: 'selected',             label: 'Verzenden naar bank',  color: 'blue' },
  { key: 'batch_pending_1',      label: 'Bij goedkeurder 1',    color: 'amber' },
  { key: 'batch_pending_2',      label: 'Bij goedkeurder 2',    color: 'orange' },
  { key: 'approved_for_payment', label: 'Vrijgegeven',          color: 'emerald' },
  { key: 'paid_in_bank',         label: 'Betaald in bank',      color: 'purple' },
  { key: 'reconciled',           label: 'Afgeletterd',          color: 'slate' },
];

const TAB_BADGE = {
  gray:    'bg-gray-200 text-gray-700',
  blue:    'bg-blue-200 text-blue-800',
  amber:   'bg-amber-200 text-amber-800',
  orange:  'bg-orange-200 text-orange-800',
  emerald: 'bg-emerald-200 text-emerald-800',
  purple:  'bg-purple-200 text-purple-800',
  slate:   'bg-slate-200 text-slate-800',
};

// v21: per stage welke rollen een actie kunnen doen.
// Rollen die er NIET in staan zien de tab grijs (mogen kijken, geen actie).
const TAB_ACTION_ROLES = {
  'open':                 ['admin', 'ap_clerk', 'ap_bank'],   // clerk selecteert, bank quick-pay
  'selected':             ['admin', 'ap_clerk'],              // clerk stuurt naar bank
  'batch_pending_1':      ['admin', 'ap_approver'],           // goedkeurder 1
  'batch_pending_2':      ['admin', 'ap_bank'],               // goedkeurder 2
  'approved_for_payment': ['admin', 'ap_clerk'],              // clerk bevestigt betaling
  'paid_in_bank':         ['admin', 'ap_clerk'],              // clerk afletteren
  'reconciled':           ['admin'],                          // eindstation
};

function tabHasAction(tabKey, role) {
  const allowedRoles = TAB_ACTION_ROLES[tabKey] || [];
  return allowedRoles.includes(role);
}

function fmtMoney(n) {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}
function fmtNum(n) {
  return new Intl.NumberFormat('nl-NL').format(n);
}
function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

const SELECT_COLS = 'id, vendor_id, vendor_name, invoice_number, voucher, type, balance, original_amount, currency, invoice_date, due_date, reference, po_number, status, assigned_ap_clerk, selected_by, submitted_by, approved_by, rejection_reason, rejected_at, rejected_by, paid_by, paid_at, selected_amount, paid_bank, batch_id, batch_bank, batch_created_at, batch_created_by, approver_1_at, approver_1_by, approver_2_at, approver_2_by, reconciled_by_clerk_at, reconciled_by_clerk_by';

export default function WerkstroomPage() {
  const { actualProfile, effectiveProfileId, effectiveRole, effectiveName, isPlayingRole } = useApRole();
  const supabase = createClient();
  const isClerk = effectiveRole === 'ap_clerk';
  const isAdmin = effectiveRole === 'admin';
  const isApprover = effectiveRole === 'ap_approver';
  const isBank = effectiveRole === 'ap_bank';

  // v20: nieuwe capability matrix voor 4-rollen werkstroom
  const canSelectForPayment   = ['admin', 'ap_clerk'].includes(effectiveRole);  // open → selected
  const canSendToBank         = ['admin', 'ap_clerk'].includes(effectiveRole);  // selected → batch_pending_1 (was 'naar bank')
  const canApprove1           = ['admin', 'ap_approver'].includes(effectiveRole);  // batch_pending_1 → batch_pending_2 (goedkeuring 1)
  const canApprove2           = ['admin', 'ap_bank'].includes(effectiveRole);   // batch_pending_2 → approved_for_payment (goedkeuring 2)
  const canMarkPaidInBank     = ['admin', 'ap_clerk'].includes(effectiveRole);  // approved_for_payment → paid_in_bank
  const canMarkReconciled     = ['admin', 'ap_clerk'].includes(effectiveRole);  // paid_in_bank → reconciled (via Eagle)
  const canReject             = ['admin', 'ap_approver', 'ap_bank'].includes(effectiveRole);
  const canQuickPay           = ['admin', 'ap_bank'].includes(effectiveRole);   // MCB/RBC direct
  const canManualWriteoff     = ['admin'].includes(effectiveRole);
  const canRollback           = isAdmin;  // alleen admin mag stages terugdraaien

  // Aliassen voor backwards-compat met bestaande code (kan later opgeruimd)
  const canApprove = canApprove1 || canApprove2;  // generieke "kan goedkeuren"
  const canMarkPaid = canQuickPay;  // oude naam, nu = Quick-Pay capability

  // Lokaal berekende capabilities — geen context-afhankelijkheid



  const [tab, setTab] = useState('open');
  const [tabCounts, setTabCounts] = useState({});
  const [tabRows, setTabRows] = useState({});  // {status: [rows]}
  const [userNames, setUserNames] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingTab, setLoadingTab] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // V15: per-rij custom betalingsbedrag (Map<id, number>). Default = balance.
  const [customAmounts, setCustomAmounts] = useState(new Map());
  // V16: quick-pay modal voor admin/CFO
  const [showQuickPayModal, setShowQuickPayModal] = useState(null); // null | 'MCB' | 'RBC'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false); // v22: bank-keuze bij "Naar bank"

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [vendorSelected, setVendorSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [allVendors, setAllVendors] = useState([]);
  const [sortBy, setSortBy] = useState('due_date');
  const [sortDesc, setSortDesc] = useState(false);
  const [dateField, setDateField] = useState('invoice_date');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Vendors ophalen voor de dropdown (eenmalig)
  useEffect(() => {
    let cancelled = false;
    async function loadVendors() {
      const data = await fetchAllPaginated(() =>
        supabase.from('sandbox_ap_vendors').select('vendor_id, vendor_name').order('vendor_name')
      );
      if (!cancelled) setAllVendors(data || []);
    }
    loadVendors();
    return () => { cancelled = true; };
  }, [supabase]);

  // Debounce de search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Counts laden (parallel)
  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const queries = STATUS_TABS.map(t => {
        let q = supabase
          .from('sandbox_ap_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', t.key);
        return q;
      });
      const results = await Promise.all(queries);
      const counts = {};
      STATUS_TABS.forEach((t, i) => {
        counts[t.key] = results[i].count || 0;
      });
      setTabCounts(counts);
    } catch (e) {
      console.error('loadCounts error:', e);
    } finally {
      setLoadingCounts(false);
    }
  }, [supabase, effectiveProfileId, isClerk]);

  // Rijen voor één status laden
  const loadTabRows = useCallback(async (statusKey) => {
    setLoadingTab(true);
    try {
      const rows = await fetchAllPaginated(() => {
        let q = supabase
          .from('sandbox_ap_invoices')
          .select(SELECT_COLS)
          .eq('status', statusKey);
        return q;
      });
      setTabRows(prev => ({ ...prev, [statusKey]: rows }));

      // Profile-namen voor selected_by/submitted_by/approved_by/rejected_by
      const userIds = new Set();
      for (const r of rows) {
        if (r.selected_by) userIds.add(r.selected_by);
        if (r.submitted_by) userIds.add(r.submitted_by);
        if (r.approved_by) userIds.add(r.approved_by);
        if (r.paid_by) userIds.add(r.paid_by);
        if (r.rejected_by) userIds.add(r.rejected_by);
      }
      if (userIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(userIds));
        if (profs) {
          setUserNames(prev => {
            const next = { ...prev };
            for (const p of profs) next[p.id] = p.full_name;
            return next;
          });
        }
      }
    } catch (e) {
      setError(e.message || 'Onbekende fout bij laden');
    } finally {
      setLoadingTab(false);
    }
  }, [supabase, effectiveProfileId, isClerk]);

  // Initial + bij role-switch: counts + huidige tab
  useEffect(() => {
    setTabRows({});
    loadCounts();
    loadTabRows(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProfileId, isClerk]);

  // Tab-switch: rijen laden als nog niet gecached
  useEffect(() => {
    setSelectedIds(new Set());
    if (!tabRows[tab]) {
      loadTabRows(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const currentInvoices = useMemo(() => {
    const rows = tabRows[tab] || [];
    let filtered = rows;
    // Vendor multi-select filter
    if (vendorSelected.size > 0) {
      filtered = filtered.filter(r => vendorSelected.has(String(r.vendor_id)));
    }
    // Tekst-zoek (debounced) — niet vendor (die gaat via dropdown)
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      filtered = filtered.filter(r =>
        (r.invoice_number || '').toLowerCase().includes(q) ||
        (r.voucher || '').includes(q) ||
        (r.reference || '').toLowerCase().includes(q) ||
        (r.po_number || '').toLowerCase().includes(q)
      );
    }
    // Datum-range filter
    if (dateFrom || dateTo) {
      filtered = filtered.filter(r => {
        const v = r[dateField];
        if (!v) return false;
        if (dateFrom && v < dateFrom) return false;
        if (dateTo && v > dateTo) return false;
        return true;
      });
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'vendor':
          cmp = (a.vendor_name || '').localeCompare(b.vendor_name || '');
          break;
        case 'invoice_number':
          cmp = (a.invoice_number || '').localeCompare(b.invoice_number || '');
          break;
        case 'invoice_date':
          cmp = (a.invoice_date || '9999').localeCompare(b.invoice_date || '9999');
          break;
        case 'reference':
          cmp = (a.reference || '').localeCompare(b.reference || '');
          break;
        case 'po_number':
          cmp = (a.po_number || '').localeCompare(b.po_number || '');
          break;
        case 'type':
          cmp = (a.type || '').localeCompare(b.type || '');
          break;
        case 'original_amount':
          cmp = Math.abs(parseFloat(a.original_amount) || 0) - Math.abs(parseFloat(b.original_amount) || 0);
          break;
        case 'amount':
          cmp = Math.abs(parseFloat(a.balance) || 0) - Math.abs(parseFloat(b.balance) || 0);
          break;
        case 'due_date':
          cmp = (a.due_date || '9999').localeCompare(b.due_date || '9999');
          break;
        case 'submitted_by':
          cmp = (userNames[a.submitted_by] || '').localeCompare(userNames[b.submitted_by] || '');
          break;
        case 'approved_by':
          cmp = (userNames[a.approved_by] || '').localeCompare(userNames[b.approved_by] || '');
          break;
        default:
          break;
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [tabRows, tab, debouncedSearch, vendorSelected, sortBy, sortDesc, dateField, dateFrom, dateTo, userNames]);

  const hasFilters = vendorSelected.size > 0 || searchInput.trim() || dateFrom || dateTo;
  function clearFilters() {
    setSearchInput('');
    setVendorSelected(new Set());
    setDateFrom('');
    setDateTo('');
  }

  function clearDates() {
    setDateFrom('');
    setDateTo('');
  }

  function applyDatePreset(preset) {
    const today = new Date();
    const fmt = d => d.toISOString().substring(0, 10);
    if (preset === 'after_2026') {
      setDateFrom('2026-01-01');
      setDateTo('');
    } else if (preset === 'recent_30') {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      setDateField('invoice_date');
      setDateFrom(fmt(d));
      setDateTo('');
    } else if (preset === 'overdue') {
      // Verlopen = vervaldatum < vandaag
      setDateField('due_date');
      setDateFrom('');
      setDateTo(fmt(today));
    } else if (preset === 'this_month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      setDateField('invoice_date');
      setDateFrom(fmt(start));
      setDateTo(fmt(end));
    } else if (preset === 'this_year') {
      const start = new Date(today.getFullYear(), 0, 1);
      setDateField('invoice_date');
      setDateFrom(fmt(start));
      setDateTo('');
    }
  }

  function handleSort(field) {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      // Bedragen default desc (groot→klein), datums + tekst default asc
      setSortDesc(field === 'amount' || field === 'original_amount');
    }
  }

  async function exportToExcel() {
    if (currentInvoices.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const tabLabel = STATUS_TABS.find(t => t.key === tab)?.label || tab;
      const rows = currentInvoices.map(i => ({
        'Vendor': i.vendor_name,
        'Vendor #': i.vendor_id,
        'Factuurnummer': i.invoice_number,
        'Voucher': i.voucher,
        'Type': i.type,
        'Factuurdatum': i.invoice_date || '',
        'Vervaldatum': i.due_date || '',
        'Referentie': i.reference || '',
        'PO Nummer': i.po_number || '',
        'Currency': i.currency || '',
        'Origineel bedrag': parseFloat(i.original_amount) || null,
        'Saldo': parseFloat(i.balance),
        'Status': i.status,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 30 }, { wch: 9 }, { wch: 18 }, { wch: 10 }, { wch: 14 },
        { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 6 },
        { wch: 14 }, { wch: 14 }, { wch: 16 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, tabLabel);
      const dt = new Date().toISOString().substring(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `werkstroom_${tab}_${dt}.xlsx`);
    } catch (e) {
      setError(`Export fout: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
      const m = new Map(customAmounts); m.delete(id); setCustomAmounts(m);
    } else {
      next.add(id);
      const inv = currentInvoices.find(r => r.id === id);
      if (inv) {
        const m = new Map(customAmounts); m.set(id, parseFloat(inv.balance) || 0); setCustomAmounts(m);
      }
    }
    setSelectedIds(next);
  }
  function setCustomAmount(id, value) {
    const m = new Map(customAmounts); m.set(id, value); setCustomAmounts(m);
  }
  function selectAll() {
    setSelectedIds(new Set(currentInvoices.map(i => i.id)));
    setCustomAmounts(new Map(currentInvoices.map(r => [r.id, parseFloat(r.balance) || 0])));
  }
  function deselectAll() {
    setSelectedIds(new Set());
    setCustomAmounts(new Map());
  }

  async function doAction(actionKey, extra = {}) {
    setBusy(true);
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) throw new Error('Geen facturen geselecteerd');

      const now = new Date().toISOString();
      let newStatus, auditAction;
      const extraFields = {};
      const clearRejection = { rejection_reason: null, rejected_at: null, rejected_by: null };

      if (actionKey === 'select') {
        // open → selected (clerk maakt wensenlijst)
        newStatus = 'selected';
        auditAction = 'selected';
        extraFields.selected_at = now;
        extraFields.selected_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'send_to_bank') {
        // selected → batch_pending_1 — clerk kiest bank + maakt batch
        if (!extra.bank || !['MCB', 'RBC', 'RBC_USD', 'BC', 'Multimart', 'RBC_Bonaire'].includes(extra.bank)) {
          throw new Error('Bank moet gekozen worden voor "Naar bank" actie');
        }
        newStatus = 'batch_pending_1';
        auditAction = 'sent_to_bank';
        // Genereer 1 batch_id voor deze bulk-actie
        const batchId = crypto.randomUUID();
        extraFields.batch_id = batchId;
        extraFields.batch_bank = extra.bank;
        extraFields.batch_created_at = now;
        extraFields.batch_created_by = actualProfile.id;
        extraFields.submitted_at = now;
        extraFields.submitted_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'approve_1') {
        // batch_pending_1 → batch_pending_2 (goedkeuring 1 door approver)
        newStatus = 'batch_pending_2';
        auditAction = 'approved_1';
        extraFields.approver_1_at = now;
        extraFields.approver_1_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'approve_2') {
        // batch_pending_2 → approved_for_payment (goedkeuring 2 door bank)
        // 4-EYES CHECK: goedkeurder 2 ≠ goedkeurder 1 ≠ batch_creator
        if (!isAdmin) {
          const { data: checkRows } = await supabase
            .from('sandbox_ap_invoices')
            .select('id, approver_1_by, batch_created_by')
            .in('id', ids);
          const violation = (checkRows || []).find(r => 
            r.approver_1_by === actualProfile.id || r.batch_created_by === actualProfile.id
          );
          if (violation) {
            throw new Error('4-ogen principe: u kunt geen batch goedkeuren waarvan u zelf de eerste goedkeuring of batch-creatie heeft gedaan.');
          }
        }
        newStatus = 'approved_for_payment';
        auditAction = 'approved_2';
        extraFields.approver_2_at = now;
        extraFields.approver_2_by = actualProfile.id;
        // Behoud approved_at/approved_by voor backwards compat
        extraFields.approved_at = now;
        extraFields.approved_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'reject') {
        // afkeur door approver 1 of 2 → terug naar 'open' (clerk moet opnieuw selecteren)
        if (!extra.reason || !extra.reason.trim()) throw new Error('Afwijs-reden is verplicht');
        newStatus = 'open';
        auditAction = 'rejected';
        extraFields.selected_at = null;
        extraFields.selected_by = null;
        extraFields.submitted_at = null;
        extraFields.submitted_by = null;
        extraFields.batch_id = null;
        extraFields.batch_bank = null;
        extraFields.batch_created_at = null;
        extraFields.batch_created_by = null;
        extraFields.approver_1_at = null;
        extraFields.approver_1_by = null;
        extraFields.rejection_reason = extra.reason;
        extraFields.rejected_at = now;
        extraFields.rejected_by = actualProfile.id;
      } else if (actionKey === 'mark_paid_in_bank') {
        // approved_for_payment → paid_in_bank (clerk bevestigt op afschrift)
        newStatus = 'paid_in_bank';
        auditAction = 'marked_paid_in_bank';
        extraFields.paid_at = now;
        extraFields.paid_by = actualProfile.id;
      } else if (actionKey === 'mark_reconciled') {
        // paid_in_bank → reconciled (na Eagle afletter)
        newStatus = 'reconciled';
        auditAction = 'marked_reconciled';
        extraFields.reconciled_by_clerk_at = now;
        extraFields.reconciled_by_clerk_by = actualProfile.id;
      } else if (actionKey === 'quick_pay') {
        // Quick-Pay direct: open → paid + bank + datum (door ap_bank of admin)
        if (!extra.bank || !['MCB', 'RBC'].includes(extra.bank)) {
          throw new Error('Bank moet MCB of RBC zijn');
        }
        if (!extra.paidDate) throw new Error('Betaaldatum ontbreekt');
        newStatus = 'paid';
        auditAction = 'direct_paid';
        extraFields.paid_at = new Date(extra.paidDate + 'T12:00:00').toISOString();
        extraFields.paid_by = actualProfile.id;
        extraFields.paid_bank = extra.bank;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'manual_writeoff') {
        // Admin-only: bank + datum verplicht
        if (!extra.bank || !['MCB', 'RBC', 'RBC_USD', 'BONAIRE', 'MULTIMART', 'BDC'].includes(extra.bank)) {
          throw new Error('Bank moet gekozen worden (MCB/RBC/etc)');
        }
        if (!extra.paidDate) throw new Error('Betaaldatum is verplicht');
        newStatus = 'paid';
        auditAction = 'manual_writeoff';
        extraFields.paid_at = extra.paidDate;
        extraFields.paid_by = actualProfile.id;
        extraFields.paid_bank = extra.bank;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'unselect') {
        // Rollback: selected → open
        newStatus = 'open';
        auditAction = 'rolled_back_select';
        extraFields.selected_at = null;
        extraFields.selected_by = null;
        extraFields.selected_amount = null;
      } else if (actionKey === 'unsend_to_bank') {
        // Rollback: batch_pending_1 → selected (admin only)
        newStatus = 'selected';
        auditAction = 'rolled_back_send_to_bank';
        extraFields.batch_id = null;
        extraFields.batch_bank = null;
        extraFields.batch_created_at = null;
        extraFields.batch_created_by = null;
        extraFields.submitted_at = null;
        extraFields.submitted_by = null;
      } else if (actionKey === 'unapprove_1') {
        // Rollback: batch_pending_2 → batch_pending_1 (approver of admin)
        newStatus = 'batch_pending_1';
        auditAction = 'rolled_back_approve_1';
        extraFields.approver_1_at = null;
        extraFields.approver_1_by = null;
      } else if (actionKey === 'unapprove_2') {
        // Rollback: approved_for_payment → batch_pending_2 (bank of admin)
        newStatus = 'batch_pending_2';
        auditAction = 'rolled_back_approve_2';
        extraFields.approver_2_at = null;
        extraFields.approver_2_by = null;
        extraFields.approved_at = null;
        extraFields.approved_by = null;
      } else if (actionKey === 'unmark_paid_in_bank') {
        // Rollback: paid_in_bank → approved_for_payment (clerk of admin)
        newStatus = 'approved_for_payment';
        auditAction = 'rolled_back_mark_paid_in_bank';
        extraFields.paid_at = null;
        extraFields.paid_by = null;
      } else if (actionKey === 'unmark_reconciled') {
        // Rollback: reconciled → paid_in_bank (admin)
        newStatus = 'paid_in_bank';
        auditAction = 'rolled_back_mark_reconciled';
        extraFields.reconciled_by_clerk_at = null;
        extraFields.reconciled_by_clerk_by = null;
      } else {
        throw new Error('Onbekende actie: ' + actionKey);
      }

      // Permission check voor rollback acties (non-admin)
      if (['unselect', 'unsend_to_bank', 'unapprove_1', 'unapprove_2', 'unmark_paid_in_bank'].includes(actionKey) && !isAdmin) {
        const fieldMap = {
          unselect: 'selected_by',
          unsend_to_bank: 'batch_created_by',
          unapprove_1: 'approver_1_by',
          unapprove_2: 'approver_2_by',
          unmark_paid_in_bank: 'paid_by',
        };
        const field = fieldMap[actionKey];
        const { data: checkRows, error: chkErr } = await supabase
          .from('sandbox_ap_invoices')
          .select(`id, ${field}`)
          .in('id', ids);
        if (chkErr) throw chkErr;
        const notMine = (checkRows || []).filter(r => r[field] !== actualProfile.id);
        if (notMine.length > 0) {
          throw new Error(
            `Je kunt alleen je eigen handelingen terugdraaien — ` +
            `${notMine.length} van ${ids.length} ${notMine.length === 1 ? 'is' : 'zijn'} ` +
            `door een collega ingediend. Vraag admin of de oorspronkelijke functionaris.`
          );
        }
      }
      if (actionKey === 'unsend_to_bank' && !isAdmin) {
        throw new Error('Terugdraaien vanuit "Bij bank" kan alleen door admin.');
      }

      // Optimistic update: rijen verwijderen uit huidige tab + counts aanpassen
      setTabRows(prev => {
        const next = { ...prev };
        if (next[tab]) next[tab] = next[tab].filter(r => !ids.includes(r.id));
        return next;
      });
      setTabCounts(prev => {
        const next = { ...prev };
        next[tab] = Math.max(0, (next[tab] || 0) - ids.length);
        if (next[newStatus] !== undefined) next[newStatus] = (next[newStatus] || 0) + ids.length;
        return next;
      });
      setSelectedIds(new Set());
      setShowRejectModal(false);

      // Async: DB update
      const { error: updErr } = await supabase
        .from('sandbox_ap_invoices')
        .update({
          status: newStatus,
          last_status_change: now,
          last_status_change_by: actualProfile.id,
          ...extraFields,
        })
        .in('id', ids);
      if (updErr) throw updErr;

      // V15: bij 'select' per-id de aangepaste selected_amount zetten
      if (actionKey === 'select') {
        for (const id of ids) {
          const amt = customAmounts.get(id);
          if (amt !== undefined && amt !== null) {
            await supabase
              .from('sandbox_ap_invoices')
              .update({ selected_amount: amt })
              .eq('id', id);
          }
        }
      }

      // V17: bij 'quick_pay' direct match_candidates aanmaken voor afletterlijst
      // Gebruikt zelfde kolommen als manual_writeoff voor consistency
      if (actionKey === 'quick_pay') {
        const invoices = (tabRows[tab] || []).filter(r => ids.includes(r.id));
        const candidateRows = invoices.map(inv => ({
          invoice_id: inv.id,
          source: 'manual',
          source_reference: extra.paidDate,
          matched_amount: parseFloat(inv.selected_amount != null ? inv.selected_amount : inv.balance) || 0,
          matched_date: extra.paidDate,
          matched_currency: inv.currency || 'XCG',
          confidence: 'manual',
          match_score: null,
          match_meta: {
            bank: extra.bank,
            source_type: 'direct_pay',
            source_invoice_status_before: inv.status,
            note: `Direct betaald via ${extra.bank} op ${extra.paidDate} door ${actualProfile.full_name}`,
          },
          status: 'confirmed',
          confirmed_at: now,
          confirmed_by: actualProfile.id,
          created_by: actualProfile.id,
        }));
        const { error: candErr } = await supabase.from('sandbox_ap_match_candidates').insert(candidateRows);
        if (candErr) {
          console.error('match_candidate insert faalde:', candErr);
          alert('Let op: factuur is op betaald gezet maar verschijnt nog niet op afletter-werklijst.\n\nReden: ' + (candErr.message || candErr.code || 'onbekend') + '\n\nNeem contact op met admin.');
        }
      }

      // V17: Voor manual_writeoff: maak ook match_candidate aan met bank in source
      if (actionKey === 'manual_writeoff') {
        const invoices = (tabRows[tab] || []).filter(r => ids.includes(r.id));
        const candidateRows = invoices.map(inv => ({
          invoice_id: inv.id,
          source: 'manual',
          source_reference: extra.paidDate,
          matched_amount: parseFloat(inv.balance) || parseFloat(inv.original_amount) || 0,
          matched_date: extra.paidDate,
          matched_currency: inv.currency || 'XCG',
          confidence: 'manual',
          match_score: null,
          match_meta: {
            bank: extra.bank,
            source_type: 'manual_writeoff',
            reason: extra.reason || null,
            source_invoice_status_before: inv.status,
            note: `Markeer extern betaald via ${extra.bank} op ${extra.paidDate} door ${actualProfile.full_name}.${extra.reason ? ' Reden: ' + extra.reason : ''}`,
          },
          status: 'confirmed',
          confirmed_at: now,
          confirmed_by: actualProfile.id,
          created_by: actualProfile.id,
        }));
        if (candidateRows.length > 0) {
          const { error: cErr } = await supabase.from('sandbox_ap_match_candidates').insert(candidateRows);
          if (cErr) {
            console.error('Manual candidate insert mislukt:', cErr);
            alert('Let op: factuur is op betaald gezet maar verschijnt nog niet op afletter-werklijst.\n\nReden: ' + (cErr.message || cErr.code || 'onbekend') + '\n\nNeem contact op met admin.');
          }
        }
      }

      // Audit log per factuur
      const auditRows = ids.map(id => ({
        action: auditAction,
        entity_type: 'invoice',
        entity_id: id,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          new_status: newStatus,
          batch_size: ids.length,
          played_as: isPlayingRole ? effectiveName : null,
          ...(extra.reason ? { reason: extra.reason } : {}),
          ...(extra.paidDate ? { paid_date: extra.paidDate } : {}),
        },
      }));
      if (auditRows.length > 0) await supabase.from('sandbox_ap_audit_log').insert(auditRows);

      // Verfris de bestemmingstab indien deze al geladen was
      if (tabRows[newStatus]) {
        await loadTabRows(newStatus);
      }
    } catch (e) {
      setError(e.message || 'Fout bij actie');
      // Bij fout: refresh alles om consistentie te herstellen
      await loadCounts();
      await loadTabRows(tab);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selectedIds.size;
  const selectedTotal = useMemo(() =>
    currentInvoices.filter(i => selectedIds.has(i.id))
      .reduce((s, i) => s + parseFloat(i.balance || 0), 0),
    [currentInvoices, selectedIds]);

  const currentTotal = useMemo(() =>
    currentInvoices.reduce((s, i) => s + parseFloat(i.balance || 0), 0),
    [currentInvoices]);

  async function refresh() {
    setTabRows({});
    await loadCounts();
    await loadTabRows(tab);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Header onRefresh={refresh} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(t => {
          const count = tabCounts[t.key] || 0;
          const active = tab === t.key;
          const hasAction = tabHasAction(t.key, effectiveRole);
          const dimmed = !active && !hasAction;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={dimmed ? 'Kijken kan, maar voor jouw rol zijn er geen acties in deze stap' : ''}
              className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-all flex items-center gap-2 ${
                active 
                  ? 'bg-[#1B3A5C] text-white' 
                  : dimmed
                    ? 'bg-white border border-gray-200 text-[#1B3A5C]/35 hover:text-[#1B3A5C]/60 hover:border-[#1B3A5C]/20 opacity-60'
                    : 'bg-white border border-gray-200 text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:border-[#1B3A5C]/30'
              }`}
            >
              {t.label}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center ${
                active ? 'bg-white/20' : dimmed ? 'bg-gray-100 text-gray-400' : TAB_BADGE[t.color]
              }`}>
                {loadingCounts ? '…' : fmtNum(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter & sort */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 shadow-sm space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <VendorMultiSelect
            allVendors={allVendors}
            selected={vendorSelected}
            onChange={setVendorSelected} />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Zoek op factuur, voucher, referentie, PO..."
            className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-[#1B3A5C]"
          />
          <span className="text-[11px] text-[#1B3A5C]/40 italic">
            Klik op een kolom-header om te sorteren
          </span>
          <button
            onClick={exportToExcel}
            disabled={exporting || currentInvoices.length === 0}
            className="ml-auto px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white text-[12px] font-semibold hover:bg-[#264a73] transition-all disabled:opacity-50"
            title="Exporteer huidige (gefilterde) lijst naar Excel">
            {exporting ? 'Exporteren...' : '📥 Excel'}
          </button>
          <div className="text-[11px] text-[#1B3A5C]/50 whitespace-nowrap">
            {fmtNum(currentInvoices.length)} regels · XCG {fmtMoney(currentTotal)}
          </div>
        </div>
        <div className={`border-t pt-2 mt-1 ${(dateFrom || dateTo) ? 'border-blue-200 bg-blue-50/30 -mx-3 px-3 pb-2 rounded-b-xl' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <span className="font-semibold text-[#1B3A5C]/70">Datum-filter:</span>
            <select value={dateField} onChange={e => setDateField(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none cursor-pointer">
              <option value="invoice_date">Factuurdatum</option>
              <option value="due_date">Vervaldatum</option>
            </select>
            <span className="text-[#1B3A5C]/50">van</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#1B3A5C]" />
            <span className="text-[#1B3A5C]/50">t/m</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#1B3A5C]" />
            {(dateFrom || dateTo) && (
              <button onClick={clearDates}
                className="px-2 py-1 rounded bg-rose-100 text-rose-700 text-[11px] font-semibold hover:bg-rose-200">
                ✗ Wis datums
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[11px]">
            <span className="text-[#1B3A5C]/50">Snelle keuze:</span>
            <button onClick={() => applyDatePreset('after_2026')}
              className="px-2 py-1 rounded bg-blue-100 text-blue-800 font-semibold hover:bg-blue-200">
              Na 1/1/2026
            </button>
            <button onClick={() => applyDatePreset('recent_30')}
              className="px-2 py-1 rounded bg-blue-100 text-blue-800 font-semibold hover:bg-blue-200">
              Recent 30 dagen
            </button>
            <button onClick={() => applyDatePreset('this_month')}
              className="px-2 py-1 rounded bg-blue-100 text-blue-800 font-semibold hover:bg-blue-200">
              Lopende maand
            </button>
            <button onClick={() => applyDatePreset('this_year')}
              className="px-2 py-1 rounded bg-blue-100 text-blue-800 font-semibold hover:bg-blue-200">
              Dit jaar
            </button>
            <button onClick={() => applyDatePreset('overdue')}
              className="px-2 py-1 rounded bg-amber-100 text-amber-800 font-semibold hover:bg-amber-200">
              Verlopen
            </button>
            {hasFilters && (
              <button onClick={clearFilters}
                className="ml-auto px-2 py-1 rounded bg-gray-100 text-[#1B3A5C]/70 font-semibold hover:bg-gray-200">
                ✗ Wis alle filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <BulkBar
          tab={tab}
          isClerk={isClerk}
          isAdmin={isAdmin}
          isApprover={isApprover}
          isBank={isBank}
          onQuickPay={(bank) => setShowQuickPayModal(bank)}
          canSelectForPayment={canSelectForPayment}
          canSendToBank={canSendToBank}
          canApprove1={canApprove1}
          canApprove2={canApprove2}
          canMarkPaidInBank={canMarkPaidInBank}
          canMarkReconciled={canMarkReconciled}
          canQuickPay={canQuickPay}
          canManualWriteoff={canManualWriteoff}
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onAction={doAction}
          onDeselect={deselectAll}
          onRejectClick={() => setShowRejectModal(true)}
          onMarkPaidClick={() => setShowMarkPaidModal(true)}
          onSendToBankClick={() => setShowBankModal(true)}
        />
      )}

      {showRejectModal && (
        <RejectModal
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onConfirm={(reason) => doAction('reject', { reason })}
          onCancel={() => setShowRejectModal(false)}
        />
      )}

      {showQuickPayModal && (
        <QuickPayModal
          bank={showQuickPayModal}
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onConfirm={(paidDate) => {
            doAction('quick_pay', { bank: showQuickPayModal, paidDate });
            setShowQuickPayModal(null);
          }}
          onCancel={() => setShowQuickPayModal(null)}
        />
      )}

      {showMarkPaidModal && (
        <ManualPaidModal
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onConfirm={(paidDate, bank, reason) => {
            doAction('manual_writeoff', { paidDate, bank, reason });
            setShowMarkPaidModal(false);
          }}
          onCancel={() => setShowMarkPaidModal(false)}
        />
      )}

      {showBankModal && (
        <BankPromptModal
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onConfirm={(bank) => {
            doAction('send_to_bank', { bank });
            setShowBankModal(false);
          }}
          onCancel={() => setShowBankModal(false)}
        />
      )}

      {/* Tabel */}
      {loadingTab ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Laden...</p>
        </div>
      ) : currentInvoices.length === 0 ? (
        <EmptyState tab={tab} hasFilter={hasFilters} isClerk={isClerk} />
      ) : (
        <InvoiceTable
          invoices={currentInvoices}
          selectedIds={selectedIds}
          onToggle={toggleSelect}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          allSelected={selectedIds.size > 0 && selectedIds.size === currentInvoices.length}
          tab={tab}
          userNames={userNames}
          sortBy={sortBy}
          sortDesc={sortDesc}
          onSort={handleSort}
          customAmounts={customAmounts}
          onCustomAmountChange={setCustomAmount}
        />
      )}
    </div>
  );
}

function Header({ onRefresh }) {
  return (
    <div className="mb-4 flex items-end justify-between flex-wrap gap-2">
      <div>
        <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
          <Link href="/dashboard/finance/sandbox-ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
          <span>›</span>
          <span>Werkstroom</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Werkstroom
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Selecteren → indienen → goedkeuren → naar bank → betaald
        </p>
      </div>
      <button
        onClick={onRefresh}
        className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-[12px] text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:bg-gray-50 transition-all"
      >
        ↻ Verversen
      </button>
    </div>
  );
}

function BulkBar({ tab, isClerk, isAdmin, isApprover, isBank, canSelectForPayment, canSendToBank, canApprove1, canApprove2, canMarkPaidInBank, canMarkReconciled, canQuickPay, canManualWriteoff, count, total, busy, onAction, onDeselect, onRejectClick, onMarkPaidClick, onQuickPay, onSendToBankClick }) {
  return (
    <div className="bg-[#1B3A5C] rounded-xl p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap text-white">
      <span className="text-[13px] font-semibold">
        {fmtNum(count)} geselecteerd · XCG {fmtMoney(total)}
      </span>
      <button onClick={onDeselect} className="text-[12px] text-white/70 hover:text-white underline">
        deselecteer alles
      </button>

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        {/* ===== TAB: open ===== */}
        {tab === 'open' && canQuickPay && (
          <>
            <button onClick={() => onQuickPay('MCB')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 transition-all disabled:opacity-50"
              title="Markeer direct betaald via MCB (alleen ap_bank/admin)">
              💳 MCB direct
            </button>
            <button onClick={() => onQuickPay('RBC')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[12px] font-semibold hover:bg-purple-700 transition-all disabled:opacity-50"
              title="Markeer direct betaald via RBC (alleen ap_bank/admin)">
              💳 RBC direct
            </button>
          </>
        )}
        {tab === 'open' && canSelectForPayment && (
          <button onClick={() => onAction('select')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white text-[#1B3A5C] text-[12px] font-semibold hover:bg-gray-100 transition-all disabled:opacity-50">
            {busy ? 'Bezig...' : '→ Selecteer voor betaling'}
          </button>
        )}
        {tab === 'open' && canManualWriteoff && (
          <button onClick={onMarkPaidClick} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 transition-all disabled:opacity-50"
            title="Voor oude facturen die in werkelijkheid al betaald zijn (buiten portal om)">
            ⚐ Markeer extern betaald
          </button>
        )}

        {/* ===== TAB: selected (klaar voor betaling) ===== */}
        {tab === 'selected' && canSendToBank && (
          <>
            <button onClick={() => onAction('unselect')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50">
              ← Terug naar openstaand
            </button>
            <button onClick={onSendToBankClick} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50"
              title="Maak een batch met bank-keuze en stuur naar goedkeurder 1">
              {busy ? 'Bezig...' : '→ Naar bank (kies bank)'}
            </button>
          </>
        )}

        {/* ===== TAB: batch_pending_1 (Bij goedkeurder 1) ===== */}
        {tab === 'batch_pending_1' && (canSendToBank || isAdmin) && (
          <button onClick={() => onAction('unsend_to_bank')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50"
            title={isAdmin ? 'Admin kan altijd terugdraaien' : 'Alleen je eigen batch'}>
            ↶ Trek batch terug
          </button>
        )}
        {tab === 'batch_pending_1' && canApprove1 && (
          <>
            <button onClick={onRejectClick} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 transition-all disabled:opacity-50">
              ✗ Wijs af
            </button>
            <button onClick={() => onAction('approve_1')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50">
              {busy ? 'Bezig...' : '✓ Goedkeuring 1 (controle)'}
            </button>
          </>
        )}

        {/* ===== TAB: batch_pending_2 (Bij goedkeurder 2) ===== */}
        {tab === 'batch_pending_2' && (canApprove1 || isAdmin) && (
          <button onClick={() => onAction('unapprove_1')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50">
            ↶ Trek goedkeuring 1 terug
          </button>
        )}
        {tab === 'batch_pending_2' && canApprove2 && (
          <>
            <button onClick={onRejectClick} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 transition-all disabled:opacity-50">
              ✗ Wijs af
            </button>
            <button onClick={() => onAction('approve_2')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50"
              title="4-ogen: u mag geen batch goedkeuren die u zelf maakte of als #1 goedkeurde">
              {busy ? 'Bezig...' : '✓ Goedkeuring 2 (finale vrijgave)'}
            </button>
          </>
        )}

        {/* ===== TAB: approved_for_payment (vrijgegeven, wacht op betaaluitvoering) ===== */}
        {tab === 'approved_for_payment' && (canApprove2 || isAdmin) && (
          <button onClick={() => onAction('unapprove_2')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50">
            ↶ Trek goedkeuring 2 terug
          </button>
        )}
        {tab === 'approved_for_payment' && canMarkPaidInBank && (
          <button onClick={() => onAction('mark_paid_in_bank')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-purple-500 text-white text-[12px] font-semibold hover:bg-purple-600 transition-all disabled:opacity-50"
            title="Bevestig dat de betaling op het bankafschrift is gezien">
            {busy ? 'Bezig...' : '✓ Bevestig betaling uitgevoerd'}
          </button>
        )}

        {/* ===== TAB: paid_in_bank ===== */}
        {tab === 'paid_in_bank' && (canMarkPaidInBank || isAdmin) && (
          <button onClick={() => onAction('unmark_paid_in_bank')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50">
            ↶ Trek bevestiging terug
          </button>
        )}
        {tab === 'paid_in_bank' && canMarkReconciled && (
          <button onClick={() => onAction('mark_reconciled')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50"
            title="Markeer als afgeletterd in Eagle (via Aflet Agent)">
            {busy ? 'Bezig...' : '✓ Markeer afgeletterd'}
          </button>
        )}

        {/* ===== TAB: reconciled (eindstation) ===== */}
        {tab === 'reconciled' && isAdmin && (
          <button onClick={() => onAction('unmark_reconciled')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50"
            title="Alleen admin">
            ↶ Trek afletter terug
          </button>
        )}

        {/* ===== Info-tekst voor onbevoegde rollen ===== */}
        {tab === 'batch_pending_1' && !canApprove1 && (
          <span className="text-[11px] text-white/60 italic">Goedkeuring 1: alleen door AP Goedkeurder</span>
        )}
        {tab === 'batch_pending_2' && !canApprove2 && (
          <span className="text-[11px] text-white/60 italic">Goedkeuring 2: alleen door AP Bank of admin</span>
        )}
        {tab === 'approved_for_payment' && !canMarkPaidInBank && (
          <span className="text-[11px] text-white/60 italic">Betaling bevestigen: AP Clerk of admin</span>
        )}
      </div>
    </div>
  );
}

function RejectModal({ count, total, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl p-6 w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-1">
          Afwijzen ({count} {count === 1 ? 'factuur' : 'facturen'})
        </h3>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Totaal XCG {fmtMoney(total)} · gaan terug naar status &quot;Openstaand&quot; voor de AP Clerk.
        </p>
        <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Reden voor afwijzing</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
          placeholder="Bijv. ontbrekende informatie, dubbele factuur, verkeerd bedrag..."
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] resize-none"
          autoFocus />
        <p className="text-[11px] text-[#1B3A5C]/40 mt-1">
          Reden wordt opgeslagen bij de factuur en getoond aan de AP Clerk.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[13px] font-semibold hover:bg-gray-200 disabled:opacity-50">
            Annuleren
          </button>
          <button onClick={() => onConfirm(reason)} disabled={!reason.trim() || busy} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50">
            {busy ? 'Bezig...' : 'Afwijzen met reden'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualPaidModal({ count, total, busy, onConfirm, onCancel }) {
  const [paidDate, setPaidDate] = useState(new Date().toISOString().split('T')[0]);
  const [bank, setBank] = useState('MCB');
  const [reason, setReason] = useState('');
  const banks = [
    { value: 'MCB', label: 'MCB' },
    { value: 'RBC', label: 'RBC' },
    { value: 'RBC_USD', label: 'RBC USD' },
    { value: 'BONAIRE', label: 'RBC Bonaire' },
    { value: 'MULTIMART', label: 'Multimart' },
    { value: 'BDC', label: 'Banco di Caribe' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl p-6 w-[480px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-1">
          Markeer als extern betaald ({count} {count === 1 ? 'factuur' : 'facturen'})
        </h3>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Totaal XCG {fmtMoney(total)} · gaat direct naar status &quot;Betaald&quot;.
          Bedoeld voor facturen die in werkelijkheid al via een bank zijn betaald
          maar nog niet via de portal-flow zijn verwerkt.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Betaaldatum</label>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Bank</label>
            <select value={bank} onChange={e => setBank(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] bg-white">
              {banks.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
        </div>
        <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">
          Reden <span className="font-normal text-[#1B3A5C]/40">(optioneel)</span>
        </label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
          placeholder="Bijv. Al betaald vóór portal-introductie..."
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] resize-none" />
        <p className="text-[11px] text-[#1B3A5C]/40 mt-1">
          Bank wordt opgenomen in afletter-CSV. Audit log legt alles vast.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[13px] font-semibold hover:bg-gray-200 disabled:opacity-50">
            Annuleren
          </button>
          <button onClick={() => onConfirm(paidDate, bank, reason)} disabled={!paidDate || !bank || busy}
            className="px-4 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'Bezig...' : `⚐ Markeer betaald via ${bank}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ tab, hasFilter, isClerk }) {
  const tabLabel = STATUS_TABS.find(t => t.key === tab)?.label || tab;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
      <span className="text-5xl block mb-3">📭</span>
      <p className="text-[15px] font-semibold text-[#1B3A5C] mb-1">
        {hasFilter ? 'Geen resultaten met deze filter' : `Niets in "${tabLabel}"`}
      </p>
      <p className="text-[13px] text-[#1B3A5C]/60">
        {hasFilter ? 'Pas de zoekterm aan.' : isClerk ? 'Er staat niets in deze status voor jou.' : 'Er staat niets in deze status.'}
      </p>
    </div>
  );
}

function InvoiceTable({ invoices, selectedIds, onToggle, onSelectAll, onDeselectAll, allSelected, tab, userNames, sortBy, sortDesc, onSort, customAmounts, onCustomAmountChange }) {
  const showSubmitter = tab === 'batch_pending_1' || tab === 'batch_pending_2';
  const showApprover = tab === 'batch_pending_2' || tab === 'approved_for_payment' || tab === 'paid_in_bank' || tab === 'reconciled';
  const showRejectionIndicator = tab === 'open';
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 p-2">
                <input type="checkbox" checked={allSelected} onChange={() => allSelected ? onDeselectAll() : onSelectAll()} className="cursor-pointer" />
              </th>
              <SortableHeader field="vendor" label="Vendor" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="invoice_number" label="Factuur" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="invoice_date" label="Factuurdatum" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="reference" label="Referentie" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="po_number" label="PO Nummer" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="type" label="Type" current={sortBy} desc={sortDesc} onSort={onSort} />
              <SortableHeader field="original_amount" label="Origineel" current={sortBy} desc={sortDesc} onSort={onSort} align="right" />
              <SortableHeader field="amount" label="Saldo" current={sortBy} desc={sortDesc} onSort={onSort} align="right" />
              <SortableHeader field="due_date" label="Vervaldatum" current={sortBy} desc={sortDesc} onSort={onSort} />
              <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Te betalen</th>
              {showSubmitter && <SortableHeader field="submitted_by" label="Ingediend door" current={sortBy} desc={sortDesc} onSort={onSort} />}
              {showApprover && <SortableHeader field="approved_by" label="Goedgekeurd door" current={sortBy} desc={sortDesc} onSort={onSort} />}
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <InvoiceRow key={inv.id} inv={inv} selected={selectedIds.has(inv.id)} onToggle={() => onToggle(inv.id)}
                showSubmitter={showSubmitter} showApprover={showApprover} userNames={userNames}
                showRejection={showRejectionIndicator} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceRow({ inv, selected, onToggle, showSubmitter, showApprover, userNames, showRejection, customAmount, onCustomAmountChange, tab }) {
  const bal = parseFloat(inv.balance);
  const isCredit = bal < 0;
  const daysUntil = daysUntilDue(inv.due_date);
  const isOverdue = daysUntil !== null && daysUntil < 0;
  const isUrgent = daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;
  const rejection = showRejection && inv.rejection_reason ? {
    body: inv.rejection_reason,
    created_at: inv.rejected_at,
    user_name: userNames[inv.rejected_by] || null,
  } : null;
  const typeColor = inv.type === 'CREDIT MEMO' ? 'bg-rose-50 text-rose-700' :
    inv.type === 'DEBIT MEMO' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600';

  return (
    <tr onClick={onToggle} className={`border-b border-gray-100 cursor-pointer transition-all ${selected ? 'bg-blue-50/60' : 'hover:bg-gray-50/60'}`}>
      <td className="p-2" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} className="cursor-pointer" />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="font-semibold text-[#1B3A5C]">{inv.vendor_name}</div>
          {rejection && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 cursor-help"
              title={`Afgewezen door ${rejection.user_name || 'onbekend'} op ${rejection.created_at ? new Date(rejection.created_at).toLocaleDateString('nl-NL') : '?'}: ${rejection.body}`}>
              ❗ Afgewezen
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{inv.vendor_id}</div>
        {rejection && (
          <div className="text-[10px] text-rose-700/80 mt-1 italic line-clamp-1" title={rejection.body}>
            &ldquo;{rejection.body}&rdquo;
          </div>
        )}
      </td>
      <td className="p-2">
        <div className="font-mono text-[#1B3A5C]">{inv.invoice_number}</div>
        <div className="text-[10px] text-[#1B3A5C]/40 font-mono">v.{inv.voucher}</div>
      </td>
      <td className="p-2 text-[#1B3A5C]/70 whitespace-nowrap">{fmtDate(inv.invoice_date)}</td>
      <td className="p-2 text-[#1B3A5C]/70 text-[11px]" title={inv.reference || ''}>
        {inv.reference || <span className="text-[#1B3A5C]/30">—</span>}
      </td>
      <td className="p-2 text-[#1B3A5C]/70 text-[11px]" title={inv.po_number || ''}>
        {inv.po_number || <span className="text-[#1B3A5C]/30">—</span>}
      </td>
      <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeColor}`}>{inv.type}</span></td>
      <td className="p-2 text-right font-mono text-[#1B3A5C]/70 text-[11px]">
        {inv.original_amount !== null && inv.original_amount !== undefined ? fmtMoney(parseFloat(inv.original_amount)) : '—'}
      </td>
      <td className={`p-2 text-right font-mono font-semibold ${isCredit ? 'text-rose-700' : 'text-[#1B3A5C]'}`}>{fmtMoney(bal)}</td>
      <td className="p-2 whitespace-nowrap">
        <div className={`${isOverdue ? 'text-rose-700 font-semibold' : isUrgent ? 'text-amber-700 font-semibold' : 'text-[#1B3A5C]/70'}`}>{fmtDate(inv.due_date)}</div>
        {daysUntil !== null && (
          <div className={`text-[10px] ${isOverdue ? 'text-rose-600' : isUrgent ? 'text-amber-600' : 'text-[#1B3A5C]/40'}`}>
            {isOverdue ? `${Math.abs(daysUntil)} dgn verlopen` : daysUntil === 0 ? 'vandaag' : `over ${daysUntil} dgn`}
          </div>
        )}
      </td>
      <td className="p-2 text-right">
        {tab === 'open' && selected ? (
          <input
            type="number"
            step="0.01"
            value={customAmount !== undefined ? customAmount : (parseFloat(inv.balance) || 0)}
            onChange={e => onCustomAmountChange(inv.id, parseFloat(e.target.value) || 0)}
            className="w-24 px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-[12px] font-mono text-right focus:outline-none focus:border-blue-500"
            title="Pas aan voor partial payment"
          />
        ) : tab === 'open' ? (
          <span className="text-[10px] text-[#1B3A5C]/30 italic">selecteer</span>
        ) : inv.selected_amount != null && Math.abs(parseFloat(inv.selected_amount) - parseFloat(inv.balance)) > 0.01 ? (
          <span className="font-mono text-[12px]" title="Partial payment - afwijkend bedrag">
            {fmtMoney(parseFloat(inv.selected_amount))}
            <span className="ml-1 px-1 py-0 rounded bg-amber-100 text-amber-800 text-[9px] font-semibold">partial</span>
          </span>
        ) : inv.selected_amount != null ? (
          <span className="font-mono text-[12px] text-[#1B3A5C]/70">{fmtMoney(parseFloat(inv.selected_amount))}</span>
        ) : (
          <span className="text-[10px] text-[#1B3A5C]/30">—</span>
        )}
      </td>
      {showSubmitter && <td className="p-2 text-[#1B3A5C]/70 text-[11px]">{inv.submitted_by ? (userNames[inv.submitted_by] || '—') : '—'}</td>}
      {showApprover && <td className="p-2 text-[#1B3A5C]/70 text-[11px]">{inv.approved_by ? (userNames[inv.approved_by] || '—') : '—'}</td>}
    </tr>
  );
}

function VendorMultiSelect({ allVendors, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allVendors;
    return allVendors.filter(v =>
      (v.vendor_name || '').toLowerCase().includes(q) ||
      String(v.vendor_id).includes(q)
    );
  }, [allVendors, search]);

  function toggle(vid) {
    const next = new Set(selected);
    const key = String(vid);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function selectAllFiltered() {
    const next = new Set(selected);
    for (const v of filtered) next.add(String(v.vendor_id));
    onChange(next);
  }

  function deselectAllFiltered() {
    const next = new Set(selected);
    for (const v of filtered) next.delete(String(v.vendor_id));
    onChange(next);
  }

  function clearAll() { onChange(new Set()); }

  // Sluit dropdown bij klik buiten
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (!e.target.closest('[data-vmselect]')) setOpen(false);
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const label = selected.size === 0
    ? `Alle vendors (${allVendors.length})`
    : `${selected.size} vendor${selected.size === 1 ? '' : 's'} geselecteerd`;

  return (
    <div className="relative" data-vmselect>
      <button onClick={() => setOpen(!open)}
        className="px-2 py-1.5 rounded-lg border border-gray-200 text-[13px] bg-white focus:outline-none cursor-pointer min-w-[220px] text-left flex items-center justify-between gap-2 hover:border-[#1B3A5C]/30">
        <span className="truncate">{label}</span>
        <span className="text-[10px] text-[#1B3A5C]/40 flex-shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 bg-white shadow-xl rounded-lg border border-gray-200 w-[360px] max-w-[90vw]">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Zoek vendor (bv. BDMM)..."
              className="w-full px-2 py-1.5 rounded border border-gray-200 text-[12px] focus:outline-none focus:border-[#1B3A5C]"
              autoFocus />
          </div>
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 text-[11px]">
            <button onClick={selectAllFiltered}
              className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-semibold hover:bg-emerald-200">
              + alle {filtered.length} zichtbaar
            </button>
            {filtered.length < allVendors.length && (
              <button onClick={deselectAllFiltered}
                className="px-2 py-1 rounded bg-gray-100 text-[#1B3A5C]/70 font-semibold hover:bg-gray-200">
                − zichtbaar
              </button>
            )}
            {selected.size > 0 && (
              <button onClick={clearAll}
                className="px-2 py-1 rounded bg-rose-100 text-rose-700 font-semibold hover:bg-rose-200">
                wis alles ({selected.size})
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-[12px] text-[#1B3A5C]/40 italic p-3 text-center">Geen vendors gevonden</p>
            )}
            {filtered.map(v => {
              const key = String(v.vendor_id);
              const isChecked = selected.has(key);
              return (
                <label key={v.vendor_id}
                  className={`flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-gray-50 cursor-pointer ${isChecked ? 'bg-blue-50/40' : ''}`}>
                  <input type="checkbox" checked={isChecked} onChange={() => toggle(v.vendor_id)} className="cursor-pointer" />
                  <span className="flex-1 truncate text-[#1B3A5C]/80">{v.vendor_name}</span>
                  <span className="text-[10px] font-mono text-[#1B3A5C]/40">#{v.vendor_id}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SortableHeader({ field, label, current, desc, onSort, align }) {
  const isActive = current === field;
  const arrow = isActive ? (desc ? ' ↓' : ' ↑') : '';
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th onClick={() => onSort(field)}
      className={`p-2 ${alignClass} font-semibold cursor-pointer select-none transition-colors ${
        isActive ? 'text-[#1B3A5C]' : 'text-[#1B3A5C]/70 hover:text-[#1B3A5C]'
      }`}>
      {label}{arrow}
    </th>
  );
}


function BankPromptModal({ count, total, busy, onConfirm, onCancel }) {
  const BANKS = [
    { value: 'MCB',          label: 'MCB' },
    { value: 'RBC',          label: 'RBC' },
    { value: 'RBC_USD',      label: 'RBC USD' },
    { value: 'BC',           label: 'Banco di Caribe (BC)' },
    { value: 'Multimart',    label: 'Multimart' },
    { value: 'RBC_Bonaire',  label: 'RBC Bonaire' },
  ];
  const [bank, setBank] = useState('');

  // Enter = bevestigen (mits bank gekozen), Escape = annuleren
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Enter' && !busy && bank) onConfirm(bank);
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bank, busy, onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-2">
          🏦 Naar bank — kies bank
        </h3>
        <p className="text-[13px] text-[#1B3A5C]/70 mb-4">
          {count} {count === 1 ? 'factuur' : 'facturen'} ·
          totaal XCG {fmtMoney(total)}
        </p>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Deze actie maakt één batch met de gekozen bank en zet de geselecteerde
          facturen door naar <strong>Bij goedkeurder 1</strong>.
        </p>
        <label className="block text-[12px] font-semibold text-[#1B3A5C]/70 mb-1">
          Bank
        </label>
        <select
          value={bank}
          onChange={e => setBank(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] bg-white focus:outline-none focus:border-[#1B3A5C] mb-4 cursor-pointer"
          autoFocus>
          <option value="" disabled>— Kies een bank —</option>
          {BANKS.map(b => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-[#1B3A5C]/40 italic mb-4">
          Tip: druk op Enter om te bevestigen, Escape om te annuleren.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-3 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[12px] font-semibold hover:bg-gray-200">
            Annuleer
          </button>
          <button onClick={() => onConfirm(bank)} disabled={busy || !bank}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Bezig...' : (bank ? `✓ In bank gezet (${bank})` : '✓ In bank gezet')}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickPayModal({ bank, count, total, busy, onConfirm, onCancel }) {
  const today = new Date().toISOString().substring(0, 10);
  const [paidDate, setPaidDate] = useState(today);

  // Enter = bevestigen
  useEffect(() => {
    function handler(e) {
      if (e.key === 'Enter' && !busy && paidDate) onConfirm(paidDate);
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paidDate, busy, onConfirm, onCancel]);

  const bankColor = bank === 'MCB' ? 'blue' : 'purple';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-2">
          💳 Direct betalen via {bank}
        </h3>
        <p className="text-[13px] text-[#1B3A5C]/70 mb-4">
          {count} {count === 1 ? 'factuur' : 'facturen'} ·
          totaal XCG {fmtMoney(total)} ·
          <span className={`ml-1 px-1.5 py-0.5 rounded bg-${bankColor}-100 text-${bankColor}-800 font-semibold text-[11px]`}>{bank}</span>
        </p>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Deze actie zet de geselecteerde facturen direct op <strong>betaald</strong> en
          plaatst ze op de afletterlijst. AP clerk kan dit later in Eagle afwikkelen.
        </p>
        <label className="block text-[12px] font-semibold text-[#1B3A5C]/70 mb-1">
          Betaaldatum
        </label>
        <input
          type="date"
          value={paidDate}
          onChange={e => setPaidDate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-[#1B3A5C] mb-4"
          autoFocus
        />
        <p className="text-[10px] text-[#1B3A5C]/40 italic mb-4">
          Tip: druk op Enter om te bevestigen, Escape om te annuleren.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-3 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[12px] font-semibold hover:bg-gray-200">
            Annuleer
          </button>
          <button onClick={() => onConfirm(paidDate)} disabled={busy || !paidDate}
            className={`px-3 py-2 rounded-lg bg-${bankColor}-600 text-white text-[12px] font-semibold hover:bg-${bankColor}-700 disabled:opacity-50`}>
            {busy ? 'Bezig...' : `✓ Bevestig ${bank}`}
          </button>
        </div>
      </div>
    </div>
  );
}