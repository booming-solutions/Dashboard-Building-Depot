/* ============================================================
   BESTAND: ap_werkstroom_page_v11.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/werkstroom/page.js
   (overschrijft v4, hernoemen naar page.js)

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
  { key: 'open',            label: 'Openstaand',            color: 'gray' },
  { key: 'selected_by_ap',  label: 'Klaar voor indiening',  color: 'blue' },
  { key: 'approver_review', label: 'Bij goedkeurder',       color: 'amber' },
  { key: 'approved',        label: 'Goedgekeurd',           color: 'emerald' },
  { key: 'at_bank',         label: 'Bij bank',              color: 'purple' },
];

const TAB_BADGE = {
  gray:    'bg-gray-200 text-gray-700',
  blue:    'bg-blue-200 text-blue-800',
  amber:   'bg-amber-200 text-amber-800',
  emerald: 'bg-emerald-200 text-emerald-800',
  purple:  'bg-purple-200 text-purple-800',
};

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

const SELECT_COLS = 'id, vendor_id, vendor_name, invoice_number, voucher, type, balance, original_amount, currency, invoice_date, due_date, reference, po_number, status, assigned_ap_clerk, selected_by, submitted_by, approved_by, rejection_reason, rejected_at, rejected_by';

export default function WerkstroomPage() {
  const { actualProfile, effectiveProfileId, effectiveRole, effectiveName, isPlayingRole } = useApRole();
  const supabase = createClient();
  const isClerk = effectiveRole === 'ap_clerk';

  // Lokaal berekende capabilities — geen context-afhankelijkheid
  const canApprove = ['admin', 'cfo', 'ap_approver'].includes(effectiveRole);
  const canSendToBank = ['admin', 'ap_clerk'].includes(effectiveRole);
  const canMarkPaid = ['admin', 'cfo'].includes(effectiveRole);
  const canManualWriteoff = ['admin', 'cfo'].includes(effectiveRole);

  const [tab, setTab] = useState('open');
  const [tabCounts, setTabCounts] = useState({});
  const [tabRows, setTabRows] = useState({});  // {status: [rows]}
  const [userNames, setUserNames] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingTab, setLoadingTab] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [vendorSelected, setVendorSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [allVendors, setAllVendors] = useState([]);
  const [sortBy, setSortBy] = useState('due_date');
  const [sortDesc, setSortDesc] = useState(false);
  const [dateField, setDateField] = useState('due_date');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Vendors ophalen voor de dropdown (eenmalig)
  useEffect(() => {
    let cancelled = false;
    async function loadVendors() {
      const data = await fetchAllPaginated(() =>
        supabase.from('ap_vendors').select('vendor_id, vendor_name').order('vendor_name')
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
          .from('ap_invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', t.key);
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
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
          .from('ap_invoices')
          .select(SELECT_COLS)
          .eq('status', statusKey);
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
        return q;
      });
      setTabRows(prev => ({ ...prev, [statusKey]: rows }));

      // Profile-namen voor selected_by/submitted_by/approved_by/rejected_by
      const userIds = new Set();
      for (const r of rows) {
        if (r.selected_by) userIds.add(r.selected_by);
        if (r.submitted_by) userIds.add(r.submitted_by);
        if (r.approved_by) userIds.add(r.approved_by);
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
      if (sortBy === 'due_date') {
        cmp = (a.due_date || '9999').localeCompare(b.due_date || '9999');
      } else if (sortBy === 'invoice_date') {
        cmp = (a.invoice_date || '9999').localeCompare(b.invoice_date || '9999');
      } else if (sortBy === 'amount') {
        cmp = Math.abs(parseFloat(a.balance)) - Math.abs(parseFloat(b.balance));
      } else if (sortBy === 'vendor') {
        cmp = (a.vendor_name || '').localeCompare(b.vendor_name || '');
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [tabRows, tab, debouncedSearch, vendorSelected, sortBy, sortDesc, dateField, dateFrom, dateTo]);

  const hasFilters = vendorSelected.size > 0 || searchInput.trim() || dateFrom || dateTo;
  function clearFilters() {
    setSearchInput('');
    setVendorSelected(new Set());
    setDateFrom('');
    setDateTo('');
  }

  function handleSort(field) {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      // Standaard: bedrag groot→klein, anderen klein→groot
      setSortDesc(field === 'amount');
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
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }
  function selectAll() { setSelectedIds(new Set(currentInvoices.map(i => i.id))); }
  function deselectAll() { setSelectedIds(new Set()); }

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
        newStatus = 'selected_by_ap';
        auditAction = 'selected';
        extraFields.selected_at = now;
        extraFields.selected_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'submit') {
        newStatus = 'approver_review';
        auditAction = 'submitted';
        extraFields.submitted_at = now;
        extraFields.submitted_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'unselect') {
        newStatus = 'open';
        auditAction = 'unselected';
        extraFields.selected_at = null;
        extraFields.selected_by = null;
      } else if (actionKey === 'approve') {
        newStatus = 'approved';
        auditAction = 'approved';
        extraFields.approved_at = now;
        extraFields.approved_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else if (actionKey === 'reject') {
        if (!extra.reason || !extra.reason.trim()) throw new Error('Afwijs-reden is verplicht');
        newStatus = 'open';
        auditAction = 'rejected';
        extraFields.selected_at = null;
        extraFields.selected_by = null;
        extraFields.submitted_at = null;
        extraFields.submitted_by = null;
        extraFields.rejection_reason = extra.reason;
        extraFields.rejected_at = now;
        extraFields.rejected_by = actualProfile.id;
      } else if (actionKey === 'send_to_bank') {
        newStatus = 'at_bank';
        auditAction = 'sent_to_bank';
      } else if (actionKey === 'mark_paid') {
        newStatus = 'paid';
        auditAction = 'marked_paid';
        extraFields.paid_at = now;
        extraFields.paid_by = actualProfile.id;
      } else if (actionKey === 'manual_writeoff') {
        if (!extra.reason || !extra.reason.trim()) throw new Error('Reden is verplicht');
        if (!extra.paidDate) throw new Error('Betaaldatum is verplicht');
        newStatus = 'paid';
        auditAction = 'manual_writeoff';
        extraFields.paid_at = extra.paidDate;
        extraFields.paid_by = actualProfile.id;
        Object.assign(extraFields, clearRejection);
      } else {
        throw new Error('Onbekende actie: ' + actionKey);
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
        .from('ap_invoices')
        .update({
          status: newStatus,
          last_status_change: now,
          last_status_change_by: actualProfile.id,
          ...extraFields,
        })
        .in('id', ids);
      if (updErr) throw updErr;

      // Voor manual_writeoff: maak ook match_candidate aan (al confirmed)
      if (actionKey === 'manual_writeoff') {
        const invoices = (tabRows[tab] || []).filter(r => ids.includes(r.id));
        const candidateRows = invoices.map(inv => ({
          invoice_id: inv.id,
          source: 'manual',
          source_reference: null,
          matched_amount: parseFloat(inv.balance) || parseFloat(inv.original_amount) || 0,
          matched_date: extra.paidDate,
          matched_currency: inv.currency || 'XCG',
          confidence: 'manual',
          match_score: null,
          match_meta: { reason: extra.reason, source_invoice_status_before: inv.status },
          status: 'confirmed',
          confirmed_at: now,
          confirmed_by: actualProfile.id,
          created_by: actualProfile.id,
        }));
        if (candidateRows.length > 0) {
          const { error: cErr } = await supabase.from('ap_match_candidates').insert(candidateRows);
          if (cErr) console.warn('Manual candidate insert mislukt:', cErr);
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
      if (auditRows.length > 0) await supabase.from('ap_audit_log').insert(auditRows);

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
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-all flex items-center gap-2 ${
                active ? 'bg-[#1B3A5C] text-white' : 'bg-white border border-gray-200 text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:border-[#1B3A5C]/30'
              }`}
            >
              {t.label}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center ${
                active ? 'bg-white/20' : TAB_BADGE[t.color]
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
        <div className="flex items-center gap-2 flex-wrap text-[12px] text-[#1B3A5C]/60">
          <span>Datum-range op:</span>
          <select value={dateField} onChange={e => setDateField(e.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none cursor-pointer">
            <option value="due_date">Vervaldatum</option>
            <option value="invoice_date">Factuurdatum</option>
          </select>
          <span>van</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#1B3A5C]" />
          <span>t/m</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#1B3A5C]" />
          {hasFilters && (
            <button onClick={clearFilters}
              className="px-2 py-1.5 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[12px] font-semibold hover:bg-gray-200">
              ✗ Wis filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <BulkBar
          tab={tab}
          isClerk={isClerk}
          canApprove={canApprove}
          canSendToBank={canSendToBank}
          canMarkPaid={canMarkPaid}
          canManualWriteoff={canManualWriteoff}
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onAction={doAction}
          onDeselect={deselectAll}
          onRejectClick={() => setShowRejectModal(true)}
          onMarkPaidClick={() => setShowMarkPaidModal(true)}
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

      {showMarkPaidModal && (
        <ManualPaidModal
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onConfirm={(paidDate, reason) => {
            doAction('manual_writeoff', { paidDate, reason });
            setShowMarkPaidModal(false);
          }}
          onCancel={() => setShowMarkPaidModal(false)}
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
          <Link href="/dashboard/finance/ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
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

function BulkBar({ tab, isClerk, canApprove, canSendToBank, canMarkPaid, canManualWriteoff, count, total, busy, onAction, onDeselect, onRejectClick, onMarkPaidClick }) {
  return (
    <div className="bg-[#1B3A5C] rounded-xl p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap text-white">
      <span className="text-[13px] font-semibold">
        {fmtNum(count)} geselecteerd · XCG {fmtMoney(total)}
      </span>
      <button onClick={onDeselect} className="text-[12px] text-white/70 hover:text-white underline">
        deselecteer alles
      </button>

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        {tab === 'open' && isClerk && (
          <button onClick={() => onAction('select')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white text-[#1B3A5C] text-[12px] font-semibold hover:bg-gray-100 transition-all disabled:opacity-50">
            {busy ? 'Bezig...' : '→ Selecteer voor indiening'}
          </button>
        )}
        {tab === 'open' && canManualWriteoff && (
          <button onClick={onMarkPaidClick} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 transition-all disabled:opacity-50"
            title="Voor oude facturen die in werkelijkheid al betaald zijn (buiten portal om)">
            ⚐ Markeer extern betaald
          </button>
        )}
        {tab === 'selected_by_ap' && isClerk && (
          <>
            <button onClick={() => onAction('unselect')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50">
              ← Terug naar openstaand
            </button>
            <button onClick={() => onAction('submit')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50">
              {busy ? 'Bezig...' : '✓ Dien in bij goedkeurder'}
            </button>
          </>
        )}
        {tab === 'approver_review' && canApprove && (
          <>
            <button onClick={onRejectClick} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 transition-all disabled:opacity-50">
              ✗ Wijs af
            </button>
            <button onClick={() => onAction('approve')} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50">
              {busy ? 'Bezig...' : '✓ Keur goed'}
            </button>
          </>
        )}
        {tab === 'approved' && canSendToBank && (
          <button onClick={() => onAction('send_to_bank')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-purple-500 text-white text-[12px] font-semibold hover:bg-purple-600 transition-all disabled:opacity-50">
            {busy ? 'Bezig...' : '→ Markeer verzonden naar bank'}
          </button>
        )}
        {tab === 'at_bank' && canMarkPaid && (
          <button onClick={() => onAction('mark_paid')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50">
            {busy ? 'Bezig...' : '✓ Bevestig betaald'}
          </button>
        )}
        {tab === 'approver_review' && !canApprove && (
          <span className="text-[11px] text-white/60 italic">Goedkeuren kan alleen door goedkeurders/CFO/admin</span>
        )}
        {tab === 'approved' && !canSendToBank && (
          <span className="text-[11px] text-white/60 italic">Naar bank versturen: AP Clerk of admin</span>
        )}
        {tab === 'at_bank' && !canMarkPaid && (
          <span className="text-[11px] text-white/60 italic">Betaling bevestigen: CFO of admin</span>
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
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl p-6 w-[480px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-1">
          Markeer als extern betaald ({count} {count === 1 ? 'factuur' : 'facturen'})
        </h3>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Totaal XCG {fmtMoney(total)} · gaan direct naar status &quot;Betaald&quot;.
          Bedoeld voor oude facturen die in werkelijkheid al zijn betaald.
        </p>
        <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Betaaldatum</label>
        <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] mb-3" />
        <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Reden</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="Bijv. Al betaald vóór portal-introductie, gezien in bank statement maart 2025..."
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] resize-none"
          autoFocus />
        <p className="text-[11px] text-[#1B3A5C]/40 mt-1">
          Wordt vastgelegd in audit log en in de afletter-werklijst.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[13px] font-semibold hover:bg-gray-200 disabled:opacity-50">
            Annuleren
          </button>
          <button onClick={() => onConfirm(paidDate, reason)} disabled={!paidDate || !reason.trim() || busy}
            className="px-4 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'Bezig...' : '⚐ Markeer betaald'}
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

function InvoiceTable({ invoices, selectedIds, onToggle, onSelectAll, onDeselectAll, allSelected, tab, userNames, sortBy, sortDesc, onSort }) {
  const showSubmitter = tab === 'approver_review';
  const showApprover = tab === 'approved' || tab === 'at_bank';
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
              <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Factuur</th>
              <SortableHeader field="invoice_date" label="Factuurdatum" current={sortBy} desc={sortDesc} onSort={onSort} />
              <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Referentie</th>
              <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">PO Nummer</th>
              <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Type</th>
              <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Origineel</th>
              <SortableHeader field="amount" label="Saldo" current={sortBy} desc={sortDesc} onSort={onSort} align="right" />
              <SortableHeader field="due_date" label="Vervaldatum" current={sortBy} desc={sortDesc} onSort={onSort} />
              {showSubmitter && <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Ingediend door</th>}
              {showApprover && <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Goedgekeurd door</th>}
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

function InvoiceRow({ inv, selected, onToggle, showSubmitter, showApprover, userNames, showRejection }) {
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
