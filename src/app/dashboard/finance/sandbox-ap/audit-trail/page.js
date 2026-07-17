/* ============================================================
   BESTAND: sandbox_ap_audit_trail_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/audit-trail/page.js
   (nieuwe folder: audit-trail/, hernoemen naar page.js)

   DOEL: inzicht in het actie-spoor van de AP-werkstroom.
   Toont per factuur de keten (geselecteerd → naar bank + bank →
   goedkeuring 1 → goedkeuring 2 → in bank gezet) plus de directe
   "op papier"-betalingen (direct_paid) en handmatige afboekingen.

   Bron: ap_audit_log (action, user_name, user_role, details jsonb,
   created_at). Koppeling aan de factuur via entity_id = invoice-id,
   waarmee ook de entiteit (BDT/BDB/MMC/RCC) wordt bepaald.

   Twee weergaven: 'Chronologisch' (alle acties, filterbaar) en
   'Per factuur' (zoek een factuur, zie de volledige keten).
   Entiteit-gescoped + CSV-export.
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../layout';
import Link from 'next/link';

// Vriendelijke labels per actie. Voor de goedkeuringsstappen leiden we het
// niveau af uit details.new_status (betrouwbaarder dan de actienaam alleen).
const ACTION_LABELS = {
  selected: 'Geselecteerd voor betaling',
  unselected: 'Selectie teruggedraaid',
  sent_to_bank: 'Naar bank — batch aangemaakt',
  submitted: 'Ingediend ter goedkeuring',
  approved: 'Goedgekeurd',
  marked_paid: 'Betaald gemarkeerd',
  marked_paid_in_bank: 'In bank gezet',
  direct_paid: 'Direct betaald (op papier)',
  manual_writeoff: 'Handmatig afgeboekt',
  rejected: 'Afgewezen',
  auto_matched: 'Automatisch gematcht',
  match_auto_processed: 'Match automatisch verwerkt',
  eagle_synced: 'Eagle gesynchroniseerd',
  rolled_back_select: 'Teruggedraaid — selectie',
  rolled_back_submit: 'Teruggedraaid — indiening',
  rolled_back_approve: 'Teruggedraaid — goedkeuring',
  rolled_back_send_to_bank: 'Teruggedraaid — naar bank',
  upload_completed: 'Upload voltooid',
  bank_statements_imported: 'Bankafschrift geïmporteerd',
  pcs_imported: 'PCS geïmporteerd',
  role_migration_v2: 'Rol-migratie (systeem)',
  fix_v2_legacy_batch: 'Legacy-batch fix (systeem)',
};

// Acties die bij de betaal-/goedkeuringsketen horen (voor 'Per factuur')
const CHAIN_ACTIONS = new Set([
  'selected', 'unselected', 'sent_to_bank', 'submitted', 'approved',
  'marked_paid', 'marked_paid_in_bank', 'direct_paid', 'manual_writeoff', 'rejected',
  'rolled_back_select', 'rolled_back_submit', 'rolled_back_approve', 'rolled_back_send_to_bank',
]);

function labelFor(entry) {
  const d = entry.details || {};
  if (entry.action === 'submitted' || entry.action === 'approved') {
    if (d.new_status === 'batch_pending_2') return 'Goedkeuring 1 (→ goedkeurder 2)';
    if (d.new_status === 'approved_for_payment') return 'Goedkeuring 2 — vrijgegeven';
  }
  return ACTION_LABELS[entry.action] || entry.action;
}

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Kleur per actie-groep
function actionColor(action) {
  if (['direct_paid', 'marked_paid', 'marked_paid_in_bank'].includes(action)) return 'bg-emerald-100 text-emerald-800';
  if (['approved', 'submitted'].includes(action)) return 'bg-blue-100 text-blue-800';
  if (action === 'sent_to_bank') return 'bg-indigo-100 text-indigo-800';
  if (action === 'selected') return 'bg-slate-100 text-slate-700';
  if (['rejected', 'manual_writeoff'].includes(action)) return 'bg-amber-100 text-amber-800';
  if (action.startsWith('rolled_back')) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

// Belangrijkste details compact tonen
function detailBits(details) {
  if (!details) return [];
  const bits = [];
  if (details.new_status) bits.push(`status: ${details.new_status}`);
  if (details.bank) bits.push(`bank: ${details.bank}`);
  if (details.paid_date) bits.push(`betaald: ${details.paid_date}`);
  if (details.batch_size) bits.push(`batch: ${details.batch_size}`);
  if (details.filename) bits.push(details.filename);
  return bits;
}

export default function AuditTrailPage() {
  const { effectiveRole, entity, entityMeta } = useApRole();
  const supabase = createClient();
  const canUse = ['admin', 'cfo', 'ap_approver', 'ap_clerk', 'ap_bank'].includes(effectiveRole);

  const [view, setView] = useState('chrono'); // 'chrono' | 'invoice'
  const [entries, setEntries] = useState([]);
  const [invMap, setInvMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // filters (chronologisch)
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // 1) facturen van de actieve entiteit → map id → factuur
      const { data: invs, error: invErr } = await supabase
        .from('sandbox_ap_invoices')
        .select('id, invoice_number, vendor_name')
        .eq('entity', entity);
      if (invErr) throw invErr;
      const map = {};
      (invs || []).forEach(i => { map[String(i.id)] = i; });
      setInvMap(map);

      // 2) auditregels ophalen (recent), daarna client-side scopen op deze entiteit
      const { data: logs, error: logErr } = await supabase
        .from('sandbox_ap_audit_log')
        .select('id, action, entity_type, entity_id, user_name, user_role, details, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (logErr) throw logErr;

      // alleen regels die aan een factuur van deze entiteit hangen
      const scoped = (logs || []).filter(l => l.entity_id && map[String(l.entity_id)]);
      setEntries(scoped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, entity]);

  useEffect(() => { load(); }, [load]);

  const users = useMemo(
    () => Array.from(new Set(entries.map(e => e.user_name).filter(Boolean))).sort(),
    [entries]);
  const actions = useMemo(
    () => Array.from(new Set(entries.map(e => e.action))).sort(),
    [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (actionFilter !== 'all') list = list.filter(e => e.action === actionFilter);
    if (userFilter !== 'all') list = list.filter(e => e.user_name === userFilter);
    if (dateFrom) list = list.filter(e => e.created_at >= dateFrom);
    if (dateTo) list = list.filter(e => e.created_at <= dateTo + 'T23:59:59');
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(e => {
        const inv = invMap[String(e.entity_id)];
        return (inv?.invoice_number || '').toLowerCase().includes(q)
          || (inv?.vendor_name || '').toLowerCase().includes(q);
      });
    }
    return list;
  }, [entries, invMap, actionFilter, userFilter, dateFrom, dateTo, search]);

  // Per factuur: groeperen op entity_id, alleen keten-acties
  const byInvoice = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = {};
    for (const e of entries) {
      if (!CHAIN_ACTIONS.has(e.action)) continue;
      const inv = invMap[String(e.entity_id)];
      if (!inv) continue;
      if (q && !(`${inv.invoice_number} ${inv.vendor_name}`.toLowerCase().includes(q))) continue;
      (groups[e.entity_id] = groups[e.entity_id] || { inv, events: [] }).events.push(e);
    }
    // events chronologisch oplopend binnen de factuur
    return Object.values(groups)
      .map(g => ({ ...g, events: g.events.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
      .sort((a, b) => {
        const la = a.events[a.events.length - 1].created_at;
        const lb = b.events[b.events.length - 1].created_at;
        return lb.localeCompare(la);
      });
  }, [entries, invMap, search]);

  const exportCsv = useCallback(() => {
    const rows = [['Datum/tijd', 'Factuur', 'Vendor', 'Actie', 'Details', 'Gebruiker', 'Rol']];
    for (const e of filtered) {
      const inv = invMap[String(e.entity_id)] || {};
      rows.push([
        fmtDateTime(e.created_at),
        inv.invoice_number || '',
        inv.vendor_name || '',
        labelFor(e),
        detailBits(e.details).join('; '),
        e.user_name || '',
        e.user_role || '',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_trail_${entity}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filtered, invMap, entity]);

  if (!canUse) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-amber-900 mb-2">Geen toegang</h2>
          <p className="text-[13px] text-amber-800">De Audit Trail is voor AP-gebruikers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-2 text-[12px] text-[#1B3A5C]/50">
        <Link href="/dashboard/finance/sandbox-ap" className="hover:underline">Accounts Payable</Link>
        {' › '}Audit Trail
      </div>
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Audit Trail</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-4">
        Volledig actie-spoor van de werkstroom in {entityMeta?.name} {entityMeta?.sub} — wie wat wanneer deed.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      {/* View-toggle */}
      <div className="flex gap-2 mb-3">
        {[['chrono', 'Chronologisch'], ['invoice', 'Per factuur']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              view === k ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-[#1B3A5C]/70 hover:bg-gray-200'}`}>
            {l}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Zoek factuur of vendor..."
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] w-[220px] focus:outline-none focus:border-[#1B3A5C]" />
          <button onClick={exportCsv}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700">
            ↓ Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Laden...</div>
      ) : view === 'chrono' ? (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap bg-[#f8fafc] rounded-xl px-4 py-2.5 border border-gray-100">
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white">
              <option value="all">Alle acties</option>
              {actions.map(a => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
            </select>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white">
              <option value="all">Alle gebruikers</option>
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <label className="text-[11px] text-[#1B3A5C]/50">van</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
            <label className="text-[11px] text-[#1B3A5C]/50">t/m</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
            <span className="ml-auto text-[11px] text-[#1B3A5C]/50">{filtered.length} regels</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-[#1B3A5C]/70">
                <tr>
                  <th className="p-2 text-left font-semibold whitespace-nowrap">Datum/tijd</th>
                  <th className="p-2 text-left font-semibold">Factuur</th>
                  <th className="p-2 text-left font-semibold">Actie</th>
                  <th className="p-2 text-left font-semibold">Details</th>
                  <th className="p-2 text-left font-semibold">Gebruiker</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const inv = invMap[String(e.entity_id)] || {};
                  return (
                    <tr key={e.id} className="border-t border-gray-100 align-top">
                      <td className="p-2 whitespace-nowrap text-[#1B3A5C]/70">{fmtDateTime(e.created_at)}</td>
                      <td className="p-2">
                        <div className="font-mono">{inv.invoice_number || '—'}</div>
                        <div className="text-[10px] text-[#1B3A5C]/40">{inv.vendor_name || ''}</div>
                      </td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${actionColor(e.action)}`}>
                          {labelFor(e)}
                        </span>
                      </td>
                      <td className="p-2 text-[#1B3A5C]/60">{detailBits(e.details).join(' · ') || '—'}</td>
                      <td className="p-2">
                        <div>{e.user_name || '—'}</div>
                        <div className="text-[10px] text-[#1B3A5C]/40">{e.user_role || ''}</div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-[#1B3A5C]/40 italic">Geen regels voor deze filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        // Per factuur: keten
        <div className="space-y-3">
          {byInvoice.length === 0 && (
            <div className="py-10 text-center text-[13px] text-[#1B3A5C]/40 italic">
              Geen facturen met werkstroom-acties gevonden{search ? ' voor deze zoekterm' : ''}.
            </div>
          )}
          {byInvoice.slice(0, 100).map(g => (
            <div key={g.inv.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="font-mono font-bold text-[#1B3A5C]">{g.inv.invoice_number}</span>
                <span className="text-[12px] text-[#1B3A5C]/60">{g.inv.vendor_name}</span>
              </div>
              <ol className="relative border-l-2 border-gray-200 ml-2 space-y-3">
                {g.events.map(e => (
                  <li key={e.id} className="ml-4">
                    <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[#1B3A5C]" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${actionColor(e.action)}`}>
                        {labelFor(e)}
                      </span>
                      <span className="text-[11px] text-[#1B3A5C]/50">{fmtDateTime(e.created_at)}</span>
                      <span className="text-[11px] text-[#1B3A5C]/70">· {e.user_name} ({e.user_role})</span>
                      {detailBits(e.details).length > 0 && (
                        <span className="text-[11px] text-[#1B3A5C]/40">· {detailBits(e.details).join(' · ')}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {byInvoice.length > 100 && (
            <div className="text-[11px] text-[#1B3A5C]/40 italic text-center">
              Eerste 100 facturen getoond — verfijn met de zoekbalk.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
