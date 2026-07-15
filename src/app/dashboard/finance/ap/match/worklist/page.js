/* ============================================================
   BESTAND: ap_match_worklist_page_v5.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/match/worklist/page.js
   (overschrijft v4, hernoemen naar page.js)

   v5 WIJZIGINGEN:
   - Nieuwe sorteerbare kolom 'Bank' (toont invoice.paid_bank, de bank
     waarmee de betaling in de portal is gemarkeerd). Leeg = '—'.

   v4 WIJZIGINGEN:
   - Sorteerbare kolomkoppen (klik = sorteren, nogmaals = omkeren).
     Lege/null-waarden zakken altijd naar onderen.
   - Zoekveld op leverancier (naam of vendor-id) in de filterbalk.
   - Beide werken samen met de bestaande Bron/Clerk-filters en
     met de selectie (select-all volgt de gefilterde/gezochte set).

   Afletter-werklijst (PROJECT CLEAN UP):
   - 4 tabs: Te bevestigen / Te verwerken / Verwerkt / Afgewezen
   - Per-AP-Clerk filter (auto voor clerks, dropdown voor admin/cfo)
   - Te bevestigen: candidate is gematched, AP clerk reviewt
   - Te verwerken: candidate is bevestigd, invoice=paid, maar
     boeking in Eagle moet nog gebeuren — werklijst voor AP clerk
   - Verwerkt: AP clerk heeft de Eagle boeking gedaan, regel
     kan weg uit aktieve werklijst (alleen archief)
   - Afgewezen: candidate is afgewezen, was geen match

   Bij CONFIRM: 
     - candidate.status = 'confirmed', confirmed_at, confirmed_by
     - invoice.status = 'paid', paid_at = matched_date, paid_by
     - audit log entry

   Bij REJECT:
     - candidate.status = 'rejected', rejected_at, rejected_by, rejection_reason
     - invoice blijft op huidige status
   ============================================================ */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

const STATUS_TABS = [
  { key: 'pending',   label: 'Te bevestigen', color: 'amber' },
  { key: 'confirmed', label: 'Te verwerken',  color: 'blue' },
  { key: 'processed', label: 'Verwerkt',      color: 'emerald' },
  { key: 'rejected',  label: 'Afgewezen',     color: 'rose' },
];

const SOURCE_LABELS = {
  pcs: 'PCS',
  bank_mcb: 'MCB',
  bank_rbc: 'RBC',
  vendor_statement: 'Vendor stmt',
  manual: 'Handmatig',
};

const TAB_BADGE = {
  amber: 'bg-amber-200 text-amber-800',
  blue: 'bg-blue-200 text-blue-800',
  emerald: 'bg-emerald-200 text-emerald-800',
  rose: 'bg-rose-200 text-rose-800',
};

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}
function fmtNum(n) { return new Intl.NumberFormat('nl-NL').format(n); }

// v3: vinkjes per regel op tab 'confirmed' + 'Exporteer CSV voor Eagle Agent'
// knop. CSV gaat als input naar eagle_aflet_agent_v3.py op de afdelingscomputer.

