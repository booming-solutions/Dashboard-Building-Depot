/* ============================================================
   BESTAND: ap_werkstroom_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/werkstroom/page.js
   (nieuwe file in folder 'werkstroom', hernoemen naar page.js)

   Werkstroom-pagina voor AP:
   - Tabs per status: Openstaand / Klaar voor indiening / Bij goedkeurder /
     Goedgekeurd / In batch
   - Rolfiltering: AP Clerk ziet alleen eigen toegewezen,
     anderen alles
   - AP Clerk acties:
     · "Selecteer" (open → selected_by_ap)
     · "Dien in bij goedkeurder" (selected_by_ap → approver_review)
     · "Terug naar openstaand" (selected_by_ap → open)
   - Filters: vendor zoeken, sortering (due date / bedrag / vendor)
   - Bulk selectie met totaal-bedrag indicatie
   - Audit log per actie
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
  { key: 'in_batch',        label: 'In batch',              color: 'purple' },
];

const TAB_COLOR = {
  gray:    'bg-gray-100 text-gray-700 border-gray-200',
  blue:    'bg-blue-100 text-blue-700 border-blue-200',
  amber:   'bg-amber-100 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  purple:  'bg-purple-100 text-purple-700 border-purple-200',
};

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

// Bepaal of een factuur 'overdue' is
function daysUntilDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

export default function WerkstroomPage() {
  const { actualProfile, effectiveProfileId, effectiveRole, effectiveName, isPlayingRole } = useApRole();
  const supabase = createClient();
  const isClerk = effectiveRole === 'ap_clerk';

  const [tab, setTab] = useState('open');
  const [byStatus, setByStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [vendorFilter, setVendorFilter] = useState('');
  const [sortBy, setSortBy] = useState('due_date');
  const [sortDesc, setSortDesc] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statuses = STATUS_TABS.map(t => t.key);
      const allRows = await fetchAllPaginated(() => {
        let q = supabase
          .from('ap_invoices')
          .select('id, vendor_id, vendor_name, invoice_number, voucher, type, balance, invoice_date, due_date, status, assigned_ap_clerk')
          .in('status', statuses);
        if (isClerk) q = q.eq('assigned_ap_clerk', effectiveProfileId);
        return q;
      });

      const grouped = {};
      for (const s of statuses) grouped[s] = [];
      for (const r of allRows) {
        if (grouped[r.status]) grouped[r.status].push(r);
      }
      setByStatus(grouped);
    } catch (e) {
      setError(e.message || 'Onbekende fout');
    } finally {
      setLoading(false);
    }
  }, [supabase, effectiveProfileId, isClerk]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);
  useEffect(() => { setSelectedIds(new Set()); }, [tab]);

  // Filter + sort huidige tab
  const currentInvoices = useMemo(() => {
    const rows = byStatus[tab] || [];
    let filtered = rows;
    if (vendorFilter.trim()) {
      const q = vendorFilter.trim().toLowerCase();
      filtered = filtered.filter(r =>
        (r.vendor_name || '').toLowerCase().includes(q) ||
        String(r.vendor_id || '').includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q) ||
        (r.voucher || '').includes(q)
      );
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'due_date') {
        cmp = (a.due_date || '9999').localeCompare(b.due_date || '9999');
      } else if (sortBy === 'amount') {
        cmp = Math.abs(parseFloat(a.balance)) - Math.abs(parseFloat(b.balance));
      } else if (sortBy === 'vendor') {
        cmp = (a.vendor_name || '').localeCompare(b.vendor_name || '');
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [byStatus, tab, vendorFilter, sortBy, sortDesc]);

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() {
    setSelectedIds(new Set(currentInvoices.map(i => i.id)));
  }
  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function doAction(actionKey) {
    setBusy(true);
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) throw new Error('Geen facturen geselecteerd');

      const now = new Date().toISOString();
      let newStatus, auditAction;
      if (actionKey === 'select') { newStatus = 'selected_by_ap'; auditAction = 'selected'; }
      else if (actionKey === 'submit') { newStatus = 'approver_review'; auditAction = 'submitted'; }
      else if (actionKey === 'unselect') { newStatus = 'open'; auditAction = 'unselected'; }
      else throw new Error('Onbekende actie');

      const { error: updErr } = await supabase
        .from('ap_invoices')
        .update({
          status: newStatus,
          last_status_change: now,
          last_status_change_by: actualProfile.id,
        })
        .in('id', ids);
      if (updErr) throw updErr;

      // Audit per factuur
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
        },
      }));
      if (auditRows.length > 0) await supabase.from('ap_audit_log').insert(auditRows);

      setSelectedIds(new Set());
      await loadInvoices();
    } catch (e) {
      setError(e.message || 'Fout bij actie');
    } finally {
      setBusy(false);
    }
  }

  // Stats
  const tabCounts = useMemo(() => {
    const m = {};
    for (const t of STATUS_TABS) m[t.key] = (byStatus[t.key] || []).length;
    return m;
  }, [byStatus]);

  const selectedCount = selectedIds.size;
  const selectedTotal = useMemo(() => {
    return currentInvoices
      .filter(i => selectedIds.has(i.id))
      .reduce((s, i) => s + parseFloat(i.balance || 0), 0);
  }, [currentInvoices, selectedIds]);

  const currentTotal = useMemo(() =>
    currentInvoices.reduce((s, i) => s + parseFloat(i.balance || 0), 0),
    [currentInvoices]);

  return (
    <div className="max-w-7xl mx-auto">
      <Header />

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
                active
                  ? 'bg-[#1B3A5C] text-white'
                  : 'bg-white border border-gray-200 text-[#1B3A5C]/70 hover:text-[#1B3A5C] hover:border-[#1B3A5C]/30'
              }`}
            >
              {t.label}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.5rem] text-center ${
                active ? 'bg-white/20' : TAB_BADGE[t.color]
              }`}>
                {fmtNum(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter & sort bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          placeholder="Zoek op vendor, factuur, voucher..."
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:border-[#1B3A5C]"
        />

        <div className="flex items-center gap-1.5 text-[12px] text-[#1B3A5C]/60">
          <span>Sorteer op:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] bg-white focus:outline-none cursor-pointer"
          >
            <option value="due_date">Vervaldatum</option>
            <option value="amount">Bedrag</option>
            <option value="vendor">Vendor</option>
          </select>
          <button
            onClick={() => setSortDesc(!sortDesc)}
            className="px-2 py-1.5 rounded-lg border border-gray-200 text-[12px] hover:bg-gray-50"
            title={sortDesc ? 'Aflopend' : 'Oplopend'}
          >
            {sortDesc ? '↓' : '↑'}
          </button>
        </div>

        <div className="text-[11px] text-[#1B3A5C]/50 ml-auto">
          {fmtNum(currentInvoices.length)} regels · XCG {fmtMoney(currentTotal)}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <BulkBar
          tab={tab}
          isClerk={isClerk}
          count={selectedCount}
          total={selectedTotal}
          busy={busy}
          onAction={doAction}
          onDeselect={deselectAll}
        />
      )}

      {/* Tabel */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="inline-block w-8 h-8 border-4 border-[#1B3A5C]/20 border-t-[#1B3A5C] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[#1B3A5C]">Laden...</p>
        </div>
      ) : currentInvoices.length === 0 ? (
        <EmptyState tab={tab} hasFilter={!!vendorFilter.trim()} isClerk={isClerk} />
      ) : (
        <InvoiceTable
          invoices={currentInvoices}
          selectedIds={selectedIds}
          onToggle={toggleSelect}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          allSelected={selectedIds.size > 0 && selectedIds.size === currentInvoices.length}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
        <Link href="/dashboard/finance/ap" className="hover:text-[#1B3A5C]">Accounts Payable</Link>
        <span>›</span>
        <span>Werkstroom</span>
      </div>
      <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
        Werkstroom
      </h1>
      <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
        Selecteren → indienen → goedkeuren → batch → bank → betaald
      </p>
    </div>
  );
}

