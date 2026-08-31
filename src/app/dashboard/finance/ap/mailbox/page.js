/* ============================================================
   BESTAND: ap_mailbox_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/mailbox/page.js  (VERVANGT bestaande)

   PRODUCTIE — werkt op ap_mailbox / ap_mailbox_routing / ap_audit_log.
   VEREIST: kolom ap_mailbox.due_date (zie STAP_SQL_due_date.sql).

   Werklijst van de AP-mailbox (Model B: portal is bron van waarheid):
   - Elke mail = 1 rij, geclassificeerd + gekruist met invoice_ledger.
   - Categorie + toewijzing bewerkbaar; bestemming kiezen; reeds-betaald
     automatisch afgevangen. Overzichtstabel bovenaan (voorraad+ouderdom),
     freeze panes op Datum+Leverancier, Excel-export van alle acties.
   - NIEUW: Deadline per mail (streefdatum) + "Werklijst"-weergave per persoon
     per dag. Te laat = rood, met teller per persoon in de verdelingsstrook.
   - "Openen": originele mail (met PDF-bijlage) in Outlook openen.
   - "Splitsen": mail met meerdere facturen opsplitsen in losse regels.
   - "Factuur gevraagd" opent de leveranciersmail (NL+EN) → /api/mailbox/resend-request.
   ============================================================ */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../layout';
import { exportToExcel } from '@/lib/excelExport';

const DEST = [
  { key: 'geboekt',          label: 'Geboekt' },
  { key: 'reeds_geboekt',    label: 'Reeds geboekt' },
  { key: 'factuur_gevraagd', label: 'Factuur gevraagd' },
  { key: 'reeds_betaald',    label: 'Reeds betaald' },
  { key: 'info_bericht',     label: 'Info-berichten' },
];
const FOLDER_OF = {
  geboekt: 'Geboekt', reeds_geboekt: 'Reeds geboekt', factuur_gevraagd: 'Factuur gevraagd',
  reeds_betaald: 'Reeds betaald', info_bericht: 'Info-berichten', handmatig_opgelost: 'Info-berichten',
};
const OPEN_STATUS = ['nieuw', 'toegewezen', 'in_behandeling'];
const FOLDERS = [
  { key: 'inbox',            label: 'Inbox (werklijst)', test: (r) => OPEN_STATUS.includes(r.status) },
  { key: 'geboekt',          label: 'Geboekt',           test: (r) => r.status === 'geboekt' },
  { key: 'reeds_geboekt',    label: 'Reeds geboekt',     test: (r) => r.status === 'reeds_geboekt' },
  { key: 'factuur_gevraagd', label: 'Factuur gevraagd',  test: (r) => r.status === 'factuur_gevraagd' },
  { key: 'reeds_betaald',    label: 'Reeds betaald',     test: (r) => r.status === 'reeds_betaald' },
  { key: 'info',             label: 'Info-berichten',    test: (r) => ['info_bericht', 'handmatig_opgelost'].includes(r.status) },
];
const CAT_OPTS = [
  { key: 'factuur', label: 'Factuur' }, { key: 'statement', label: 'Statement' },
  { key: 'overig', label: 'Overig' }, { key: 'onbekend', label: 'Onbekend' },
];
const CLERK_COLORS = ['#2f6fed', '#7a45c4', '#1f8a52', '#c77700', '#c0392b', '#0b7285'];

// De drie AP Clerks die het werk verdelen (profiles.id).
const LADIES = [
  { id: 'e39b2531-47be-4ea6-93e6-7ceb783e1fdb', label: 'Daya' },
  { id: 'b6517206-ec69-4989-ae81-601ba573dca8', label: 'Mel' },
  { id: 'aa906f68-e000-455f-95f1-67b7b69140f8', label: 'Ethy' },
];
const LADY_IDS = LADIES.map((l) => l.id);
// Legenda — wie hoort welke leverancier/kostensoort te krijgen.
const ASSIGN_LEGEND = [
  { who: 'Daya', wat: 'Ivo en John' },
  { who: 'Mel',  wat: 'Kosten, Daniel, RCC en MMC' },
  { who: 'Etty', wat: 'Gijs, Henk en Bonaire' },
];

// Deadline-groepen voor de werklijst (per dag), in vaste volgorde.
const DUE_ORDER = [
  { key: 'te_laat',   label: 'Te laat',      dot: '#c0392b', head: 'text-red-700' },
  { key: 'vandaag',   label: 'Vandaag',      dot: '#2f6fed', head: 'text-[#1B3A5C]' },
  { key: 'morgen',    label: 'Morgen',       dot: '#0b7285', head: 'text-[#1B3A5C]' },
  { key: 'deze_week', label: 'Deze week',    dot: '#7a45c4', head: 'text-[#1B3A5C]/80' },
  { key: 'later',     label: 'Later',        dot: '#1f8a52', head: 'text-[#1B3A5C]/60' },
  { key: 'geen',      label: 'Zonder datum', dot: '#98a2b3', head: 'text-[#1B3A5C]/45' },
];

function fmtMoney(v, cur) {
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  return (cur || 'XCG') + ' ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' }) : '—'; }
function fmtDateTime(s) {
  return s ? new Date(s).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
function daysOpen(s) { return s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000)) : 0; }
function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}
function ledgerPill(m) {
  switch (m) {
    case 'niet_geboekt':    return ['Te boeken', 'bg-amber-50 text-amber-700 border-amber-200'];
    case 'geboekt_open':    return ['Al geboekt · open', 'bg-blue-50 text-blue-700 border-blue-200'];
    case 'geboekt_betaald': return ['Reeds betaald', 'bg-emerald-50 text-emerald-700 border-emerald-200'];
    case 'geen_match':      return ['Geen match', 'bg-gray-50 text-gray-600 border-gray-200'];
    default:                return ['Uitzoeken', 'bg-purple-50 text-purple-700 border-purple-200'];
  }
}
// Lokale datum als YYYY-MM-DD (matcht het formaat van een Postgres date-kolom).
function ymd(d) { return d.toLocaleDateString('en-CA'); }