export default function MatchWorklistPage() {
  const { actualProfile, effectiveRole, isPlayingRole, effectiveName } = useApRole();
  const supabase = createClient();
  const canConfirm = ['admin', 'cfo', 'ap_approver'].includes(effectiveRole);

  const [tab, setTab] = useState('pending');
  const [counts, setCounts] = useState({});
  const [rows, setRows] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [clerkFilter, setClerkFilter] = useState('all');
  const [vendorSearch, setVendorSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [apClerks, setApClerks] = useState([]);
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Voor AP clerks: filter automatisch op henzelf
  const isClerkRole = effectiveRole === 'ap_clerk';
  useEffect(() => {
    if (isClerkRole) setClerkFilter(actualProfile.id);
  }, [isClerkRole, actualProfile.id]);

  // Lijst van AP Clerks ophalen voor filter dropdown (admin/cfo only)
  useEffect(() => {
    if (isClerkRole) return;
    async function loadClerks() {
      const { data } = await supabase.from('profiles')
        .select('id, full_name')
        .eq('role', 'ap_clerk')
        .order('full_name');
      setApClerks(data || []);
    }
    loadClerks();
  }, [supabase, isClerkRole]);

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const queries = STATUS_TABS.map(t =>
        supabase.from('ap_match_candidates').select('*', { count: 'exact', head: true }).eq('status', t.key)
      );
      const results = await Promise.all(queries);
      const c = {};
      STATUS_TABS.forEach((t, i) => { c[t.key] = results[i].count || 0; });
      setCounts(c);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCounts(false);
    }
  }, [supabase]);

  const loadRows = useCallback(async (statusKey) => {
    setLoadingRows(true);
    try {
      const candidates = await fetchAllPaginated(() =>
        supabase.from('ap_match_candidates')
          .select('*')
          .eq('status', statusKey)
          .order('created_at', { ascending: false })
      );

      if (candidates.length === 0) {
        setRows(prev => ({ ...prev, [statusKey]: [] }));
        return;
      }

      // Haal invoices op
      const invoiceIds = [...new Set(candidates.map(c => c.invoice_id))];
      const allInvoices = await fetchAllPaginated(() =>
        supabase.from('ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, voucher, balance, original_amount, currency, status, invoice_date, due_date, paid_at, paid_bank, selected_amount, assigned_ap_clerk')
      );
      const invSet = new Set(invoiceIds);
      const invMap = {};
      for (const inv of allInvoices) {
        if (invSet.has(inv.id)) invMap[inv.id] = inv;
      }

      // Haal user names op
      const userIds = new Set();
      for (const c of candidates) {
        if (c.confirmed_by) userIds.add(c.confirmed_by);
        if (c.rejected_by) userIds.add(c.rejected_by);
        if (c.created_by) userIds.add(c.created_by);
        if (c.processed_by) userIds.add(c.processed_by);
      }
      // Plus alle assigned_ap_clerk IDs uit invoices
      for (const inv of Object.values(invMap)) {
        if (inv.assigned_ap_clerk) userIds.add(inv.assigned_ap_clerk);
      }
      let userMap = {};
      if (userIds.size > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', Array.from(userIds));
        if (profs) for (const p of profs) userMap[p.id] = p.full_name;
      }

      const enriched = candidates.map(c => {
        const inv = invMap[c.invoice_id] || null;
        return {
          ...c,
          invoice: inv,
          assigned_ap_clerk: inv?.assigned_ap_clerk || null,
          assigned_ap_clerk_name: inv?.assigned_ap_clerk ? userMap[inv.assigned_ap_clerk] : null,
          confirmed_by_name: c.confirmed_by ? userMap[c.confirmed_by] : null,
          rejected_by_name: c.rejected_by ? userMap[c.rejected_by] : null,
          processed_by_name: c.processed_by ? userMap[c.processed_by] : null,
          created_by_name: c.created_by ? userMap[c.created_by] : null,
        };
      });

      setRows(prev => ({ ...prev, [statusKey]: enriched }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRows(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadCounts();
    loadRows(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    if (!rows[tab]) loadRows(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredRows = useMemo(() => {
    let list = rows[tab] || [];
    if (sourceFilter !== 'all') list = list.filter(r => r.source === sourceFilter);
    if (clerkFilter !== 'all') {
      if (clerkFilter === 'unassigned') {
        list = list.filter(r => !r.assigned_ap_clerk);
      } else {
        list = list.filter(r => r.assigned_ap_clerk === clerkFilter);
      }
    }
    // Zoek op leverancier (naam of vendor-id)
    const q = vendorSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const naam = r.invoice?.vendor_name?.toLowerCase() || '';
        const vid = String(r.invoice?.vendor_id ?? '').toLowerCase();
        return naam.includes(q) || vid.includes(q);
      });
    }
    // Sorteren op aangeklikte kolom
    if (sortKey) {
      const accessor = (r) => {
        switch (sortKey) {
          case 'source':   return r.source || '';
          case 'vendor':   return r.invoice?.vendor_name?.toLowerCase() || '';
          case 'invoice':  return r.invoice?.invoice_number?.toLowerCase() || '';
          case 'matched':  return parseFloat(r.matched_amount);
          case 'portal':   return r.invoice
                             ? (parseFloat(r.invoice.original_amount) || Math.abs(parseFloat(r.invoice.balance)))
                             : null;
          case 'date':     return r.matched_date || '';
          case 'bank':     return r.invoice?.paid_bank?.toLowerCase() || '';
          case 'score':    return (r.match_score != null) ? Number(r.match_score) : null;
          case 'clerk':    return r.assigned_ap_clerk_name?.toLowerCase() || '';
          case 'action':   return (r.confirmed_by_name || r.processed_by_name || r.rejected_by_name || '').toLowerCase();
          default:         return '';
        }
      };
      const dir = sortDir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = accessor(a), vb = accessor(b);
        // lege/null-waarden altijd onderaan, ongeacht richting
        const aEmpty = va === '' || va == null || (typeof va === 'number' && isNaN(va));
        const bEmpty = vb === '' || vb == null || (typeof vb === 'number' && isNaN(vb));
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'nl') * dir;
      });
    }
    return list;
  }, [rows, tab, sourceFilter, clerkFilter, vendorSearch, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleSel(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }
  function selectAllFiltered() { setSelectedIds(new Set(filteredRows.map(r => r.id))); }
  function deselectAll() { setSelectedIds(new Set()); }

  async function confirmSelected() {
    setBusy(true); setError(null);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) throw new Error('Niets geselecteerd');
      const now = new Date().toISOString();
      const selectedCandidates = filteredRows.filter(r => selectedIds.has(r.id));

      // 1. Update candidates → confirmed
      const { error: e1 } = await supabase.from('ap_match_candidates')
        .update({ status: 'confirmed', confirmed_at: now, confirmed_by: actualProfile.id })
        .in('id', ids);
      if (e1) throw e1;

      // 2. Update invoices: status='paid', paid_at = matched_date (per candidate)
      // Groepeer op matched_date om in batches te updaten
      const byDate = {};
      for (const c of selectedCandidates) {
        const d = c.matched_date || now.split('T')[0];
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(c.invoice_id);
      }
      for (const [date, invIds] of Object.entries(byDate)) {
        const uniq = [...new Set(invIds)];
        const { error: e2 } = await supabase.from('ap_invoices')
          .update({
            status: 'paid',
            paid_at: date,
            paid_by: actualProfile.id,
            last_status_change: now,
            last_status_change_by: actualProfile.id,
          })
          .in('id', uniq);
        if (e2) throw e2;
      }

      // 3. Audit log
      const auditRows = selectedCandidates.map(c => ({
        action: 'match_confirmed',
        entity_type: 'invoice',
        entity_id: c.invoice_id,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          candidate_id: c.id,
          source: c.source,
          matched_amount: c.matched_amount,
          matched_date: c.matched_date,
          played_as: isPlayingRole ? effectiveName : null,
        },
      }));
      if (auditRows.length > 0) await supabase.from('ap_audit_log').insert(auditRows);

      setSelectedIds(new Set());
      // Refresh
      setRows({});
      await loadCounts();
      await loadRows(tab);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function rejectSelected(reason) {
    setBusy(true); setError(null);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) throw new Error('Niets geselecteerd');
      if (!reason || !reason.trim()) throw new Error('Reden verplicht');

      const now = new Date().toISOString();
      const selectedCandidates = filteredRows.filter(r => selectedIds.has(r.id));

      const { error: e1 } = await supabase.from('ap_match_candidates')
        .update({
          status: 'rejected',
          rejected_at: now,
          rejected_by: actualProfile.id,
          rejection_reason: reason,
        })
        .in('id', ids);
      if (e1) throw e1;

      const auditRows = selectedCandidates.map(c => ({
        action: 'match_rejected',
        entity_type: 'invoice',
        entity_id: c.invoice_id,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          candidate_id: c.id,
          source: c.source,
          reason,
          played_as: isPlayingRole ? effectiveName : null,
        },
      }));
      if (auditRows.length > 0) await supabase.from('ap_audit_log').insert(auditRows);

      setSelectedIds(new Set());
      setShowRejectModal(false);
      setRows({});
      await loadCounts();
      await loadRows(tab);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function markProcessedSelected() {
    setBusy(true); setError(null);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) throw new Error('Niets geselecteerd');

      const now = new Date().toISOString();
      const selectedCandidates = filteredRows.filter(r => selectedIds.has(r.id));

      const { error: e1 } = await supabase.from('ap_match_candidates')
        .update({ status: 'processed', processed_at: now, processed_by: actualProfile.id })
        .in('id', ids);
      if (e1) throw e1;

      const auditRows = selectedCandidates.map(c => ({
        action: 'match_processed',
        entity_type: 'invoice',
        entity_id: c.invoice_id,
        user_id: actualProfile.id,
        user_name: actualProfile.full_name,
        user_role: actualProfile.role,
        details: {
          candidate_id: c.id,
          source: c.source,
          played_as: isPlayingRole ? effectiveName : null,
        },
      }));
      if (auditRows.length > 0) await supabase.from('ap_audit_log').insert(auditRows);

      setSelectedIds(new Set());
      setRows({});
      await loadCounts();
      await loadRows(tab);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // V3: CSV export voor Eagle Agent
  function exportSelectedToCSV() {
    const rows = filteredRows.filter(r => selectedIds.has(r.id));
    if (rows.length === 0) return;

    const headers = ['vendor_id','invoice_number','bank','amount','paid_date','sequence','candidate_id'];
    const csvLines = [headers.join(',')];

    rows.forEach((r, idx) => {
      const inv = r.invoice || {};
      const vendorId = inv.vendor_id || '';
      const invoiceNumber = (inv.invoice_number || '').replace(/,/g, '');
      const bank = inv.paid_bank || 'MCB';
      const amount = (inv.selected_amount != null ? inv.selected_amount : inv.balance) || 0;
      const paidDate = inv.paid_at ? new Date(inv.paid_at).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10);
      const sequence = String(Math.min(idx + 1, 99)).padStart(2, '0');
      const candidateId = r.id;

      csvLines.push([
        vendorId,
        invoiceNumber,
        bank,
        Number(amount).toFixed(2),
        paidDate,
        sequence,
        candidateId,
      ].join(','));
    });

    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = `afletter_${new Date().toISOString().substring(0,10).replace(/-/g,'')}.csv`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const selectedCount = selectedIds.size;
  const selectedTotal = useMemo(() =>
    filteredRows.filter(r => selectedIds.has(r.id))
      .reduce((s, r) => s + (parseFloat(r.matched_amount) || 0), 0),
    [filteredRows, selectedIds]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
          <Link href="/dashboard/finance/ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
          <span>›</span>
          <span>Afletter werklijst</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Afletter werklijst
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Match-kandidaten uit PCS, bank en handmatig — bevestig om de factuur op &apos;betaald&apos; te zetten.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-red-800"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {/* Tab uitleg */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-[12px] text-[#1B3A5C]/80">
        {tab === 'pending' && <p><strong>Te bevestigen:</strong> match-kandidaten uit PCS/bank/etc — review en bevestig (factuur gaat dan op &quot;betaald&quot;).</p>}
        {tab === 'confirmed' && <p><strong>Te verwerken:</strong> bevestigde matches — factuur staat in portal op &quot;betaald&quot;, maar de boeking moet nog in Eagle worden gedaan. AP Clerks: pak deze op, markeer als verwerkt na boeking in Eagle.</p>}
        {tab === 'processed' && <p><strong>Verwerkt:</strong> volledig afgerond — AP clerk heeft Eagle boeking gedaan. Archief.</p>}
        {tab === 'rejected' && <p><strong>Afgewezen:</strong> matches die geen echte match bleken. Factuur staat nog steeds op oorspronkelijke status.</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(t => {
          const count = counts[t.key] || 0;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-all flex items-center gap-2 ${
                active ? 'bg-[#1B3A5C] text-white' : 'bg-white border border-gray-200 text-[#1B3A5C]/70 hover:text-[#1B3A5C]'
              }`}>
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

      {/* Filter + bulk bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap">
        <label className="text-[12px] text-[#1B3A5C]/60">Bron:</label>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none cursor-pointer">
          <option value="all">Alle bronnen</option>
          <option value="pcs">PCS</option>
          <option value="bank_mcb">MCB</option>
          <option value="bank_rbc">RBC</option>
          <option value="vendor_statement">Vendor stmt</option>
          <option value="manual">Handmatig</option>
        </select>
        {!isClerkRole && (
          <>
            <label className="text-[12px] text-[#1B3A5C]/60">AP Clerk:</label>
            <select value={clerkFilter} onChange={e => setClerkFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none cursor-pointer min-w-[180px]">
              <option value="all">Alle clerks</option>
              <option value="unassigned">Geen clerk toegewezen</option>
              {apClerks.map(c => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </>
        )}
        {isClerkRole && (
          <span className="text-[11px] text-[#1B3A5C]/50 italic">
            Filter: jouw toegewezen vendors
          </span>
        )}
        <div className="relative">
          <input
            type="text"
            value={vendorSearch}
            onChange={e => setVendorSearch(e.target.value)}
            placeholder="Zoek leverancier of vendor-id..."
            className="pl-7 pr-7 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none focus:border-[#1B3A5C] w-[230px]" />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#1B3A5C]/30 text-[12px]">🔍</span>
          {vendorSearch && (
            <button onClick={() => setVendorSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#1B3A5C]/40 hover:text-[#1B3A5C] text-[14px] leading-none">
              ×
            </button>
          )}
        </div>
        <div className="text-[11px] text-[#1B3A5C]/50 ml-auto">
          {fmtNum(filteredRows.length)} kandidaten
        </div>
      </div>

      {/* Bulk actie bar - PENDING */}
      {selectedCount > 0 && tab === 'pending' && canConfirm && (
        <div className="bg-[#1B3A5C] rounded-xl p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap text-white">
          <span className="text-[13px] font-semibold">
            {fmtNum(selectedCount)} geselecteerd · XCG {fmtMoney(selectedTotal)}
          </span>
          <button onClick={deselectAll} className="text-[12px] text-white/70 hover:text-white underline">
            deselecteer
          </button>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowRejectModal(true)} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-[12px] font-semibold hover:bg-rose-700 disabled:opacity-50">
              ✗ Wijs af
            </button>
            <button onClick={confirmSelected} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 disabled:opacity-50">
              {busy ? 'Bezig...' : '✓ Bevestig & markeer betaald'}
            </button>
          </div>
        </div>
      )}

      {/* Bulk actie bar - CONFIRMED (te verwerken) */}
      {selectedCount > 0 && tab === 'confirmed' && (
        <div className="bg-[#1B3A5C] rounded-xl p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap text-white">
          <span className="text-[13px] font-semibold">
            {fmtNum(selectedCount)} geselecteerd · XCG {fmtMoney(selectedTotal)}
          </span>
          <button onClick={deselectAll} className="text-[12px] text-white/70 hover:text-white underline">
            deselecteer
          </button>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button onClick={exportSelectedToCSV} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[12px] font-semibold hover:bg-blue-600 disabled:opacity-50"
              title="Download CSV voor Eagle Aflet Agent">
              📥 Exporteer CSV voor Eagle Agent
            </button>
            <button onClick={markProcessedSelected} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 disabled:opacity-50">
              {busy ? 'Bezig...' : '✓ Markeer Eagle-boeking gedaan'}
            </button>
          </div>
        </div>
      )}

      {showRejectModal && (
        <RejectModal count={selectedCount} busy={busy}
          onConfirm={rejectSelected}
          onCancel={() => setShowRejectModal(false)} />
      )}

      {/* Tabel */}
      {loadingRows ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Laden...</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <span className="text-5xl block mb-3">📭</span>
          <p className="text-[14px] text-[#1B3A5C]/60">Geen kandidaten in deze tab/filter.</p>
        </div>
      ) : (
        <CandidateTable
          rows={filteredRows}
          tab={tab}
          showAssignedClerk={!isClerkRole}
          selectedIds={selectedIds}
          onToggle={toggleSel}
          onSelectAll={selectAllFiltered}
          onDeselect={deselectAll}
          allSelected={selectedIds.size > 0 && selectedIds.size === filteredRows.length}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}
    </div>
  );
}

function SortableTH({ label, sortKey, colKey, sortDir, onSort, align = 'left' }) {
  const active = sortKey === colKey;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      onClick={() => onSort(colKey)}
      className={`p-2 ${alignCls} font-semibold text-[#1B3A5C]/70 cursor-pointer select-none hover:bg-gray-100 transition-colors`}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[9px] ${active ? 'text-[#1B3A5C]' : 'text-[#1B3A5C]/25'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  );
}

function CandidateTable({ rows, tab, showAssignedClerk, selectedIds, onToggle, onSelectAll, onDeselect, allSelected, sortKey, sortDir, onSort }) {
  const showCheckbox = tab === 'pending' || tab === 'confirmed';
  let actionLabel = '';
  if (tab === 'confirmed') actionLabel = 'Toegewezen aan';
  else if (tab === 'processed') actionLabel = 'Verwerkt door';
  else if (tab === 'rejected') actionLabel = 'Afgewezen door';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 p-2">
                {showCheckbox && (
                  <input type="checkbox" checked={allSelected}
                    onChange={() => allSelected ? onDeselect() : onSelectAll()}
                    className="cursor-pointer" />
                )}
              </th>
              <SortableTH label="Bron"          colKey="source"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTH label="Vendor"        colKey="vendor"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTH label="Factuur"       colKey="invoice" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTH label="Bron bedrag"   colKey="matched" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <SortableTH label="Portal bedrag" colKey="portal"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <SortableTH label="Betaaldatum"   colKey="date"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTH label="Bank"          colKey="bank"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTH label="Score"         colKey="score"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
              {showAssignedClerk && tab !== 'rejected' && (
                <SortableTH label="AP Clerk"    colKey="clerk"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              )}
              {actionLabel && (
                <SortableTH label={actionLabel} colKey="action"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <CandidateRow key={r.id}
                row={r}
                tab={tab}
                showAssignedClerk={showAssignedClerk}
                selected={selectedIds.has(r.id)}
                onToggle={() => onToggle(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CandidateRow({ row, tab, showAssignedClerk, selected, onToggle }) {
  const inv = row.invoice;
  const sourceColor = {
    pcs: 'bg-blue-50 text-blue-700',
    bank_mcb: 'bg-purple-50 text-purple-700',
    bank_rbc: 'bg-indigo-50 text-indigo-700',
    vendor_statement: 'bg-amber-50 text-amber-700',
    manual: 'bg-gray-50 text-gray-700',
  }[row.source] || 'bg-gray-50 text-gray-700';

  const confColor = row.confidence === 'exact' ? 'bg-emerald-100 text-emerald-700'
    : row.confidence === 'fuzzy' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700';

  const isClickable = tab === 'pending' || tab === 'confirmed';
  return (
    <tr onClick={isClickable ? onToggle : undefined}
      className={`border-b border-gray-100 transition-all ${isClickable ? 'cursor-pointer' : ''} ${
        selected ? 'bg-blue-50/60' : 'hover:bg-gray-50/60'
      }`}>
      <td className="p-2" onClick={e => e.stopPropagation()}>
        {isClickable && (
          <input type="checkbox" checked={selected} onChange={onToggle} className="cursor-pointer" />
        )}
      </td>
      <td className="p-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sourceColor}`}>
          {SOURCE_LABELS[row.source] || row.source}
        </span>
      </td>
      <td className="p-2">
        {inv ? (
          <>
            <div className="font-semibold text-[#1B3A5C]">{inv.vendor_name}</div>
            <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{inv.vendor_id}</div>
          </>
        ) : (
          <span className="text-[#1B3A5C]/30 italic">Factuur verwijderd</span>
        )}
      </td>
      <td className="p-2">
        {inv && (
          <>
            <div className="font-mono text-[#1B3A5C]">{inv.invoice_number}</div>
            <div className="text-[10px] text-[#1B3A5C]/40 font-mono">v.{inv.voucher}</div>
          </>
        )}
      </td>
      <td className="p-2 text-right font-mono">
        {fmtMoney(parseFloat(row.matched_amount))}
        <span className="ml-1 text-[10px] text-[#1B3A5C]/40">{row.matched_currency || ''}</span>
      </td>
      <td className="p-2 text-right font-mono text-[#1B3A5C]/70">
        {inv ? fmtMoney(parseFloat(inv.original_amount) || Math.abs(parseFloat(inv.balance))) : '—'}
        <span className="ml-1 text-[10px] text-[#1B3A5C]/40">XCG</span>
      </td>
      <td className="p-2 text-[#1B3A5C]/70 whitespace-nowrap">{fmtDate(row.matched_date)}</td>
      <td className="p-2 whitespace-nowrap">
        {inv && inv.paid_bank
          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">{inv.paid_bank}</span>
          : <span className="text-[#1B3A5C]/30 italic text-[11px]">—</span>}
      </td>
      <td className="p-2 text-center">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${confColor}`}>
          {row.match_score ? Math.round(row.match_score) : row.confidence}
        </span>
      </td>
      {showAssignedClerk && tab !== 'rejected' && (
        <td className="p-2 text-[#1B3A5C]/70 text-[11px]">
          {row.assigned_ap_clerk_name || <span className="text-[#1B3A5C]/30 italic">geen toewijzing</span>}
        </td>
      )}
      {tab === 'confirmed' && (
        <td className="p-2 text-[#1B3A5C]/70 text-[11px]">
          {row.confirmed_by_name || '—'}
          {row.confirmed_at && <div className="text-[10px] text-[#1B3A5C]/40">{fmtDate(row.confirmed_at)}</div>}
        </td>
      )}
      {tab === 'processed' && (
        <td className="p-2 text-[#1B3A5C]/70 text-[11px]">
          {row.processed_by_name || '—'}
          {row.processed_at && <div className="text-[10px] text-[#1B3A5C]/40">{fmtDate(row.processed_at)}</div>}
        </td>
      )}
      {tab === 'rejected' && (
        <td className="p-2 text-[#1B3A5C]/70 text-[11px]">
          {row.rejected_by_name || '—'}
          {row.rejection_reason && (
            <div className="text-[10px] text-rose-700/80 italic line-clamp-1" title={row.rejection_reason}>
              &ldquo;{row.rejection_reason}&rdquo;
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

function RejectModal({ count, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl p-6 w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1B3A5C] mb-1">
          Match afwijzen ({count})
        </h3>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          De factuur blijft op huidige status. Match wordt gemarkeerd als afgewezen.
        </p>
        <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Reden</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="Bijv. PCS regel klopt niet, factuur was nog niet betaald, bedrag wijkt te veel af..."
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:border-[#1B3A5C] resize-none"
          autoFocus />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[13px] font-semibold hover:bg-gray-200 disabled:opacity-50">
            Annuleren
          </button>
          <button onClick={() => onConfirm(reason)} disabled={!reason.trim() || busy}
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-50">
            {busy ? 'Bezig...' : 'Afwijzen'}
          </button>
        </div>
      </div>
    </div>
  );
}