function BulkBar({ tab, isClerk, count, total, busy, onAction, onDeselect }) {
  return (
    <div className="bg-[#1B3A5C] rounded-xl p-3 mb-4 shadow-sm flex items-center gap-3 flex-wrap text-white">
      <span className="text-[13px] font-semibold">
        {fmtNum(count)} geselecteerd · XCG {fmtMoney(total)}
      </span>
      <button
        onClick={onDeselect}
        className="text-[12px] text-white/70 hover:text-white underline"
      >
        deselecteer alles
      </button>

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        {tab === 'open' && isClerk && (
          <button
            onClick={() => onAction('select')}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white text-[#1B3A5C] text-[12px] font-semibold hover:bg-gray-100 transition-all disabled:opacity-50"
          >
            {busy ? 'Bezig...' : '→ Selecteer voor indiening'}
          </button>
        )}
        {tab === 'selected_by_ap' && isClerk && (
          <>
            <button
              onClick={() => onAction('unselect')}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/30 text-white text-[12px] font-semibold hover:bg-white/20 transition-all disabled:opacity-50"
            >
              ← Terug naar openstaand
            </button>
            <button
              onClick={() => onAction('submit')}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold hover:bg-emerald-600 transition-all disabled:opacity-50"
            >
              {busy ? 'Bezig...' : '✓ Dien in bij goedkeurder'}
            </button>
          </>
        )}
        {!isClerk && (
          <span className="text-[11px] text-white/60 italic">
            Acties voor jouw rol komen in volgende update
          </span>
        )}
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
        {hasFilter
          ? 'Geen resultaten met deze filter'
          : `Niets in "${tabLabel}"`}
      </p>
      <p className="text-[13px] text-[#1B3A5C]/60">
        {hasFilter
          ? 'Pas de zoekterm aan om meer te zien.'
          : isClerk
            ? 'Er staat momenteel niets in deze status voor jou.'
            : 'Er staat momenteel niets in deze status.'}
      </p>
    </div>
  );
}

function InvoiceTable({ invoices, selectedIds, onToggle, onSelectAll, onDeselectAll, allSelected }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => allSelected ? onDeselectAll() : onSelectAll()}
                  className="cursor-pointer"
                />
              </th>
              <th className="p-3 text-left font-semibold text-[#1B3A5C]/70">Vendor</th>
              <th className="p-3 text-left font-semibold text-[#1B3A5C]/70">Factuur</th>
              <th className="p-3 text-left font-semibold text-[#1B3A5C]/70">Voucher</th>
              <th className="p-3 text-left font-semibold text-[#1B3A5C]/70">Type</th>
              <th className="p-3 text-right font-semibold text-[#1B3A5C]/70">Bedrag</th>
              <th className="p-3 text-left font-semibold text-[#1B3A5C]/70">Vervaldatum</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <InvoiceRow
                key={inv.id}
                inv={inv}
                selected={selectedIds.has(inv.id)}
                onToggle={() => onToggle(inv.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceRow({ inv, selected, onToggle }) {
  const bal = parseFloat(inv.balance);
  const isCredit = bal < 0;
  const daysUntil = daysUntilDue(inv.due_date);
  const isOverdue = daysUntil !== null && daysUntil < 0;
  const isUrgent = daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;

  const typeColor =
    inv.type === 'CREDIT MEMO' ? 'bg-rose-50 text-rose-700' :
    inv.type === 'DEBIT MEMO'  ? 'bg-amber-50 text-amber-700' :
    'bg-gray-50 text-gray-600';

  return (
    <tr
      onClick={onToggle}
      className={`border-b border-gray-100 cursor-pointer transition-all ${selected ? 'bg-blue-50/60' : 'hover:bg-gray-50/60'}`}
    >
      <td className="p-3" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="cursor-pointer"
        />
      </td>
      <td className="p-3">
        <div className="font-semibold text-[#1B3A5C]">{inv.vendor_name}</div>
        <div className="text-[10px] text-[#1B3A5C]/40 font-mono">#{inv.vendor_id}</div>
      </td>
      <td className="p-3">
        <div className="font-mono text-[#1B3A5C]">{inv.invoice_number}</div>
      </td>
      <td className="p-3 font-mono text-[#1B3A5C]/60">{inv.voucher}</td>
      <td className="p-3">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeColor}`}>
          {inv.type}
        </span>
      </td>
      <td className={`p-3 text-right font-mono font-semibold ${isCredit ? 'text-rose-700' : 'text-[#1B3A5C]'}`}>
        {fmtMoney(bal)}
      </td>
      <td className="p-3">
        <div className={`${isOverdue ? 'text-rose-700 font-semibold' : isUrgent ? 'text-amber-700 font-semibold' : 'text-[#1B3A5C]/70'}`}>
          {fmtDate(inv.due_date)}
        </div>
        {daysUntil !== null && (
          <div className={`text-[10px] ${isOverdue ? 'text-rose-600' : isUrgent ? 'text-amber-600' : 'text-[#1B3A5C]/40'}`}>
            {isOverdue
              ? `${Math.abs(daysUntil)} dagen verlopen`
              : daysUntil === 0
                ? 'vervalt vandaag'
                : `over ${daysUntil} dagen`}
          </div>
        )}
      </td>
    </tr>
  );
}
