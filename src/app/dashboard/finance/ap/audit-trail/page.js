/* ============================================================
   BESTAND: ap_audit_trail_page_v3.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/audit-trail/page.js
   (overschrijft v2, hernoemen naar page.js)

   v3 WIJZIGINGEN:
   - Factuurkop toont nu ook PO#, Invoice#, Reference en bedrag
     (bedrag = balance, val terug op original_amount) per factuur.

   DOEL: inzicht in het actie-spoor van de AP-werkstroom.
   Per factuur de keten als tijdlijn-strip met per processtap wanneer
   en door wie; plus chronologische lijst en CSV-export met stap-kolommen.

   v2 WIJZIGINGEN:
   - Correcte stap-mapping op basis van de echte statusovergangen:
       selected            -> Geselecteerd (clerk)
       sent_to_bank        -> Naar bank            (new_status at_bank)
       submitted           -> Goedkeurder 1        (new_status approver_review)
       approved            -> Goedkeurder 2        (new_status approved)
       marked_paid_in_bank -> In bank gezet
       direct_paid/manual_writeoff/marked_paid -> Betaald (directe route)
       match_auto_processed -> 'Uit Open Items'    (new_status processed)
   - 'Per factuur': tijdlijn-strip bovenaan met vaste processtappen.
   - CSV bevat nu per factuur stap-kolommen (op + door per stap).

   Alleen presentatie/labels — er worden geen DB-velden hernoemd.
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../layout';
import Link from 'next/link';

const ACTION_LABELS = {
  selected: 'Geselecteerd voor betaling',
  unselected: 'Selectie teruggedraaid',
  sent_to_bank: 'Naar bank',
  submitted: 'Goedkeurder 1',
  approved: 'Goedkeurder 2',
  marked_paid: 'Betaald gemarkeerd',
  marked_paid_in_bank: 'In bank gezet',
  direct_paid: 'Direct betaald (op papier)',
  manual_writeoff: 'Handmatig afgeboekt',
  rejected: 'Afgewezen',
  auto_matched: 'Automatisch gematcht',
  match_auto_processed: 'Uit Open Items',
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

const CHAIN_ACTIONS = new Set([
  'selected', 'unselected', 'sent_to_bank', 'submitted', 'approved',
  'marked_paid', 'marked_paid_in_bank', 'direct_paid', 'manual_writeoff',
  'rejected', 'match_auto_processed',
  'rolled_back_select', 'rolled_back_submit', 'rolled_back_approve', 'rolled_back_send_to_bank',
]);

// Vaste processtappen: key -> welke acties die stap markeren.
const STEPS = [
  { key: 'selected',    label: 'Geselecteerd',  actions: ['selected'] },
  { key: 'sent_to_bank', label: 'Naar bank',    actions: ['sent_to_bank'] },
  { key: 'approver_1',  label: 'Goedkeurder 1', actions: ['submitted'] },
  { key: 'approver_2',  label: 'Goedkeurder 2', actions: ['approved'] },
  { key: 'in_bank',     label: 'In bank gezet', actions: ['marked_paid_in_bank'] },
  { key: 'direct',      label: 'Direct betaald / afgeboekt', actions: ['direct_paid', 'manual_writeoff', 'marked_paid'] },
  { key: 'out',         label: 'Uit Open Items', actions: ['match_auto_processed'] },
];

function ACTION_LABEL(a) { return ACTION_LABELS[a] || a; }

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDateOnly(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoney(v, cur) {
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  const bedrag = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return `${cur || 'XCG'} ${bedrag}`;
}

function actionColor(action) {
  if (['direct_paid', 'marked_paid', 'marked_paid_in_bank'].includes(action)) return 'bg-emerald-100 text-emerald-800';
  if (['approved', 'submitted'].includes(action)) return 'bg-blue-100 text-blue-800';
  if (action === 'sent_to_bank') return 'bg-indigo-100 text-indigo-800';
  if (action === 'selected') return 'bg-slate-100 text-slate-700';
  if (action === 'match_auto_processed') return 'bg-teal-100 text-teal-800';
  if (['rejected', 'manual_writeoff'].includes(action)) return 'bg-amber-100 text-amber-800';
  if (action.startsWith('rolled_back')) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

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

// Uit een lijst events (chronologisch oplopend) de eerste per stap halen.
function stepMap(events) {
  const m = {};
  for (const step of STEPS) {
    const ev = events.find(e => step.actions.includes(e.action));
    if (ev) m[step.key] = ev;
  }
  return m;
}

export default function AuditTrailPage() {
  const { effectiveRole, entity, entityMeta } = useApRole();
  const supabase = createClient();
  const canUse = ['admin', 'cfo', 'ap_approver', 'ap_clerk', 'ap_bank'].includes(effectiveRole);

  const [view, setView] = useState('invoice'); // 'invoice' | 'chrono'
  const [entries, setEntries] = useState([]);
  const [invMap, setInvMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: invs, error: invErr } = await supabase
        .from('ap_invoices')
        .select('id, invoice_number, vendor_name, po_number, reference, balance, original_amount, currency')
        .eq('entity', entity);
      if (invErr) throw invErr;
      const map = {};
      (invs || []).forEach(i => { map[String(i.id)] = i; });
      setInvMap(map);

      const { data: logs, error: logErr } = await supabase
        .from('ap_audit_log')
        .select('id, action, entity_type, entity_id, user_name, user_role, details, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (logErr) throw logErr;

      setEntries((logs || []).filter(l => l.entity_id && map[String(l.entity_id)]));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, entity]);

  useEffect(() => { load(); }, [load]);

  const users = useMemo(() => Array.from(new Set(entries.map(e => e.user_name).filter(Boolean))).sort(), [entries]);
  const actions = useMemo(() => Array.from(new Set(entries.map(e => e.action))).sort(), [entries]);

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
    return Object.values(groups)
      .map(g => {
        const events = g.events.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
        return { ...g, events, steps: stepMap(events) };
      })
      .sort((a, b) => b.events[b.events.length - 1].created_at.localeCompare(a.events[a.events.length - 1].created_at));
  }, [entries, invMap, search]);

  const exportCsv = useCallback(() => {
    // Per factuur één regel met stap-kolommen.
    const header = [
      'Factuur', 'Vendor', 'PO#', 'Reference', 'Bedrag',
      'Geselecteerd_op', 'Geselecteerd_door',
      'NaarBank_op', 'NaarBank_door', 'NaarBank_bank',
      'Goedkeurder1_op', 'Goedkeurder1_naam',
      'Goedkeurder2_op', 'Goedkeurder2_naam',
      'InBank_op', 'InBank_door',
      'DirectBetaald_op', 'DirectBetaald_door', 'DirectBetaald_datum',
      'UitOpenItems_op',
    ];
    const rows = [header];
    for (const g of byInvoice) {
      const s = g.steps;
      const at = (k) => s[k] ? fmtDateTime(s[k].created_at) : '';
      const by = (k) => s[k] ? (s[k].user_name || '') : '';
      rows.push([
        g.inv.invoice_number || '', g.inv.vendor_name || '',
        g.inv.po_number || '', g.inv.reference || '',
        (fmtMoney(g.inv.balance ?? g.inv.original_amount, g.inv.currency) || ''),
        at('selected'), by('selected'),
        at('sent_to_bank'), by('sent_to_bank'), s.sent_to_bank?.details?.bank || '',
        at('approver_1'), by('approver_1'),
        at('approver_2'), by('approver_2'),
        at('in_bank'), by('in_bank'),
        at('direct'), by('direct'), s.direct?.details?.paid_date || '',
        at('out'),
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_trail_${entity}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [byInvoice, entity]);

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
        <Link href="/dashboard/finance/ap" className="hover:underline">Accounts Payable</Link>
        {' › '}Audit Trail
      </div>
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Audit Trail</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-4">
        Volledig actie-spoor van de werkstroom in {entityMeta?.name} {entityMeta?.sub} — wie wat wanneer deed.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex gap-2 mb-3">
        {[['invoice', 'Per factuur'], ['chrono', 'Chronologisch']].map(([k, l]) => (
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
      ) : view === 'invoice' ? (
        <div className="space-y-3">
          {byInvoice.length === 0 && (
            <div className="py-10 text-center text-[13px] text-[#1B3A5C]/40 italic">
              Geen facturen met werkstroom-acties gevonden{search ? ' voor deze zoekterm' : ''}.
            </div>
          )}
          {byInvoice.slice(0, 100).map(g => (
            <div key={g.inv.id} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono font-bold text-[#1B3A5C]">{g.inv.invoice_number}</span>
                  <span className="text-[12px] text-[#1B3A5C]/60">{g.inv.vendor_name}</span>
                  {fmtMoney(g.inv.balance ?? g.inv.original_amount, g.inv.currency) && (
                    <span className="ml-auto text-[13px] font-bold text-[#1B3A5C]">
                      {fmtMoney(g.inv.balance ?? g.inv.original_amount, g.inv.currency)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-x-4 gap-y-0.5 flex-wrap mt-1 text-[11px] text-[#1B3A5C]/50">
                  <span>Invoice#: <span className="font-mono text-[#1B3A5C]/70">{g.inv.invoice_number || '—'}</span></span>
                  <span>PO#: <span className="font-mono text-[#1B3A5C]/70">{g.inv.po_number || '—'}</span></span>
                  <span>Reference: <span className="text-[#1B3A5C]/70">{g.inv.reference || '—'}</span></span>
                </div>
              </div>
              <StepStrip steps={g.steps} />
              <details className="mt-3">
                <summary className="text-[11px] text-[#1B3A5C]/50 cursor-pointer hover:text-[#1B3A5C]">Alle gebeurtenissen</summary>
                <ol className="relative border-l-2 border-gray-200 ml-2 mt-2 space-y-2">
                  {g.events.map(e => (
                    <li key={e.id} className="ml-4">
                      <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[#1B3A5C]" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${actionColor(e.action)}`}>{ACTION_LABEL(e.action)}</span>
                        <span className="text-[11px] text-[#1B3A5C]/50">{fmtDateTime(e.created_at)}</span>
                        <span className="text-[11px] text-[#1B3A5C]/70">· {e.user_name} ({e.user_role})</span>
                        {detailBits(e.details).length > 0 && (
                          <span className="text-[11px] text-[#1B3A5C]/40">· {detailBits(e.details).join(' · ')}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          ))}
          {byInvoice.length > 100 && (
            <div className="text-[11px] text-[#1B3A5C]/40 italic text-center">Eerste 100 facturen getoond — verfijn met de zoekbalk.</div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap bg-[#f8fafc] rounded-xl px-4 py-2.5 border border-gray-100">
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white">
              <option value="all">Alle acties</option>
              {actions.map(a => <option key={a} value={a}>{ACTION_LABEL(a)}</option>)}
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
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${actionColor(e.action)}`}>{ACTION_LABEL(e.action)}</span>
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
      )}
    </div>
  );
}

// Tijdlijn-strip: vaste processtappen met datum + functionaris, of grijs indien niet doorlopen.
function StepStrip({ steps }) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto">
      {STEPS.map((step, idx) => {
        const ev = steps[step.key];
        const done = !!ev;
        return (
          <div key={step.key} className="flex items-stretch gap-1 flex-shrink-0">
            <div className={`rounded-lg px-3 py-2 min-w-[120px] border ${done ? 'bg-white border-[#1B3A5C]/20' : 'bg-gray-50 border-gray-100'}`}>
              <div className={`text-[11px] font-bold ${done ? 'text-[#1B3A5C]' : 'text-[#1B3A5C]/30'}`}>{step.label}</div>
              {done ? (
                <>
                  <div className="text-[11px] text-[#1B3A5C]/70">{fmtDateOnly(ev.created_at)}</div>
                  <div className="text-[10px] text-[#1B3A5C]/45 truncate">{ev.user_name}</div>
                </>
              ) : (
                <div className="text-[10px] text-[#1B3A5C]/25 italic">—</div>
              )}
            </div>
            {idx < STEPS.length - 1 && (
              <div className="flex items-center text-[#1B3A5C]/20 text-[12px]">›</div>
            )}
          </div>
        );
      })}
    </div>
  );
}