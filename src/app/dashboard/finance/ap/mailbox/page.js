/* ============================================================
   BESTAND: ap_mailbox_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/mailbox/page.js  (NIEUW)

   PRODUCTIE — werkt op ap_mailbox / ap_mailbox_routing / ap_audit_log.

   Werklijst van de AP-mailbox (Model B: portal is bron van waarheid):
   - Elke mail = 1 rij, geclassificeerd + gekruist met invoice_ledger.
   - Categorie + toewijzing bewerkbaar; bestemming kiezen; reeds-betaald
     automatisch afgevangen. Overzichtstabel bovenaan (voorraad+ouderdom),
     freeze panes op Datum+Leverancier, Excel-export van alle acties.
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
const FOLDERS = [
  { key: 'inbox',            label: 'Inbox (werklijst)', test: (r) => ['nieuw', 'toegewezen', 'in_behandeling'].includes(r.status) },
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

function fmtMoney(v, cur) {
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  return (cur || 'XCG') + ' ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' }) : '—'; }
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

export default function MailboxPage() {
  const supabase = createClient();
  const ctx = useApRole();
  const { effectiveProfileId, effectiveName, effectiveRole } = ctx;

  const [rows, setRows] = useState([]);
  const [clerks, setClerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [fClerk, setFClerk] = useState('');
  const [fCat, setFCat] = useState('');
  const [fEnt, setFEnt] = useState('');
  const [mail, setMail] = useState(null);

  const clerkColor = useCallback((id) => {
    const i = clerks.findIndex((c) => c.id === id);
    return CLERK_COLORS[i >= 0 ? i % CLERK_COLORS.length : 0];
  }, [clerks]);
  const clerkName = useCallback((id) => clerks.find((c) => c.id === id)?.full_name || '', [clerks]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [{ data: mb, error: e1 }, { data: cl }] = await Promise.all([
      supabase.from('ap_mailbox').select('*').order('received_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name, role').in('role', ['ap_clerk', 'admin']).eq('is_active', true).order('full_name'),
    ]);
    if (e1) setErr(e1.message);
    setRows((mb || []).map((r) => ({ ...r, _age: daysOpen(r.received_at) })));
    setClerks(cl || []);
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

  async function assign(row, clerkId) {
    const fields = { assigned_clerk: clerkId || null, assigned_at: clerkId ? new Date().toISOString() : null, assigned_by: effectiveProfileId };
    if (clerkId && row.status === 'nieuw') fields.status = 'toegewezen';
    await patch(row.id, fields, 'toegewezen', { clerk: clerkName(clerkId) });
    if (clerkId && row.vendor_guess) {
      const always = window.confirm(`Mails van "${row.vendor_guess}" voortaan automatisch aan ${clerkName(clerkId)} toewijzen? (ook de openstaande van nu)`);
      if (always) await applyRouting(row.vendor_guess, clerkId);
    }
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

  async function setDest(row, key) {
    if (!key) return;
    if (key === 'factuur_gevraagd') {
      const ext = row.sender_email && !/building-depot\.net$/i.test(row.sender_email) ? row.sender_email : '';
      setMail({ row, to: ext });
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
          po_number: row.po_number, currency: row.currency, ledger_match: 'onbekend',
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
        body: JSON.stringify({ to: mail.to, vendor: mail.row.vendor_guess, invoice_number: mail.row.invoice_number }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Versturen mislukt');
      await patch(mail.row.id, {
        status: 'factuur_gevraagd', outlook_folder: 'Factuur gevraagd',
        resolved_by: effectiveProfileId, resolved_at: new Date().toISOString(), resolution: 'factuur_gevraagd',
      }, 'factuur_gevraagd', { to: mail.to });
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

  const folderRows = useMemo(() => {
    const f = FOLDERS.find((x) => x.key === folder);
    return rows.filter(f.test).filter(passFilter);
  }, [rows, folder, passFilter]);

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

  // Verdeling van de open werklijst over de drie dames + niet toegewezen + overig
  const verdeling = useMemo(() => {
    const open = rows.filter(FOLDERS[0].test);
    const c = { none: 0, other: 0 };
    LADY_IDS.forEach((id) => { c[id] = 0; });
    open.forEach((r) => {
      if (!r.assigned_clerk) c.none++;
      else if (LADY_IDS.includes(r.assigned_clerk)) c[r.assigned_clerk]++;
      else c.other++;
    });
    return c;
  }, [rows]);
  const scopeLabel = (v) => (v === '__none__' ? 'niet toegewezen' : v === '__other__' ? 'overig' : (LADIES.find((l) => l.id === v)?.label || 'alle clerks'));

  async function doExport() {
    const rowsOut = rows.filter(passFilter).map((r) => ({
      Datum: fmtDate(r.received_at), Leverancier: r.vendor_guess || '',
      'Factuur/PO': r.invoice_number || r.po_number || '', Deel: r.part_count ? `${r.part_no}/${r.part_count}` : '',
      Bedrag: r.amount != null ? fmtMoney(r.amount, r.currency) : '', Categorie: r.doc_type,
      'Ledger-status': r.ledger_match, Toegewezen: clerkName(r.assigned_clerk),
      Bestemming: r.outlook_folder || '', Status: r.status,
      'Opgelost door': clerkName(r.resolved_by), 'Opgelost op': r.resolved_at ? new Date(r.resolved_at).toLocaleString('nl-NL') : '',
      Onderwerp: r.subject || '',
    }));
    await exportToExcel({ filename: 'AP_Mailbox_acties', reportTitle: 'AP Mailbox — genomen acties', sheets: [{ name: 'Mailbox', rows: rowsOut }] });
  }

  if (loading) return <div className="text-[14px] text-[#1B3A5C]/40 py-10">Mailbox laden…</div>;

  return (
    <div className="max-w-[1500px]">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-[20px] font-extrabold text-[#1B3A5C]">Mailbox</h1>
        <span className="text-[12px] text-[#1B3A5C]/50">{rows.length} berichten · {counts.inbox} in werklijst</span>
        <button onClick={doExport} disabled={busy}
          className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#1B3A5C] text-white hover:bg-[#152e49] disabled:opacity-50">
          ⬇ Exporteer acties (Excel)
        </button>
      </div>
      {err && <div className="mb-3 text-[12px] bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{err}</div>}

      {/* overzicht + verdeling */}
      <div className="mb-4 grid grid-cols-1 lg:grid-cols-[1fr_330px] gap-4">
        {/* overzichtstabel */}
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
              {['Gisteren', '-1 week', '-1 maand'].map((lab) => (
                <tr key={lab} className="text-[#1B3A5C]/45 border-t border-gray-100">
                  <td className="text-left px-3 py-1.5">{lab}</td>
                  {[0, 1, 2, 3, 4].map((i) => <td key={i} className="text-right px-3 py-1.5">—</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-[#1B3A5C]/40 mt-1 italic">Historie vult zich vanaf de eerste maandag-meting.</div>
        </div>

        {/* verdeling + legenda */}
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[12px] font-semibold text-[#1B3A5C]/60 mb-2">👥 Verdeling werklijst — klik om te filteren</div>
          <div className="space-y-1 mb-3">
            {[...LADIES.map((l) => ({ key: l.id, label: l.label })), { key: '__none__', label: 'Niet toegewezen' }, { key: '__other__', label: 'Overig' }].map((b) => {
              const cnt = b.key === '__none__' ? verdeling.none : b.key === '__other__' ? verdeling.other : (verdeling[b.key] || 0);
              const active = fClerk === b.key;
              return (
                <button key={b.key} onClick={() => setFClerk(active ? '' : b.key)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12.5px] border transition-colors ${active ? 'border-[#2f6fed] bg-blue-50' : 'border-transparent hover:bg-gray-50'}`}>
                  <span className="font-medium text-[#1B3A5C]">{b.label}</span>
                  <span className="font-bold tabular-nums text-[#1B3A5C]">{cnt}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-[#1B3A5C]/40 italic">De verdeelregels staan vastgepind bovenaan de tabel.</div>
        </div>
      </div>

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
        <table className="w-full border-separate border-spacing-0 min-w-[1220px] text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[#1B3A5C]/50">
              <th className="sticky top-9 left-0 z-30 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 w-[62px]">Datum</th>
              <th className="sticky top-9 left-[62px] z-30 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200 w-[250px] shadow-[6px_0_6px_-6px_rgba(0,0,0,0.12)]">Leverancier</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Factuur / PO</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-right font-semibold px-3 py-2 border-b border-gray-200">Bedrag</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Categorie</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Ledger-status</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Toegewezen</th>
              <th className="sticky top-9 z-20 bg-[#f7f9fc] text-left font-semibold px-3 py-2 border-b border-gray-200">Actie / bestemming</th>
            </tr>
          </thead>
          <tbody>
            {folderRows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-[#1B3A5C]/40 py-10">Niets in deze map met de huidige filters.</td></tr>
            )}
            {folderRows.map((r) => {
              const [plabel, pcls] = ledgerPill(r.ledger_match);
              const curDest = ['geboekt', 'reeds_geboekt', 'factuur_gevraagd', 'reeds_betaald', 'info_bericht'].includes(r.status) ? r.status : '';
              const flag = r.ledger_match === 'geboekt_open' && ['nieuw', 'toegewezen'].includes(r.status);
              return (
                <tr key={r.id} className="group hover:bg-[#f8fafd]">
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
                    {r.status === 'reeds_betaald' ? <span className="text-[12px] text-[#1B3A5C]/40">n.v.t.</span> : (
                      <div className="flex items-center gap-1.5">
                        {r.assigned_clerk && (
                          <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[10px] font-bold" style={{ background: clerkColor(r.assigned_clerk) }}>
                            {initials(clerkName(r.assigned_clerk))}
                          </span>
                        )}
                        <select value={r.assigned_clerk || ''} onChange={(e) => assign(r, e.target.value)} disabled={busy}
                          className={`text-[12.5px] px-2 py-1 border rounded-lg bg-white ${r.assigned_clerk ? 'border-gray-200 text-[#1B3A5C]' : 'border-dashed border-gray-300 text-[#1B3A5C]/50'}`}>
                          <option value="">Toewijzen…</option>
                          {clerks.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b border-gray-100 align-top">
                    <select value={curDest} onChange={(e) => setDest(r, e.target.value)} disabled={busy}
                      className="text-[12.5px] px-2 py-1 border border-gray-200 rounded-lg bg-white">
                      <option value="">{curDest ? '— verplaatsen —' : 'Actie kiezen…'}</option>
                      {DEST.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* herzendingsmodal */}
      {mail && (
        <div className="fixed inset-0 bg-[#16233b]/45 flex items-center justify-center p-4 z-50" onClick={() => setMail(null)}>
          <div className="bg-white rounded-2xl max-w-[640px] w-full shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 font-semibold text-[#1B3A5C]">✉️ Factuur opvragen bij {mail.row.vendor_guess}</div>
            <div className="px-5 py-4 max-h-[62vh] overflow-auto space-y-3">
              <label className="block text-[12px] font-semibold text-[#1B3A5C]/70">Aan (e-mail leverancier)</label>
              <input value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="leverancier@voorbeeld.com"
                className="w-full text-[13px] px-3 py-2 border border-gray-200 rounded-lg" />
              <div className="rounded-lg border border-gray-200 bg-[#fbfcfe] p-3 text-[12.5px] whitespace-pre-wrap">
                <div className="text-[10.5px] uppercase tracking-wide text-[#1B3A5C]/50 font-bold mb-1">Nederlands</div>
                {`Beste ${mail.row.vendor_guess},\n\nIn onze administratie ontbreekt de onderliggende factuur${mail.row.invoice_number ? ` met referentie ${mail.row.invoice_number}` : ''}. Zou u de factuur (bij voorkeur als PDF) willen (her)sturen naar ap.invoices@building-depot.net? Dan verwerken wij hem direct.\n\nAlvast bedankt.\n\nMet vriendelijke groet,\nBuilding Depot — Crediteurenadministratie`}
              </div>
              <div className="rounded-lg border border-gray-200 bg-[#fbfcfe] p-3 text-[12.5px] whitespace-pre-wrap">
                <div className="text-[10.5px] uppercase tracking-wide text-[#1B3A5C]/50 font-bold mb-1">English</div>
                {`Dear ${mail.row.vendor_guess},\n\nWe are missing the underlying invoice${mail.row.invoice_number ? ` (ref ${mail.row.invoice_number})` : ''}. Could you please (re)send it (preferably as PDF) to ap.invoices@building-depot.net so we can process it right away?\n\nThank you in advance.\n\nKind regards,\nBuilding Depot — Accounts Payable`}
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