export default function MailboxPage() {
  const supabase = createClient();
  const ctx = useApRole();
  const { effectiveProfileId, effectiveName, effectiveRole } = ctx;

  const [rows, setRows] = useState([]);
  const [clerks, setClerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [rules, setRules] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());

  const [view, setView] = useState('mailbox');   // 'mailbox' | 'werklijst'
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [fClerk, setFClerk] = useState('');
  const [fCat, setFCat] = useState('');
  const [fEnt, setFEnt] = useState('');
  const [mail, setMail] = useState(null);
  const [sort, setSort] = useState({ key: 'received_at', dir: 'asc' });

  // Datum-ankers (vandaag / morgen / einde week) — lokaal, als YYYY-MM-DD.
  const todayStr = ymd(new Date());
  const tomorrowStr = ymd(new Date(Date.now() + 86400000));
  const weekStr = ymd(new Date(Date.now() + 7 * 86400000));

  const clerkColor = useCallback((id) => {
    const i = clerks.findIndex((c) => c.id === id);
    return CLERK_COLORS[i >= 0 ? i % CLERK_COLORS.length : 0];
  }, [clerks]);
  const clerkName = useCallback((id) => clerks.find((c) => c.id === id)?.full_name || '', [clerks]);

  // Streefdatum-helpers
  const isOpen = (r) => OPEN_STATUS.includes(r.status);
  const isOverdue = (r) => !!r.due_date && r.due_date < todayStr && isOpen(r);
  const dueBucket = useCallback((r) => {
    if (!r.due_date) return 'geen';
    if (r.due_date < todayStr) return 'te_laat';
    if (r.due_date === todayStr) return 'vandaag';
    if (r.due_date === tomorrowStr) return 'morgen';
    if (r.due_date <= weekStr) return 'deze_week';
    return 'later';
  }, [todayStr, tomorrowStr, weekStr]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [{ data: mb, error: e1 }, { data: cl }, { data: meta }, { data: sn }, { data: rl }] = await Promise.all([
      supabase.from('ap_mailbox').select('*').order('received_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name, role').in('role', ['ap_clerk', 'admin']).eq('is_active', true).order('full_name'),
      supabase.from('ap_mailbox_meta').select('value_ts').eq('key', 'last_sync_at').maybeSingle(),
      supabase.from('ap_mailbox_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(120),
      supabase.from('ap_mailbox_routing').select('match_type, match_value, clerk_id, active'),
    ]);
    if (e1) setErr(e1.message);
    setRows((mb || []).map((r) => ({ ...r, _age: daysOpen(r.received_at) })));
    setClerks(cl || []);
    setLastSync(meta?.value_ts || null);
    setSnaps(sn || []);
    setRules(rl || []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function audit(action, entityId, details) {
    try {
      await supabase.from('ap_audit_log').insert({
        action, entity_type: 'mailbox', entity_id: String(entityId),
        user_id: effectiveProfileId, user_name: effectiveName, user_role: effectiveRole, details: details || {},
      });
    } catch (_) {}
  }

  async function patch(id, fields, action, details) {
    setBusy(true);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    const { error } = await supabase.from('ap_mailbox').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setErr(error.message); await load(); }
    else if (action) await audit(action, id, details);
    setBusy(false);
  }

  async function setCategory(row, doc_type) { await patch(row.id, { doc_type }, 'categorie', { van: row.doc_type, naar: doc_type }); }

  async function setDue(row, dateStr) {
    const val = dateStr || null;
    await patch(row.id, { due_date: val }, 'deadline', { van: row.due_date || null, naar: val });
  }

  async function assign(row, clerkId) {
    // Alleen toewijzen. Het "voortaan altijd"-leren gebeurt via de voorstellen-strook bovenaan
    // (verschijnt zodra je een leverancier vaak genoeg aan dezelfde persoon toewijst).
    const fields = { assigned_clerk: clerkId || null, assigned_at: clerkId ? new Date().toISOString() : null, assigned_by: effectiveProfileId };
    if (clerkId && row.status === 'nieuw') fields.status = 'toegewezen';
    await patch(row.id, fields, 'toegewezen', { clerk: clerkName(clerkId) });
  }

  async function applyRouting(vendor, clerkId) {
    setBusy(true);
    await supabase.from('ap_mailbox_routing').upsert(
      { match_type: 'vendor_name', match_value: vendor, clerk_id: clerkId, active: true, created_by: effectiveProfileId },
      { onConflict: 'match_type,match_value' });
    const targets = rows.filter((r) => r.vendor_guess === vendor && ['nieuw', 'toegewezen'].includes(r.status));
    for (const t of targets) {
      await supabase.from('ap_mailbox').update({
        assigned_clerk: clerkId, assigned_at: new Date().toISOString(), status: t.status === 'nieuw' ? 'toegewezen' : t.status,
      }).eq('id', t.id);
    }
    await audit('routing', vendor, { clerk: clerkName(clerkId), aantal: targets.length });
    await load(); setBusy(false);
  }

  function dismissSuggestion(vendor) { setDismissed((d) => new Set(d).add((vendor || '').toLowerCase())); }
  async function acceptSuggestion(vendor, clerkId) { await applyRouting(vendor, clerkId); }

  async function setDest(row, key) {
    if (!key) return;
    if (key === 'factuur_gevraagd') {
      const ext = row.sender_email && !/building-depot\.net$/i.test(row.sender_email) ? row.sender_email : '';
      setMail({ row, to: ext, kind: 'invoice' });
      return;
    }
    await patch(row.id, {
      status: key, outlook_folder: FOLDER_OF[key],
      resolved_by: effectiveProfileId, resolved_at: new Date().toISOString(), resolution: key,
    }, 'bestemming', { naar: key });
  }

  async function splitRow(row) {
    const nStr = window.prompt(`"${row.vendor_guess || 'deze mail'}" — in hoeveel facturen splitsen?`, String(row.part_count || 2));
    const n = parseInt(nStr, 10);
    if (!n || n < 2 || n > 20) return;
    setBusy(true);
    try {
      await supabase.from('ap_mailbox').update({ part_no: 1, part_count: n }).eq('id', row.id);
      const kids = [];
      for (let i = 2; i <= n; i++) {
        kids.push({
          graph_message_id: null, parent_id: row.parent_id || row.id, part_no: i, part_count: n,
          received_at: row.received_at, sender_email: row.sender_email, sender_name: row.sender_name,
          subject: row.subject, has_attachments: row.has_attachments, web_link: row.web_link,
          entity: row.entity, vendor_guess: row.vendor_guess, doc_type: row.doc_type,
          po_number: row.po_number, currency: row.currency, ledger_match: 'onbekend', due_date: row.due_date,
          assigned_clerk: row.assigned_clerk, status: row.assigned_clerk ? 'toegewezen' : 'nieuw', outlook_folder: 'Inbox',
        });
      }
      const { error } = await supabase.from('ap_mailbox').insert(kids);
      if (error) throw error;
      await audit('splitsen', row.id, { delen: n });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function sendResend() {
    if (!mail) return;
    setBusy(true);
    try {
      const res = await fetch('/api/mailbox/resend-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: mail.to, vendor: mail.row.vendor_guess, invoice_number: mail.row.invoice_number, kind: mail.kind || 'invoice' }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Versturen mislukt');
      const resolution = mail.kind === 'statement' ? 'facturen_gevraagd' : 'factuur_gevraagd';
      await patch(mail.row.id, {
        status: 'factuur_gevraagd', outlook_folder: 'Factuur gevraagd',
        resolved_by: effectiveProfileId, resolved_at: new Date().toISOString(), resolution,
      }, resolution, { to: mail.to, kind: mail.kind || 'invoice' });
      setMail(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const passFilter = useCallback((r) => {
    if (fClerk === '__none__') { if (r.assigned_clerk) return false; }
    else if (fClerk === '__other__') { if (!r.assigned_clerk || LADY_IDS.includes(r.assigned_clerk)) return false; }
    else if (fClerk) { if (r.assigned_clerk !== fClerk) return false; }
    if (fCat && r.doc_type !== fCat) return false;
    if (fEnt && r.entity !== fEnt) return false;
    if (q) {
      const h = `${r.vendor_guess || ''} ${r.invoice_number || ''} ${r.po_number || ''} ${r.subject || ''}`.toLowerCase();
      if (!h.includes(q.toLowerCase())) return false;
    }
    return true;
  }, [fClerk, fCat, fEnt, q]);

  // Filter zonder de persoon-filter (voor de werklijst, die zelf per persoon groepeert).
  const passNoClerk = useCallback((r) => {
    if (fCat && r.doc_type !== fCat) return false;
    if (fEnt && r.entity !== fEnt) return false;
    if (q) {
      const h = `${r.vendor_guess || ''} ${r.invoice_number || ''} ${r.po_number || ''} ${r.subject || ''}`.toLowerCase();
      if (!h.includes(q.toLowerCase())) return false;
    }
    return true;
  }, [fCat, fEnt, q]);

  const SORT_ACC = {
    received_at: (r) => r.received_at || '',
    vendor_guess: (r) => (r.vendor_guess || '').toLowerCase(),
    ref: (r) => (r.invoice_number || r.po_number || '').toLowerCase(),
    amount: (r) => (r.amount == null ? Number.NEGATIVE_INFINITY : parseFloat(r.amount)),
    doc_type: (r) => r.doc_type || '',
    ledger_match: (r) => r.ledger_match || '',
    assigned: (r) => clerkName(r.assigned_clerk).toLowerCase(),
    due_date: (r) => r.due_date || '9999-12-31',   // zonder datum achteraan
  };
  const folderRows = useMemo(() => {
    const f = FOLDERS.find((x) => x.key === folder);
    const list = rows.filter(f.test).filter(passFilter);
    const acc = SORT_ACC[sort.key] || SORT_ACC.received_at;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = acc(a), bv = acc(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [rows, folder, passFilter, sort, clerkName]);

  const counts = useMemo(() => {
    const c = {}; FOLDERS.forEach((f) => { c[f.key] = rows.filter(f.test).length; }); return c;
  }, [rows]);
  const entities = useMemo(() => [...new Set(rows.map((r) => r.entity).filter(Boolean))].sort(), [rows]);
  const overview = useMemo(() => {
    const base = rows.filter(FOLDERS[0].test).filter(passFilter);
    const b = [0, 0, 0, 0];
    base.forEach((r) => { const a = r._age; if (a <= 2) b[0]++; else if (a <= 7) b[1]++; else if (a <= 30) b[2]++; else b[3]++; });
    return { total: base.length, buckets: b };
  }, [rows, passFilter]);

  // Verdeling van de open werklijst over de drie dames + niet toegewezen + overig,
  // inclusief hoeveel er per persoon TE LAAT zijn (deadline voorbij).
  const verdeling = useMemo(() => {
    const open = rows.filter(FOLDERS[0].test);
    const c = { none: 0, other: 0 };
    const late = { none: 0, other: 0 };
    LADY_IDS.forEach((id) => { c[id] = 0; late[id] = 0; });
    open.forEach((r) => {
      const bucket = !r.assigned_clerk ? 'none' : (LADY_IDS.includes(r.assigned_clerk) ? r.assigned_clerk : 'other');
      c[bucket]++;
      if (r.due_date && r.due_date < todayStr) late[bucket]++;
    });
    return { c, late };
  }, [rows, todayStr]);
  const scopeLabel = (v) => (v === '__none__' ? 'niet toegewezen' : v === '__other__' ? 'overig' : (LADIES.find((l) => l.id === v)?.label || 'alle clerks'));

  // Werklijst: open items gegroepeerd per persoon, daarbinnen per deadline-dag.
  const werklijst = useMemo(() => {
    const base = rows.filter(FOLDERS[0].test).filter(passNoClerk);
    const byClerk = new Map();
    base.forEach((r) => {
      const k = r.assigned_clerk && LADY_IDS.includes(r.assigned_clerk) ? r.assigned_clerk
        : (r.assigned_clerk ? `other:${r.assigned_clerk}` : '__none__');
      if (!byClerk.has(k)) byClerk.set(k, []);
      byClerk.get(k).push(r);
    });
    // Volgorde: de drie dames, dan overige toegewezen personen, dan niet-toegewezen.
    const order = [...LADY_IDS];
    [...byClerk.keys()].forEach((k) => { if (k.startsWith('other:')) order.push(k); });
    order.push('__none__');
    const seen = new Set();
    const groups = [];
    order.forEach((k) => {
      if (seen.has(k)) return; seen.add(k);
      const items = byClerk.get(k) || [];
      if (k === '__none__' && items.length === 0) return;      // lege 'niet toegewezen' niet tonen
      if (k.startsWith('other:') && items.length === 0) return;
      const clerkId = k === '__none__' ? null : (k.startsWith('other:') ? k.slice(6) : k);
      const label = k === '__none__' ? 'Niet toegewezen' : (LADIES.find((l) => l.id === clerkId)?.label || clerkName(clerkId) || 'Onbekend');
      // groepeer per deadline-bucket
      const buckets = {};
      DUE_ORDER.forEach((d) => { buckets[d.key] = []; });
      items.forEach((r) => { buckets[dueBucket(r)].push(r); });
      Object.values(buckets).forEach((arr) => arr.sort((a, b) =>
        (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1
          : (a.received_at || '') < (b.received_at || '') ? -1 : 1));
      const late = items.filter((r) => r.due_date && r.due_date < todayStr).length;
      groups.push({ key: k, clerkId, label, total: items.length, late, buckets });
    });
    return groups;
  }, [rows, passNoClerk, dueBucket, todayStr, clerkName]);

  // Wekelijkse KPI-historie (maandag-metingen) — beweegt mee met de naam-filter.
  const scopeClerkId = fClerk && fClerk !== '__none__' && fClerk !== '__other__' ? fClerk : null;
  const history = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const s of snaps) {
      if (scopeClerkId ? s.clerk_id !== scopeClerkId : s.clerk_id !== null) continue;
      if (seen.has(s.snapshot_date)) continue;
      seen.add(s.snapshot_date); out.push(s);
      if (out.length >= 4) break;
    }
    return out;
  }, [snaps, scopeClerkId]);

  // Voorstellen: leverancier die >=3x handmatig naar dezelfde persoon ging, nog geen vaste regel,
  // en met een duidelijke voorkeur (geen split over meerdere personen, bv. per entiteit).
  const suggestions = useMemo(() => {
    const ruleVendors = new Set(rules.filter((r) => r.active && r.match_type === 'vendor_name').map((r) => (r.match_value || '').toLowerCase()));
    const byVendor = new Map();
    rows.forEach((r) => {
      if (!r.assigned_clerk || !r.vendor_guess || r.vendor_guess === '(onbekend)') return;
      if (!byVendor.has(r.vendor_guess)) byVendor.set(r.vendor_guess, {});
      const t = byVendor.get(r.vendor_guess);
      t[r.assigned_clerk] = (t[r.assigned_clerk] || 0) + 1;
    });
    const out = [];
    byVendor.forEach((tally, vendor) => {
      if (ruleVendors.has(vendor.toLowerCase()) || dismissed.has(vendor.toLowerCase())) return;
      const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const [topClerk, topN] = entries[0];
      const secondN = entries[1] ? entries[1][1] : 0;
      if (topN >= 3 && secondN < 2) out.push({ vendor, clerkId: topClerk, count: topN });
    });
    return out.sort((a, b) => b.count - a.count).slice(0, 6);
  }, [rows, rules, dismissed]);

  function sortBy(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  const arrow = (k) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');

  async function doExport() {
    const rowsOut = rows.filter(passFilter).map((r) => ({
      Datum: fmtDate(r.received_at), Leverancier: r.vendor_guess || '',
      'Factuur/PO': r.invoice_number || r.po_number || '', Deel: r.part_count ? `${r.part_no}/${r.part_count}` : '',
      Bedrag: r.amount != null ? fmtMoney(r.amount, r.currency) : '', Categorie: r.doc_type,
      'Ledger-status': r.ledger_match, Toegewezen: clerkName(r.assigned_clerk),
      Deadline: r.due_date ? new Date(r.due_date).toLocaleDateString('nl-NL') : '',
      'Te laat': isOverdue(r) ? 'JA' : '',
      Bestemming: r.outlook_folder || '', Status: r.status,
      'Opgelost door': clerkName(r.resolved_by), 'Opgelost op': r.resolved_at ? new Date(r.resolved_at).toLocaleString('nl-NL') : '',
      Onderwerp: r.subject || '',
    }));
    await exportToExcel({ filename: 'AP_Mailbox_acties', reportTitle: 'AP Mailbox — genomen acties', sheets: [{ name: 'Mailbox', rows: rowsOut }] });
  }

  // ---- kleine, herbruikbare bewerk-velden (tabel + werklijst) ----
  const dueInput = (r) => (
    <input type="date" value={r.due_date || ''} onChange={(e) => setDue(r, e.target.value)} disabled={busy}
      title="Streefdatum — wanneer moet dit af zijn?"
      className={`text-[12px] px-1.5 py-1 border rounded-lg bg-white ${isOverdue(r) ? 'border-red-400 text-red-700 font-semibold' : (r.due_date ? 'border-gray-200 text-[#1B3A5C]' : 'border-dashed border-gray-300 text-[#1B3A5C]/50')}`} />
  );
  const assignSelect = (r, compact) => (
    <div className="flex items-center gap-1.5">
      {r.assigned_clerk && (
        <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[10px] font-bold shrink-0" style={{ background: clerkColor(r.assigned_clerk) }}>
          {initials(clerkName(r.assigned_clerk))}
        </span>
      )}
      <select value={r.assigned_clerk || ''} onChange={(e) => assign(r, e.target.value)} disabled={busy}
        className={`text-[12.5px] px-2 py-1 border rounded-lg bg-white ${r.assigned_clerk ? 'border-gray-200 text-[#1B3A5C]' : 'border-dashed border-gray-300 text-[#1B3A5C]/50'} ${compact ? 'max-w-[130px]' : ''}`}>
        <option value="">Toewijzen…</option>
        {clerks.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
      </select>
    </div>
  );
  const destSelect = (r) => {
    const curDest = ['geboekt', 'reeds_geboekt', 'factuur_gevraagd', 'reeds_betaald', 'info_bericht'].includes(r.status) ? r.status : '';
    return (
      <select value={curDest} onChange={(e) => setDest(r, e.target.value)} disabled={busy}
        className="text-[12.5px] px-2 py-1 border border-gray-200 rounded-lg bg-white">
        <option value="">{curDest ? '— verplaatsen —' : 'Actie kiezen…'}</option>
        {DEST.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
      </select>
    );
  };

  if (loading) return <div className="text-[14px] text-[#1B3A5C]/40 py-10">Mailbox laden…</div>;

  const totalLate = verdeling.late.none + verdeling.late.other + LADY_IDS.reduce((s, id) => s + (verdeling.late[id] || 0), 0);

  return (
    <div className="max-w-[1500px]">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-[20px] font-extrabold text-[#1B3A5C]">Mailbox</h1>
        <span className="text-[12px] text-[#1B3A5C]/50">{rows.length} berichten · {counts.inbox} in werklijst</span>
        <span className="text-[12px] text-[#1B3A5C]/40" title="Moment waarop de mailbox voor het laatst automatisch is opgehaald">🕑 Laatst bijgewerkt: {fmtDateTime(lastSync)}</span>

        {/* Weergave-schakelaar: gewone mailbox of de dagelijkse werklijst per persoon */}
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setView('mailbox')}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${view === 'mailbox' ? 'bg-white text-[#1B3A5C] shadow-sm' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C]'}`}>📥 Mailbox</button>
          <button onClick={() => setView('werklijst')}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 ${view === 'werklijst' ? 'bg-white text-[#1B3A5C] shadow-sm' : 'text-[#1B3A5C]/60 hover:text-[#1B3A5C]'}`}>
            📋 Werklijst
            {totalLate > 0 && <span className="text-[10px] font-bold text-white bg-[#c0392b] rounded-full px-1.5">{totalLate}</span>}
          </button>
        </div>
        <button onClick={doExport} disabled={busy}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white hover:bg-[#152e49] disabled:opacity-50">
          ⬇ Exporteer acties (Excel)
        </button>
      </div>

      {/* Verdeling per persoon — bovenaan; klik om meteen op die persoon te filteren.
          Rechts van het aantal: hoeveel er TE LAAT zijn (rode teller per persoon). */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#1B3A5C]/45 mr-1">👥 Verdeling werklijst</span>
        {[...LADIES.map((l) => ({ key: l.id, label: l.label })), { key: '__none__', label: 'Niet toegewezen' }, { key: '__other__', label: 'Overig' }].map((b) => {
          const cnt = b.key === '__none__' ? verdeling.c.none : b.key === '__other__' ? verdeling.c.other : (verdeling.c[b.key] || 0);
          const late = b.key === '__none__' ? verdeling.late.none : b.key === '__other__' ? verdeling.late.other : (verdeling.late[b.key] || 0);
          const active = fClerk === b.key;
          return (
            <button key={b.key} onClick={() => setFClerk(active ? '' : b.key)}
              title="Klik om alleen deze regels te tonen"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12.5px] border transition-colors ${active ? 'border-[#2f6fed] bg-blue-50 text-[#1B3A5C]' : 'border-gray-200 bg-white text-[#1B3A5C]/80 hover:bg-gray-50'}`}>
              <span className="font-medium">{b.label}</span>
              <span className="font-bold tabular-nums">{cnt}</span>
              {late > 0 && <span className="text-[10px] font-bold text-white bg-[#c0392b] rounded-full px-1.5 tabular-nums" title={`${late} te laat`}>⏰ {late}</span>}
            </button>
          );
        })}
        {fClerk && <button onClick={() => setFClerk('')} className="text-[12px] text-[#2f6fed] hover:underline ml-1">× filter wissen</button>}
      </div>

      {err && <div className="mb-3 text-[12px] bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{err}</div>}

      {/* voorstellen — leren met melding */}
      {suggestions.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[12px] font-semibold text-amber-900 mb-2">💡 Voorstellen — vaste toewijzing leren</div>
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <div key={s.vendor} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <span className="text-amber-900">Je wijst <b>{s.vendor}</b> vaak toe aan <b>{clerkName(s.clerkId)}</b> ({s.count}×). Voortaan altijd?</span>
                <button onClick={() => acceptSuggestion(s.vendor, s.clerkId)} disabled={busy}
                  className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-[#1B3A5C] text-white hover:bg-[#152e49] disabled:opacity-50">✓ Vaste regel maken</button>
                <button onClick={() => dismissSuggestion(s.vendor)} className="text-[12px] text-amber-800/70 hover:underline">negeren</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* overzicht (volle breedte) */}
      <div className="mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3 overflow-x-auto">
          <div className="text-[12px] font-semibold text-[#1B3A5C]/60 mb-2">
            📈 Openstaand in werklijst — beweegt mee met de naam-filter
            <span className="ml-2 font-normal">· {scopeLabel(fClerk)}{fEnt ? ` · ${fEnt}` : ''}{fCat ? ` · ${fCat}` : ''}</span>
          </div>
          <table className="text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#1B3A5C]/50">
                <th className="text-left font-semibold px-3 py-1.5">Peildatum</th>
                <th className="text-right font-semibold px-3 py-1.5">Totaal</th>
                <th className="text-right font-semibold px-3 py-1.5">0–2 d</th>
                <th className="text-right font-semibold px-3 py-1.5">3–7 d</th>
                <th className="text-right font-semibold px-3 py-1.5">8–30 d</th>
                <th className="text-right font-semibold px-3 py-1.5">30+ d</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold text-[#1B3A5C] border-t border-gray-100">
                <td className="text-left px-3 py-1.5">Nu</td>
                <td className="text-right px-3 py-1.5">{overview.total}</td>
                {overview.buckets.map((x, i) => <td key={i} className="text-right px-3 py-1.5">{x}</td>)}
              </tr>
              {history.length === 0 ? (
                <tr className="border-t border-gray-100">
                  <td colSpan={6} className="text-left px-3 py-2 text-[11px] text-[#1B3A5C]/40 italic">Nog geen meting — de historie vult zich vanaf de eerstvolgende maandag.</td>
                </tr>
              ) : history.map((s) => (
                <tr key={s.snapshot_date} className="text-[#1B3A5C]/55 border-t border-gray-100">
                  <td className="text-left px-3 py-1.5">{fmtDate(s.snapshot_date)}</td>
                  <td className="text-right px-3 py-1.5">{s.assigned_open}</td>
                  <td className="text-right px-3 py-1.5">{s.age_0_2}</td>
                  <td className="text-right px-3 py-1.5">{s.age_3_7}</td>
                  <td className="text-right px-3 py-1.5">{s.age_8_30}</td>
                  <td className="text-right px-3 py-1.5">{s.age_30plus}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-[#1B3A5C]/40 mt-1 italic">Wekelijkse meting (maandag 07:00). De bovenste rij "Nu" is live; de rijen eronder zijn eerdere metingen.</div>
        </div>
      </div>

      {view === 'werklijst' ? (
        /* ====================== WERKLIJST — per persoon, per dag ====================== */
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek leverancier, factuur, PO…"
              className="text-[13px] px-3 py-1.5 border border-gray-200 rounded-lg min-w-[220px]" />
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="text-[13px] px-2 py-1.5 border border-gray-200 rounded-lg">
              <option value="">Alle categorieën</option>
              {CAT_OPTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select value={fEnt} onChange={(e) => setFEnt(e.target.value)} className="text-[13px] px-2 py-1.5 border border-gray-200 rounded-lg">
              <option value="">Alle entiteiten</option>
              {entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <span className="text-[12px] text-[#1B3A5C]/50">Loop de lijst af, zet per mail een persoon én een streefdatum. Te laat = rood.</span>
          </div>

          {werklijst.length === 0 && (
            <div className="text-center text-[#1B3A5C]/40 py-10 border border-gray-200 rounded-xl bg-white">Geen openstaande werklijst met de huidige filters.</div>
          )}

          <div className="space-y-4">
            {werklijst.map((g) => (
              <div key={g.key} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                {/* kop per persoon */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-[#f7f9fc] border-b border-gray-200">
                  {g.clerkId
                    ? <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full text-white text-[11px] font-bold" style={{ background: clerkColor(g.clerkId) }}>{initials(g.label)}</span>
                    : <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-gray-300 text-white text-[11px] font-bold">?</span>}
                  <span className="font-bold text-[#1B3A5C] text-[14px]">{g.label}</span>
                  <span className="text-[12px] text-[#1B3A5C]/50">{g.total} open</span>
                  {g.late > 0 && <span className="text-[11px] font-bold text-white bg-[#c0392b] rounded-full px-2 py-0.5">⏰ {g.late} te laat</span>}
                </div>

                {/* per deadline-dag */}
                <div className="divide-y divide-gray-100">
                  {DUE_ORDER.filter((d) => g.buckets[d.key].length > 0).map((d) => (
                    <div key={d.key}>
                      <div className={`flex items-center gap-2 px-4 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide ${d.head}`}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: d.dot }} />
                        {d.label}
                        <span className="text-[#1B3A5C]/35 font-semibold">{g.buckets[d.key].length}</span>
                      </div>
                      {g.buckets[d.key].map((r) => (
                        <div key={r.id} className={`flex items-start gap-3 px-4 py-2 hover:bg-[#f8fafd] ${d.key === 'te_laat' ? 'bg-red-50/40' : ''}`}>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-[#1B3A5C] text-[13px] flex items-center gap-1.5 flex-wrap">
                              {r.vendor_guess || '—'}
                              {r.entity && <span className="text-[10px] font-bold text-[#1B3A5C]/50 bg-gray-100 rounded px-1">{r.entity}</span>}
                              {(r.invoice_number || r.po_number) && <span className="text-[11px] font-normal text-[#1B3A5C]/50 tabular-nums">· {r.invoice_number || `PO ${r.po_number}`}</span>}
                              {r.part_count > 1 && <span className="text-[10px] font-bold text-white bg-[#7a45c4] rounded px-1">deel {r.part_no}/{r.part_count}</span>}
                            </div>
                            <div className="text-[11.5px] text-[#1B3A5C]/45 truncate max-w-[520px]" title={r.subject}>{r.subject}</div>
                            {r.web_link && <a href={r.web_link} target="_blank" rel="noreferrer" className="text-[11px] text-[#2f6fed] hover:underline">↗ Openen (met bijlage)</a>}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            {dueInput(r)}
                            {assignSelect(r, true)}
                            {destSelect(r)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ====================== GEWONE MAILBOX ====================== */
        <>
          {/* tabs */}
          <div className="flex gap-1 border-b border-gray-200 mb-3 flex-wrap">
            {FOLDERS.map((f) => (
              <button key={f.key} onClick={() => setFolder(f.key)}
                className={`px-3.5 py-2 text-[13px] font-medium border-b-2 -mb-px flex items-center gap-2 ${folder === f.key ? 'text-[#1B3A5C] border-[#2f6fed]' : 'text-[#1B3A5C]/50 border-transparent hover:text-[#1B3A5C]/80'}`}>
                {f.label}
                <span className={`text-[11px] font-bold rounded-full px-1.5 ${folder === f.key ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {/* toolbar */}
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek leverancier, factuur, PO…"
              className="text-[13px] px-3 py-1.5 border border-gray-200 rounded-lg min-w-[220px]" />
            <select value={fClerk} onChange={(e) => setFClerk(e.target.value)} className="text-[13px] px-2 py-1.5 border border-gray-200 rounded-lg">
              <option value="">Alle</option>
              {LADIES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              <option value="__none__">Niet toegewezen</option>
              <option value="__other__">Overig</option>
            </select>
            <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="text-[13px] px-2 py-1.5 border border-gray-200 rounded-lg">
              <option value="">Alle categorieën</option>
              {CAT_OPTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select value={fEnt} onChange={(e) => setFEnt(e.target.value)} className="text-[13px] px-2 py-1.5 border border-gray-200 rounded-lg">
              <option value="">Alle entiteiten</option>
              {entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <span className="ml-auto text-[12px] text-[#1B3A5C]/50">{folderRows.length} getoond</span>
          </div>

          {/* tabel */}
          <div className="border border-gray-200 rounded-xl overflow-auto max-h-[70vh] bg-white">
            <div className="sticky top-0 left-0 z-40 h-9 flex items-center gap-2 px-3 bg-[#1B3A5C] text-white text-[12px] whitespace-nowrap">
              <span className="font-bold tracking-wide">WIE KRIJGT WAT</span>
              <span className="opacity-90 font-normal">Daya: Ivo en John&nbsp;&nbsp;·&nbsp;&nbsp;Mel: Kosten, Daniel, RCC en MMC&nbsp;&nbsp;·&nbsp;&nbsp;Etty: Gijs, Henk en Bonaire</span>
            </div>
            <table className="w-full border-separate border-spacing-0 min-w-[1330px] text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#1B3A5C]/50">
                  <th onClick={() => sortBy('received_at')} title="Sorteren op datum" className="cursor-pointer select-none sticky top-9 left-0 z-30 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 w-[62px] hover:text-[#1B3A5C]">Datum<span className="text-[#1B3A5C]/30">{arrow('received_at')}</span></th>
                  <th onClick={() => sortBy('vendor_guess')} title="Sorteren op leverancier" className="cursor-pointer select-none sticky top-9 left-[62px] z-30 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 w-[250px] shadow-[6px_0_6px_-6px_rgba(0,0,0,0.12)] hover:text-[#1B3A5C]">Leverancier<span className="text-[#1B3A5C]/30">{arrow('vendor_guess')}</span></th>
                  <th onClick={() => sortBy('ref')} title="Sorteren op factuur/PO" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Factuur / PO<span className="text-[#1B3A5C]/30">{arrow('ref')}</span></th>
                  <th onClick={() => sortBy('amount')} title="Sorteren op bedrag" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-right font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Bedrag<span className="text-[#1B3A5C]/30">{arrow('amount')}</span></th>
                  <th onClick={() => sortBy('doc_type')} title="Sorteren op categorie" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Categorie<span className="text-[#1B3A5C]/30">{arrow('doc_type')}</span></th>
                  <th onClick={() => sortBy('ledger_match')} title="Sorteren op ledger-status" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Ledger-status<span className="text-[#1B3A5C]/30">{arrow('ledger_match')}</span></th>
                  <th onClick={() => sortBy('assigned')} title="Sorteren op toegewezen persoon — zo krijg je bv. het hele lijstje van Ethy bij elkaar" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Toegewezen<span className="text-[#1B3A5C]/30">{arrow('assigned')}</span></th>
                  <th onClick={() => sortBy('due_date')} title="Sorteren op deadline — te laat bovenaan" className="cursor-pointer select-none sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 hover:text-[#1B3A5C]">Deadline<span className="text-[#1B3A5C]/30">{arrow('due_date')}</span></th>
                  <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Actie / bestemming</th>
                </tr>
              </thead>
              <tbody>
                {folderRows.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-[#1B3A5C]/40 py-10">Niets in deze map met de huidige filters.</td></tr>
                )}
                {folderRows.map((r) => {
                  const [plabel, pcls] = ledgerPill(r.ledger_match);
                  const flag = r.ledger_match === 'geboekt_open' && ['nieuw', 'toegewezen'].includes(r.status);
                  return (
                    <tr key={r.id} className={`group hover:bg-[#f8fafd] ${isOverdue(r) ? 'bg-red-50/40' : ''}`}>
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-[#f8fafd] px-3 py-2 border-b border-gray-100 tabular-nums align-top">{fmtDate(r.received_at)}</td>
                      <td className="sticky left-[62px] z-10 bg-white group-hover:bg-[#f8fafd] px-3 py-2 border-b border-gray-100 align-top shadow-[6px_0_6px_-6px_rgba(0,0,0,0.12)]">
                        <div className="font-semibold text-[#1B3A5C] flex items-center gap-1.5 flex-wrap">
                          {r.vendor_guess || '—'}
                          {r.entity && <span className="text-[10px] font-bold text-[#1B3A5C]/50 bg-gray-100 rounded px-1">{r.entity}</span>}
                          {r.part_count > 1 && <span className="text-[10px] font-bold text-white bg-[#7a45c4] rounded px-1">deel {r.part_no}/{r.part_count}</span>}
                        </div>
                        <div className="text-[11.5px] text-[#1B3A5C]/45 truncate max-w-[236px]" title={r.subject}>{r.subject}</div>
                        {r.web_link && (
                          <a href={r.web_link} target="_blank" rel="noreferrer" className="text-[11px] text-[#2f6fed] hover:underline">↗ Openen (met bijlage)</a>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        {r.invoice_number && <div className="tabular-nums">{r.invoice_number}</div>}
                        {r.po_number && <div className="text-[11.5px] text-[#1B3A5C]/45">PO {r.po_number}</div>}
                        {!r.invoice_number && !r.po_number && <span className="text-[#1B3A5C]/30">—</span>}
                        <button onClick={() => splitRow(r)} disabled={busy} className="mt-1 block text-[11px] text-[#7a45c4] hover:underline">⑂ Splitsen</button>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 text-right tabular-nums font-semibold align-top whitespace-nowrap">
                        {r.amount != null ? fmtMoney(r.amount, r.currency)
                          : (r.doc_type === 'factuur' ? <span className="text-amber-600 italic text-[12px]">uit bijlage</span> : <span className="text-[#1B3A5C]/30">—</span>)}
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        <select value={r.doc_type} onChange={(e) => setCategory(r, e.target.value)} disabled={busy}
                          className="text-[12.5px] px-2 py-1 border border-gray-200 rounded-lg bg-white">
                          {CAT_OPTS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        <span className={`inline-block text-[11.5px] font-semibold px-2 py-0.5 rounded-full border ${pcls}`}>{plabel}</span>
                        {flag && <div className="text-[10.5px] text-amber-600 mt-1">⚠ al geboekt — niet dubbel boeken</div>}
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        {r.status === 'reeds_betaald' ? <span className="text-[12px] text-[#1B3A5C]/40">n.v.t.</span> : assignSelect(r, false)}
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        {r.status === 'reeds_betaald' ? <span className="text-[12px] text-[#1B3A5C]/40">n.v.t.</span> : (
                          <>
                            {dueInput(r)}
                            {isOverdue(r) && <div className="text-[10.5px] text-red-600 font-semibold mt-1">te laat</div>}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 border-b border-gray-100 align-top">
                        {destSelect(r)}
                        {r.doc_type === 'statement' && (
                          <button
                            onClick={() => { const ext = r.sender_email && !/building-depot\.net$/i.test(r.sender_email) ? r.sender_email : ''; setMail({ row: r, to: ext, kind: 'statement' }); }}
                            disabled={busy}
                            title="Vraag de onderliggende originele facturen op bij de leverancier"
                            className="mt-1.5 block text-[11px] font-medium text-[#2f6fed] hover:underline">📄 Originele facturen opvragen</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* herzendingsmodal */}
      {mail && (
        <div className="fixed inset-0 bg-[#16233b]/45 flex items-center justify-center p-4 z-50" onClick={() => setMail(null)}>
          <div className="bg-white rounded-2xl max-w-[640px] w-full shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 font-semibold text-[#1B3A5C]">
              {mail.kind === 'statement' ? `📄 Originele facturen opvragen bij ${mail.row.vendor_guess}` : `✉️ Factuur opvragen bij ${mail.row.vendor_guess}`}
            </div>
            <div className="px-5 py-4 max-h-[62vh] overflow-auto space-y-3">
              <label className="block text-[12px] font-semibold text-[#1B3A5C]/70">Aan (e-mail leverancier)</label>
              <input value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="leverancier@voorbeeld.com"
                className="w-full text-[13px] px-3 py-2 border border-gray-200 rounded-lg" />
              <div className="rounded-lg border border-gray-200 bg-[#fbfcfe] p-3 text-[12.5px] whitespace-pre-wrap">
                <div className="text-[10.5px] uppercase tracking-wide text-[#1B3A5C]/50 font-bold mb-1">Nederlands</div>
                {mail.kind === 'statement'
                  ? `Beste ${mail.row.vendor_guess},\n\nWij ontvingen een rekeningoverzicht (statement), maar om de betaling te kunnen verwerken hebben wij de onderliggende originele facturen nodig. Zou u die (bij voorkeur als PDF) willen sturen naar ap.invoices@building-depot.net? Dan verwerken wij ze direct.\n\nAlvast bedankt.\n\nMet vriendelijke groet,\nBuilding Depot — Crediteurenadministratie`
                  : `Beste ${mail.row.vendor_guess},\n\nIn onze administratie ontbreekt de onderliggende factuur${mail.row.invoice_number ? ` met referentie ${mail.row.invoice_number}` : ''}. Zou u de factuur (bij voorkeur als PDF) willen (her)sturen naar ap.invoices@building-depot.net? Dan verwerken wij hem direct.\n\nAlvast bedankt.\n\nMet vriendelijke groet,\nBuilding Depot — Crediteurenadministratie`}
              </div>
              <div className="rounded-lg border border-gray-200 bg-[#fbfcfe] p-3 text-[12.5px] whitespace-pre-wrap">
                <div className="text-[10.5px] uppercase tracking-wide text-[#1B3A5C]/50 font-bold mb-1">English</div>
                {mail.kind === 'statement'
                  ? `Dear ${mail.row.vendor_guess},\n\nWe received a statement of account, but in order to process payment we need the underlying original invoices. Could you please send them (preferably as PDF) to ap.invoices@building-depot.net so we can process them right away?\n\nThank you in advance.\n\nKind regards,\nBuilding Depot — Accounts Payable`
                  : `Dear ${mail.row.vendor_guess},\n\nWe are missing the underlying invoice${mail.row.invoice_number ? ` (ref ${mail.row.invoice_number})` : ''}. Could you please (re)send it (preferably as PDF) to ap.invoices@building-depot.net so we can process it right away?\n\nThank you in advance.\n\nKind regards,\nBuilding Depot — Accounts Payable`}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex gap-2 justify-end">
              <button onClick={() => setMail(null)} className="text-[13px] font-semibold px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Annuleren</button>
              <button onClick={sendResend} disabled={busy || !mail.to}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#2f6fed] text-white hover:bg-[#2258c9] disabled:opacity-50">Versturen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}