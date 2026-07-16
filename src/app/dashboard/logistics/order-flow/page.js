/* ============================================================
   BESTAND: page.js  (Order Flow portal — v3)
   KOPIEER NAAR: src/app/dashboard/logistics/order-flow/page.js
   (overschrijft v2)

   NIEUW t.o.v. v2:
   - 9-stappenreis (PO -> pro forma -> onderweg -> laatste betaling
     -> douane -> transport -> DC -> chassis -> winkel) met datums.
   - Demurrage stap 5->8 (5 dagen vrij, $100/dag) met kleur
     groen ($0) / oranje (<=$300) / rood ($301+).
   - KPI-tegels: PO->onderweg, demurrage, douane->DC, DC->winkel.
   - Producten per PO (uit order_flow_items): SKU, omschrijving, aantal, waarde.
   - Container + rederij + knop 'ETA ophalen via VesselFinder'.
   - Betaalvorm (op rekening / aanbetaling+eind / vooraf).
   - PO-validatie bij handmatig toevoegen (5 tekens: 1/2/B/M/R + 4 cijfers).
   - Bonaire/Multimart krijgen een * ('flow nog niet ingericht').
   ============================================================ */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import dynamic from 'next/dynamic';

const VesselMap = dynamic(() => import('@/components/VesselMap'), { ssr: false, loading: () => <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>Kaart laden…</div> });

const fmtUSD = (n) => (n == null ? '—' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
const fmtXCG = (n, dec = 0) => (n == null ? '—' : 'XCG ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n)));
const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${+m[3]}-${+m[2]}-${m[1]}` : new Date(d).toLocaleDateString('nl-NL');
};
const toInput = (d) => (d ? String(d).slice(0, 10) : '');
const STATUSES = ['open', 'in_transit', 'customs', 'received', 'closed'];
const PAY_TERMS = [['deposit_final', 'Aanbetaling + eindfactuur'], ['prepaid', 'Alles vooraf'], ['on_account', 'Op rekening / achteraf']];
const SEALINES = [
  ['AUTO', 'Automatisch (detecteer)'], ['MAEU', 'Maersk'], ['MSCU', 'MSC'], ['CMDU', 'CMA CGM'],
  ['HLCU', 'Hapag-Lloyd'], ['COSU', 'COSCO'], ['EGLV', 'Evergreen'], ['ONEY', 'ONE'],
  ['SUDU', 'Hamburg Süd'], ['YMLU', 'Yang Ming'], ['HDMU', 'HMM'], ['ZIMU', 'ZIM'], ['SMLU', 'Seaboard Marine'],
];
const isBonaireMultimart = (r) => ['B', 'M'].includes(String(r.order_store || '')) || /^[BM]/.test(r.po_number || '');
const demColor = (usd) => (usd == null ? '' : usd <= 0 ? 'g' : usd <= 300 ? 'o' : 'r');
const mapPos = (r) => {
  if (r.vessel_lat != null && r.vessel_lng != null) return { lat: +r.vessel_lat, lng: +r.vessel_lng, live: true, place: r.vessel_name };
  if (r.pod_lat != null && r.pod_lng != null) return { lat: +r.pod_lat, lng: +r.pod_lng, live: false, place: r.pod_name };
  if (r.pol_lat != null && r.pol_lng != null) return { lat: +r.pol_lat, lng: +r.pol_lng, live: false, place: r.pol_name };
  return null;
};
const tokens = (str) => String(str || '').split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

function Journey({ steps, demUsd, demDays }) {
  return (
    <div className="jrow">
      {steps.map((s, i) => (
        <div key={s.key} className={`jstep ${s.zone ? 'zone' : ''}`}>
          {i > 0 && <div className={`jconn ${steps[i].zone && steps[i - 1].zone ? 'zc' : ''}`} />}
          <div className="jcirc" title={s.label}>{s.icon}</div>
          <div className="jlabel">{s.label}</div>
          <div className={`jdate ${s.date ? '' : 'muted'}`}>{s.date ? fmtDate(s.date) : '—'}</div>
          {s.sub && <div className="jsub">{s.sub}</div>}
          {s.key === 'chassis' && (
            <div className={`jbadge ${demColor(demUsd)}`}>
              {demUsd != null ? `${demDays || 0} d · ${fmtUSD(demUsd)}` : 'max 5 dgn vrij'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function OrderFlowPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [email, setEmail] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState({});
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [rem, setRem] = useState({ assignee_email: '', message: '', due_at: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState({ q: '', store: '', etaFrom: daysAgoISO(30), etaTo: '' });
  const [sort, setSort] = useState({ key: 'eta', dir: 'asc' });
  const [showMap, setShowMap] = useState(false);
  const [mapFocus, setMapFocus] = useState(null);
  const [containers, setContainers] = useState([]);
  const [allContainers, setAllContainers] = useState([]);
  const [newCont, setNewCont] = useState('');
  const [trackingId, setTrackingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const panelRef = useRef(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase.from('order_flow_v').select('*').order('eta', { ascending: true, nullsFirst: false });
    if (error) setErr(error.message); else setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email || null);
      const { data: adm } = await supabase.rpc('is_admin');
      setIsAdmin(adm === true);
      await loadRows();
      await loadAllContainers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automatisch de container-/scheepsposities elke 60s verversen uit de database
  useEffect(() => {
    const id = setInterval(() => { loadAllContainers(); if (sel) loadContainers(sel.id); }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  async function refreshRow(id) {
    const { data } = await supabase.from('order_flow_v').select('*').eq('id', id).single();
    if (data) { setRows((r) => r.map((x) => (x.id === id ? data : x))); setSel((s) => (s && s.id === id ? data : s)); }
  }

  async function selectRow(row) {
    setSel(row); setSaved(false);
    setEdit({
      po_approved_date: toInput(row.po_approved_date),
      in_transit_date: toInput(row.in_transit_date),
      customs_date: toInput(row.customs_date),
      import_duties_paid_date: toInput(row.import_duties_paid_date),
      transport_to_dc_date: toInput(row.transport_to_dc_date),
      dc_received_date: toInput(row.dc_received_date),
      chassis_return_date: toInput(row.chassis_return_date),
      store1_date: toInput(row.store1_date),
      payment_terms: row.payment_terms || 'deposit_final',
      deposit_paid_at: toInput(row.deposit_paid_at),
      final_paid_at: toInput(row.final_paid_at),
      dc_store: row.dc_store ?? '',
      final_store: row.final_store || '',
      status: row.status || 'open',
      total_cost: row.total_cost ?? '',
    });
    const [{ data: it }, { data: cm }, { data: rm }] = await Promise.all([
      supabase.from('order_flow_items').select('*').eq('po_number', row.po_number).order('order_value', { ascending: false }),
      supabase.from('order_flow_comments').select('*').eq('po_id', row.id).order('created_at', { ascending: false }),
      supabase.from('order_flow_reminders').select('*').eq('po_id', row.id).order('due_at', { ascending: true }),
    ]);
    setItems(it || []); setComments(cm || []); setReminders(rm || []);
    loadContainers(row.id);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function saveEdits() {
    if (!sel) return;
    setSaving(true);
    const D = (v) => (v || null);
    const patch = {
      po_approved_date: D(edit.po_approved_date), in_transit_date: D(edit.in_transit_date),
      customs_date: D(edit.customs_date), import_duties_paid_date: D(edit.import_duties_paid_date),
      transport_to_dc_date: D(edit.transport_to_dc_date), dc_received_date: D(edit.dc_received_date),
      chassis_return_date: D(edit.chassis_return_date), store1_date: D(edit.store1_date),
      payment_terms: edit.payment_terms || 'deposit_final',
      deposit_paid_at: D(edit.deposit_paid_at), final_paid_at: D(edit.final_paid_at),
      dc_store: edit.dc_store === '' ? null : Number(edit.dc_store),
      final_store: edit.final_store || null,
      status: edit.status || 'open',
      total_cost: edit.total_cost === '' ? null : Number(edit.total_cost),
    };
    const { error } = await supabase.from('order_flow').update(patch).eq('id', sel.id);
    setSaving(false);
    if (error) { flash('Opslaan mislukt: ' + error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    await refreshRow(sel.id);
  }

  async function loadContainers(poId) {
    const { data } = await supabase.from('order_flow_containers').select('*').eq('po_id', poId).order('created_at', { ascending: true });
    setContainers(data || []);
  }
  async function loadAllContainers() {
    const { data } = await supabase.from('order_flow_containers')
      .select('id, po_id, container_no, eta, carrier, vessel_name, vessel_imo, vessel_lat, vessel_lng, pol_name, pol_lat, pol_lng, pod_name, pod_lat, pod_lng, order_flow ( po_number, vendor_name )')
      .or('vessel_lat.not.is.null,pod_lat.not.is.null,pol_lat.not.is.null');
    setAllContainers(data || []);
  }
  async function addContainers(str) {
    if (!sel) return;
    const list = [...new Set(tokens(str))];
    if (!list.length) return;
    const rows = list.map((cn) => ({ po_id: sel.id, container_no: cn, sealine: 'AUTO' }));
    const { error } = await supabase.from('order_flow_containers').upsert(rows, { onConflict: 'po_id,container_no', ignoreDuplicates: true });
    if (error) { flash('Toevoegen mislukt: ' + error.message); return; }
    setNewCont(''); await loadContainers(sel.id); await loadAllContainers();
    flash(list.length > 1 ? `${list.length} containers toegevoegd` : 'Container toegevoegd');
  }
  function onPasteContainers(e) {
    const t = e.clipboardData.getData('text');
    if (tokens(t).length > 1) { e.preventDefault(); addContainers(t); }
  }
  async function updateContainer(id, field, val) {
    const v = field === 'container_no' ? String(val).trim().toUpperCase() : val;
    const { error } = await supabase.from('order_flow_containers').update({ [field]: v }).eq('id', id);
    if (error) { flash('Opslaan mislukt: ' + error.message); return; }
    await loadContainers(sel.id); await loadAllContainers();
  }
  async function removeContainer(id) {
    if (!confirm('Container verwijderen?')) return;
    await supabase.from('order_flow_containers').delete().eq('id', id);
    await loadContainers(sel.id); await loadAllContainers();
  }
  async function trackContainer(id) {
    setTrackingId(id);
    try {
      const res = await fetch('/api/order-flow/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ container_id: id }) });
      const j = await res.json();
      if (!res.ok) { flash(j.error || 'Ophalen mislukt'); return; }
      if (j.status === 'processing') flash(j.message);
      else if (j.status === 'error') flash('VesselFinder: ' + j.message);
      else flash(`ETA ${fmtDate(j.eta)} · ${j.carrier || ''} · ${j.vessel || '—'} (nog ${j.containers_remaining} containers over)`);
      await loadContainers(sel.id); await loadAllContainers(); if (sel) await refreshRow(sel.id);
    } catch (e) { flash('Netwerkfout: ' + e.message); } finally { setTrackingId(null); }
  }

  async function refreshPositions() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/order-flow/track-refresh', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) { flash(j.error || 'Verversen mislukt'); }
      else { flash(`Posities bijgewerkt: ${j.updated} · nog bezig: ${j.processing}${j.containers_remaining != null ? ` · ${j.containers_remaining} containers over` : ''}`); }
      await loadAllContainers(); if (sel) await loadContainers(sel.id); if (sel) await refreshRow(sel.id);
    } catch (e) { flash('Netwerkfout: ' + e.message); } finally { setRefreshing(false); }
  }

  async function deletePo(id, po, e) {
    e?.stopPropagation();
    if (!confirm(`PO ${po} verwijderen?`)) return;
    const { error } = await supabase.from('order_flow').delete().eq('id', id);
    if (error) { flash('Verwijderen mislukt: ' + error.message); return; }
    setRows((r) => r.filter((x) => x.id !== id));
    if (sel?.id === id) setSel(null);
    flash('PO verwijderd');
  }

  async function requestPayment(kind) {
    if (!sel) return;
    if (!sel.total_cost) { flash('Vul eerst PO-totaal in en sla op'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/order-flow/proforma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ po_id: sel.id, kind }) });
      const j = await res.json();
      if (!res.ok) { flash(j.error || 'Aanvraag mislukt'); return; }
      flash(`Pro forma ${j.invoice_no} gemaild (${fmtUSD(j.amount)} → ${j.sent_to})`);
      await refreshRow(sel.id);
    } catch (e) { flash('Netwerkfout: ' + e.message); } finally { setBusy(false); }
  }

  async function addComment() {
    if (!commentText.trim() || !sel) return;
    const { error } = await supabase.from('order_flow_comments').insert({ po_id: sel.id, body: commentText.trim(), author_email: email });
    if (error) { flash('Opmerking mislukt: ' + error.message); return; }
    setCommentText(''); await selectRow(sel);
  }

  async function addReminder() {
    if (!sel || !rem.assignee_email.trim() || !rem.message.trim() || !rem.due_at) { flash('Vul e-mail, bericht en datum in'); return; }
    const { error } = await supabase.from('order_flow_reminders').insert({
      po_id: sel.id, assignee_email: rem.assignee_email.trim(), message: rem.message.trim(),
      due_at: new Date(rem.due_at).toISOString(), created_by_email: email,
    });
    if (error) { flash('Reminder mislukt: ' + error.message); return; }
    setRem({ assignee_email: '', message: '', due_at: '' }); await selectRow(sel); flash('Reminder ingepland');
  }
  async function setReminderStatus(id, status) {
    await supabase.from('order_flow_reminders').update({ status }).eq('id', id);
    if (sel) await selectRow(sel);
  }

  const storeOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.order_store).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter.store && String(r.order_store || '') !== filter.store) return false;
      if (filter.etaFrom && (!r.eta || String(r.eta).slice(0, 10) < filter.etaFrom)) return false;
      if (filter.etaTo && (!r.eta || String(r.eta).slice(0, 10) > filter.etaTo)) return false;
      if (q) {
        const hay = `${r.po_number || ''} ${r.vendor_name || ''} ${r.vendor_code || ''} ${r.dept_display || r.dept || ''} ${r.container_no || ''} ${r.order_store || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const numeric = key === 'demurrage_est_usd';
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av = a[key], bv = b[key];
      const an = av == null || av === '', bn = bv == null || bv === '';
      if (an && bn) return 0;
      if (an) return 1;   // lege waarden altijd onderaan
      if (bn) return -1;
      const r = numeric ? (Number(av) - Number(bv)) : String(av).localeCompare(String(bv), 'nl');
      return dir === 'asc' ? r : -r;
    });
    return arr;
  }, [filtered, sort]);

  const Th = ({ k, cls, children }) => (
    <th className={`${cls || ''} sortable`} onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const kpi = useMemo(() => {
    const mean = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
    const a = { pt: [], dem: [], cd: [], ds: [] };
    for (const r of rows) {
      if (r.kpi_po_to_transit != null && r.kpi_po_to_transit >= 0) a.pt.push(r.kpi_po_to_transit);
      if (r.demurrage_est_usd != null) a.dem.push(Number(r.demurrage_est_usd));
      if (r.kpi_customs_to_dc != null && r.kpi_customs_to_dc >= 0) a.cd.push(r.kpi_customs_to_dc);
      if (r.kpi_dc_to_store != null && r.kpi_dc_to_store >= 0) a.ds.push(r.kpi_dc_to_store);
    }
    return { pt: mean(a.pt), dem: mean(a.dem), cd: mean(a.cd), ds: mean(a.ds), inWindow: rows.filter((r) => r.in_demurrage_window).length };
  }, [rows]);

  const selSteps = sel ? [
    { key: 'po', icon: '📋', label: 'PO goedgekeurd', date: sel.po_approved_date || sel.po_created_date },
    { key: 'proforma', icon: '💵', label: 'Pro forma betaling', date: sel.deposit_paid_at },
    { key: 'transit', icon: '🚢', label: 'Onderweg', date: sel.in_transit_date, sub: sel.eta ? `ETA ${fmtDate(sel.eta)}` : null },
    { key: 'final', icon: '💳', label: 'Laatste betaling', date: sel.final_paid_at },
    { key: 'customs', icon: '🛃', label: 'Douane', date: sel.customs_date, zone: true },
    { key: 'transport', icon: '🚚', label: 'Transport → DC', date: sel.transport_to_dc_date, zone: true },
    { key: 'dc', icon: '🏬', label: 'DC (uitruimen)', date: sel.dc_received_date, sub: sel.dc_store ? `store ${sel.dc_store}` : null, zone: true },
    { key: 'chassis', icon: '↩️', label: 'Chassis terug', date: sel.chassis_return_date, zone: true },
    { key: 'store', icon: '🏪', label: 'In winkel', date: sel.store1_date, sub: sel.final_store ? `store ${sel.final_store}` : null },
  ] : [];

  const itemsTotal = useMemo(() => items.reduce((s, i) => s + (Number(i.order_value) || 0), 0), [items]);

  const vessels = useMemo(() => allContainers.map((c) => {
    const p = mapPos(c);
    if (!p) return null;
    return {
      id: c.id, po_id: c.po_id, po_number: c.order_flow?.po_number, vendor_name: c.order_flow?.vendor_name,
      container_no: c.container_no, eta: c.eta ? fmtDate(c.eta) : '—', name: c.vessel_name, carrier: c.carrier,
      imo: c.vessel_imo, live: p.live, place: p.place, lat: p.lat, lng: p.lng,
    };
  }).filter(Boolean), [allContainers]);

  const containersByPo = useMemo(() => {
    const m = {};
    vessels.forEach((v) => { (m[v.po_id] = m[v.po_id] || []).push(v); });
    return m;
  }, [vessels]);

  function openShip(r, e) {
    e?.stopPropagation();
    const vs = containersByPo[r.id];
    setMapFocus(vs && vs[0] ? vs[0].id : null);
    setShowMap(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="of-wrap">
      <style>{css}</style>

      <div className="of-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Order Flow</h1>
          <p className="of-sub">Van bestelling tot winkel · demurrage stap douane→chassis: 5 dagen vrij, daarna $100/container/dag</p>
        </div>
        <button className="btn primary" disabled={refreshing} onClick={refreshPositions}>{refreshing ? 'Verversen…' : 'Ververs posities'}</button>
      </div>

      <div className="kpis">
        <div className="kpi"><span>{kpi.pt ?? '—'}{kpi.pt != null ? ' d' : ''}</span>PO → onderweg</div>
        <div className="kpi"><span>{kpi.cd ?? '—'}{kpi.cd != null ? ' d' : ''}</span>Douane → DC</div>
        <div className="kpi"><span>{kpi.ds ?? '—'}{kpi.ds != null ? ' d' : ''}</span>DC → winkel</div>
        <div className={`kpi ${kpi.dem ? 'warn' : ''}`}><span>{fmtUSD(kpi.dem)}</span>gem. demurrage</div>
        <div className={`kpi ${kpi.inWindow ? 'warn' : ''}`}><span>{kpi.inWindow}</span>in demurrage-venster</div>
      </div>

      <div className="of-card">
        <div className="filterbar">
          <input className="fsearch" placeholder="Zoek op PO, leverancier, afdeling of container…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select value={filter.store} onChange={(e) => setFilter({ ...filter, store: e.target.value })}>
            <option value="">Alle stores</option>
            {storeOpts.map((s) => <option key={s} value={s}>store {s}</option>)}
          </select>
          <label className="frange">ETA van<input type="date" value={filter.etaFrom} onChange={(e) => setFilter({ ...filter, etaFrom: e.target.value })} /></label>
          <label className="frange">t/m<input type="date" value={filter.etaTo} onChange={(e) => setFilter({ ...filter, etaTo: e.target.value })} /></label>
          {(filter.q || filter.store || filter.etaFrom || filter.etaTo) && <button className="link" onClick={() => setFilter({ q: '', store: '', etaFrom: '', etaTo: '' })}>wissen</button>}
        </div>
        <div className="of-sub" style={{ marginTop: 8 }}>{filtered.length} van {rows.length} PO&apos;s · standaard alleen ETA t/m 30 dagen oud (pas &quot;ETA van&quot; aan of klik wissen voor alles)</div>
      </div>

      {showMap && (
        <div className="of-card">
          <div className="of-detail-head">
            <div className="of-card-title">Schepen op de kaart <span className="of-sub">{vessels.length} met een positie (🚢 live · 📍 laatst bekende haven)</span></div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn" disabled={refreshing} onClick={refreshPositions}>{refreshing ? 'Verversen…' : 'Ververs posities'}</button>
              <button className="link" onClick={() => setShowMap(false)}>sluiten ✕</button>
            </div>
          </div>
          {vessels.length === 0 ? <div className="of-empty">Nog geen posities. Haal eerst een ETA op via VesselFinder.</div>
            : <VesselMap vessels={vessels} focusId={mapFocus} height={380} />}
        </div>
      )}

      {sel && (
        <div className="of-card hl" ref={panelRef}>
          <div className="of-detail-head">
            <div>
              <div className="of-card-title">PO {sel.po_number}{isBonaireMultimart(sel) && <span className="star"> *</span>}</div>
              <div className="of-sub">{sel.vendor_name || sel.vendor_code || '—'} · {sel.dept_display || sel.dept || 'afd. —'} · store {sel.order_store || '—'} · totaal {fmtUSD(sel.total_cost)}</div>
              {isBonaireMultimart(sel) && <div className="warnline">* Bonaire/Multimart — deze flow is tot op heden nog niet ingericht.</div>}
              {sel.final_payment_late && <div className="warnline">⚠ Laatste betaling valt minder dan 3 dagen vóór de douanedatum — risico voor de paper release.</div>}
            </div>
            <button className="link" onClick={() => setSel(null)}>sluiten ✕</button>
          </div>

          <Journey steps={selSteps} demUsd={sel.demurrage_est_usd} demDays={sel.demurrage_days} />

          <div className="of-block-title">Containers <span className="of-sub">({containers.length})</span></div>
          <div className="cont-add">
            <input placeholder="Plak containernummer(s) — meerdere mag (spatie, komma of enter)" value={newCont}
              onChange={(e) => setNewCont(e.target.value)}
              onPaste={onPasteContainers}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContainers(newCont); } }} />
            <button className="btn" onClick={() => addContainers(newCont)}>Toevoegen</button>
          </div>
          <div className="cont-list">
            {containers.length === 0 && <div className="of-sub">Nog geen containers. Plak hierboven één of meerdere nummers.</div>}
            {containers.map((c) => (
              <div key={c.id} className="cont-row">
                <input className="cno" defaultValue={c.container_no} placeholder="ABCD1234567" onBlur={(e) => updateContainer(c.id, 'container_no', e.target.value)} />
                <select value={c.sealine || 'AUTO'} onChange={(e) => updateContainer(c.id, 'sealine', e.target.value)}>{SEALINES.map(([code, n]) => <option key={code} value={code}>{n}</option>)}</select>
                <button className="btn" disabled={trackingId === c.id} onClick={() => trackContainer(c.id)}>{trackingId === c.id ? 'Ophalen…' : 'ETA ophalen'}</button>
                <button className="link del" title="Verwijderen" onClick={() => removeContainer(c.id)}>✕</button>
                <div className="cont-info">
                  {c.tracking_status === 'success'
                    ? <>{c.vessel_lat != null ? '🚢' : '📍'} {c.vessel_name || c.pod_name || '—'}{c.carrier ? ` · ${c.carrier}` : ''} · ETA {c.eta ? fmtDate(c.eta) : '—'} · {c.tracking_progress ?? '—'}%{mapPos(c) && <> · <button className="link" onClick={() => { setMapFocus(c.id); setShowMap(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>kaart</button></>}</>
                    : c.tracking_status ? <span className="of-sub">VesselFinder: {c.tracking_message || c.tracking_status}</span>
                      : <span className="of-sub">Nog niet opgehaald</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="of-block-title">Bewerken</div>
          <div className="edit-grid">
            <label>PO goedgekeurd<input type="date" value={edit.po_approved_date} onChange={(e) => setEdit({ ...edit, po_approved_date: e.target.value })} /></label>
            <label>Onderweg sinds<input type="date" value={edit.in_transit_date} onChange={(e) => setEdit({ ...edit, in_transit_date: e.target.value })} /></label>
            <label>Douanedatum<input type="date" value={edit.customs_date} onChange={(e) => setEdit({ ...edit, customs_date: e.target.value })} /></label>
            <label>Invoerrechten betaald<input type="date" value={edit.import_duties_paid_date} onChange={(e) => setEdit({ ...edit, import_duties_paid_date: e.target.value })} /></label>
            <label>Transport → DC<input type="date" value={edit.transport_to_dc_date} onChange={(e) => setEdit({ ...edit, transport_to_dc_date: e.target.value })} /></label>
            <label>DC ontvangst (finalize)<input type="date" value={edit.dc_received_date} onChange={(e) => setEdit({ ...edit, dc_received_date: e.target.value })} /></label>
            <label>Chassis terug<input type="date" value={edit.chassis_return_date} onChange={(e) => setEdit({ ...edit, chassis_return_date: e.target.value })} /></label>
            <label>In winkel<input type="date" value={edit.store1_date} onChange={(e) => setEdit({ ...edit, store1_date: e.target.value })} /></label>

            <label>Betaalvorm<select value={edit.payment_terms} onChange={(e) => setEdit({ ...edit, payment_terms: e.target.value })}>{PAY_TERMS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <label>Aanbetaling betaald<input type="date" value={edit.deposit_paid_at} onChange={(e) => setEdit({ ...edit, deposit_paid_at: e.target.value })} /></label>
            <label>Laatste betaling betaald<input type="date" value={edit.final_paid_at} onChange={(e) => setEdit({ ...edit, final_paid_at: e.target.value })} /></label>

            <label>DC store<select value={edit.dc_store} onChange={(e) => setEdit({ ...edit, dc_store: e.target.value })}><option value="">—</option><option value="1">1</option><option value="2">2</option><option value="5">5</option></select></label>
            <label>Winkel<select value={edit.final_store} onChange={(e) => setEdit({ ...edit, final_store: e.target.value })}><option value="">—</option><option value="1">1</option><option value="M">M (Multimart)</option></select></label>
            <label>Status<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>PO-totaal (USD)<input type="number" value={edit.total_cost} onChange={(e) => setEdit({ ...edit, total_cost: e.target.value })} /></label>

            <div className="save-cell"><button className="btn primary" disabled={saving} onClick={saveEdits}>{saving ? 'Opslaan…' : 'Opslaan'}</button>{saved && <span className="saved">Opgeslagen ✓</span>}</div>
          </div>

          <div className="of-block-title">Producten in deze PO <span className="of-sub">({items.length} SKU&apos;s · {fmtXCG(itemsTotal)})</span></div>
          <div className="of-tablewrap">
            {items.length === 0 ? <div className="of-sub">Geen gekoppelde artikelen gevonden voor dit PO-nummer.</div> : (
              <table className="of-table sm">
                <thead><tr><th>SKU</th><th>Omschrijving</th><th>Afdeling</th><th className="num">Aantal</th><th className="num">Kostprijs</th><th className="num">Waarde</th></tr></thead>
                <tbody>
                  {items.slice(0, 200).map((i) => (
                    <tr key={i.id}><td>{i.item_number}</td><td>{i.item_description}</td><td>{i.dept_name || i.dept_code || '—'}</td><td className="num">{i.qoo ?? '—'}</td><td className="num">{i.avg_cost != null ? fmtXCG(i.avg_cost, 2) : '—'}</td><td className="num">{i.order_value != null ? fmtXCG(i.order_value) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {items.length > 200 && <div className="of-sub">…en nog {items.length - 200} regels.</div>}
          </div>

          <div className="of-cols">
            <div className="of-col">
              <div className="of-block-title">Betalingen (pro forma)</div>
              <div className="pay-row"><div><b>Aanbetaling 30%</b><div className="of-sub">{sel.deposit_requested_at ? `Aangevraagd ${fmtDate(sel.deposit_requested_at)} · ${sel.deposit_invoice_no} · ${fmtUSD(sel.deposit_amount)}` : 'Nog niet aangevraagd'}</div></div><button className="btn" disabled={busy} onClick={() => requestPayment('deposit')}>Aanvragen</button></div>
              <div className="pay-row"><div><b>Restbetaling 70%</b><div className="of-sub">{sel.final_requested_at ? `Aangevraagd ${fmtDate(sel.final_requested_at)} · ${sel.final_invoice_no} · ${fmtUSD(sel.final_amount)}` : 'Nog niet aangevraagd'}</div></div><button className="btn" disabled={busy} onClick={() => requestPayment('final')}>Aanvragen</button></div>
            </div>
            <div className="of-col">
              <div className="of-block-title">Reminders</div>
              <div className="rem-form">
                <input placeholder="E-mail ontvanger" value={rem.assignee_email} onChange={(e) => setRem({ ...rem, assignee_email: e.target.value })} />
                <input placeholder="Wat moet er gebeuren?" value={rem.message} onChange={(e) => setRem({ ...rem, message: e.target.value })} />
                <input type="date" value={rem.due_at} onChange={(e) => setRem({ ...rem, due_at: e.target.value })} />
                <button className="btn" onClick={addReminder}>Inplannen</button>
              </div>
              <ul className="rem-list">
                {reminders.length === 0 && <li className="of-sub">Nog geen reminders.</li>}
                {reminders.map((x) => (
                  <li key={x.id} className={`rem ${x.status}`}>
                    <div><b>{x.assignee_email}</b> · {fmtDate(x.due_at)} <span className={`tag ${x.status}`}>{x.status}</span><div className="of-sub">{x.message}</div></div>
                    {x.status === 'pending' && <div className="rem-actions"><button className="link" onClick={() => setReminderStatus(x.id, 'done')}>klaar</button><button className="link del" onClick={() => setReminderStatus(x.id, 'cancelled')}>annuleer</button></div>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="of-block-title">Opmerkingen</div>
          <div className="cm-form">
            <textarea placeholder="Plaats een opmerking voor het team…" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
            <button className="btn" onClick={addComment}>Plaatsen</button>
          </div>
          <ul className="cm-list">
            {comments.length === 0 && <li className="of-sub">Nog geen opmerkingen.</li>}
            {comments.map((c) => (<li key={c.id}><div className="cm-meta">{c.author_email || 'onbekend'} · {new Date(c.created_at).toLocaleString('nl-NL')}</div><div>{c.body}</div></li>))}
          </ul>
        </div>
      )}

      <div className="of-note">Nieuwe PO&apos;s komen automatisch binnen uit de dagelijkse Compass-import — handmatig toevoegen is niet nodig. Foutieve PO-nummers (geen 5 tekens beginnend met 1/2/B/M/R) worden bij de import automatisch overgeslagen.</div>

      {err && <div className="of-error">Fout: {err}</div>}

      <div className="of-card">
        <div className="of-card-title">Alle PO&apos;s <span className="of-sub">— klik een rij voor de reis</span></div>
        {loading ? <div className="of-empty">Laden…</div> : rows.length === 0 ? <div className="of-empty">Nog geen PO&apos;s.</div> : filtered.length === 0 ? <div className="of-empty">Geen PO&apos;s voldoen aan de filter.</div> : (
          <div className="of-tablewrap">
            <table className="of-table">
              <thead><tr>
                <Th k="po_number">PO</Th>
                <Th k="vendor_name">Leverancier</Th>
                <Th k="dept_display">Afd.</Th>
                <Th k="order_store">Store</Th>
                <Th k="eta">ETA</Th>
                <th>Map</th>
                <Th k="customs_date">Douane</Th>
                <Th k="chassis_return_date">Chassis</Th>
                <Th k="demurrage_est_usd" cls="num">Demurrage</Th>
                <Th k="container_count" cls="num">Cont.</Th>
                <Th k="status">Status</Th>
                <th></th>
              </tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className={`${r.in_demurrage_window ? 'danger' : ''} ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => selectRow(r)}>
                    <td className="po">{r.po_number}{isBonaireMultimart(r) && <span className="star"> *</span>}</td>
                    <td>{r.vendor_name || r.vendor_code || '—'}</td>
                    <td className="deptcell">{r.dept_display || r.dept || '—'}</td>
                    <td>{r.order_store || '—'}</td>
                    <td>{fmtDate(r.eta)}{r.eta_source === 'vesselfinder' && <span className="vf" title="ETA via VesselFinder"> ⚓</span>}</td>
                    <td className="mapcell">{(() => { const vs = containersByPo[r.id]; if (!vs || !vs.length) return ''; const live = vs.some((v) => v.live); return <button className="shipbtn" title="Toon containers op kaart" onClick={(e) => openShip(r, e)}>{live ? '🚢' : '📍'}</button>; })()}</td>
                    <td>{fmtDate(r.customs_date)}</td>
                    <td>{fmtDate(r.chassis_return_date)}</td>
                    <td className="num"><span className={`dem ${demColor(r.demurrage_est_usd)}`}>{r.demurrage_est_usd != null ? fmtUSD(r.demurrage_est_usd) : '—'}</span></td>
                    <td className="num">{r.container_count || 0}</td>
                    <td>{r.status || 'open'}</td>
                    <td>{isAdmin && <button className="link del" onClick={(e) => deletePo(r.id, r.po_number, e)}>verwijder</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className="of-toast">{toast}</div>}
    </div>
  );
}

const css = `
.of-wrap{padding:24px;max-width:1360px;margin:0 auto;color:#1a1a1a;font-family:system-ui,Arial,sans-serif}
.of-head{margin-bottom:14px}
.of-wrap h1{margin:0;font-size:24px;color:#1B3A5C}
.of-sub{color:#6b7280;font-size:13px;margin:2px 0 0;font-weight:400}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px}
.kpi{background:#eef3f9;border-radius:10px;padding:12px 14px;font-size:12px;color:#6b7280;text-align:center}
.kpi span{display:block;font-size:20px;font-weight:600;color:#1B3A5C}
.kpi.warn{background:#fef2f2;color:#991b1b}.kpi.warn span{color:#b91c1c}
.of-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}
.of-card.hl{border-color:#1B3A5C;box-shadow:0 0 0 3px rgba(27,58,92,0.06)}
.of-card-title{font-weight:600;margin-bottom:10px;color:#1B3A5C}
.star{color:#b45309;font-weight:700}
.warnline{color:#b45309;font-size:12px;margin-top:4px}
.of-detail-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.jrow{display:flex;gap:0;overflow-x:auto;padding:8px 2px 4px}
.jstep{position:relative;flex:1 0 108px;min-width:108px;text-align:center;padding-top:6px}
.jstep.zone{background:#fff8f0;border-radius:8px}
.jconn{position:absolute;top:26px;left:-50%;width:100%;height:2px;background:#cbd5e1;z-index:0}
.jconn.zc{background:#f59e0b}
.jcirc{position:relative;z-index:1;width:40px;height:40px;line-height:40px;margin:0 auto;border-radius:50%;background:#eef3f9;border:2px solid #1B3A5C;font-size:18px}
.jlabel{font-size:11px;font-weight:600;color:#1B3A5C;margin-top:6px;line-height:1.15}
.jdate{font-size:11px;color:#374151;margin-top:2px}
.jdate.muted{color:#9ca3af}
.jsub{font-size:10px;color:#6b7280}
.jbadge{margin-top:6px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;display:inline-block}
.jbadge.g{background:#dcfce7;color:#166534}.jbadge.o{background:#fef3c7;color:#92400e}.jbadge.r{background:#fee2e2;color:#b91c1c}
.track{background:#f0f6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px 12px;font-size:12px;color:#1e3a5c;margin:8px 0}
.cont-add{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px}
.cont-add input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.cont-list{display:flex;flex-direction:column;gap:8px}
.cont-row{display:grid;grid-template-columns:160px 190px auto auto;gap:8px;align-items:center;padding:8px 10px;border:1px solid #eef0f2;border-radius:8px}
.cont-row .cno{padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;text-transform:uppercase}
.cont-row select{padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
.cont-info{grid-column:1 / -1;font-size:12px;color:#374151}
@media(max-width:1000px){.cont-row{grid-template-columns:1fr 1fr}}
.of-block-title{font-weight:600;font-size:13px;margin:14px 0 8px;color:#374151}
.edit-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:end}
.edit-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6b7280}
.edit-grid input,.edit-grid select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.save-cell{display:flex;align-items:center;gap:10px}
.saved{color:#166534;font-size:13px;font-weight:500}
.filterbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.filterbar input,.filterbar select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.fsearch{flex:1 1 280px;min-width:200px}
.frange{display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280}
.frange input{padding:6px 8px}
.of-table th.sortable{cursor:pointer;user-select:none}
.of-table th.sortable:hover{color:#1B3A5C}
.of-note{background:#eef3f9;color:#334155;border-radius:10px;padding:10px 14px;font-size:12px;margin-bottom:16px}
.of-add{display:grid;grid-template-columns:1.4fr 1.4fr 1fr 1fr 1fr auto;gap:8px}
.of-add input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;width:100%}
.of-error{background:#fef2f2;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.of-empty{color:#6b7280;text-align:center;padding:24px}
.of-tablewrap{overflow-x:auto}
.of-table{width:100%;border-collapse:collapse;font-size:13px}
.of-table.sm{font-size:12px}
.of-table th{text-align:left;color:#6b7280;font-weight:500;padding:8px;border-bottom:2px solid #e5e7eb;white-space:nowrap}
.of-table td{padding:8px;border-bottom:1px solid #f1f3f5;white-space:nowrap}
.of-table td.deptcell{white-space:normal;max-width:190px;word-break:break-word;line-height:1.25}
.of-table tbody tr{cursor:pointer}
.of-table tbody tr:hover{background:#f8fafc}
.of-table tr.danger td{background:#fff5f5}
.of-table tr.selected td{background:#eef3f9}
.of-table td.po{font-weight:600;color:#1B3A5C}
.num{text-align:right;font-variant-numeric:tabular-nums}
.dem{padding:2px 6px;border-radius:5px;font-weight:600}
.dem.g{background:#dcfce7;color:#166534}.dem.o{background:#fef3c7;color:#92400e}.dem.r{background:#fee2e2;color:#b91c1c}
.vf{color:#1d4ed8}
.mapcell{text-align:center}
.shipbtn{background:none;border:none;cursor:pointer;font-size:16px;padding:0;line-height:1}
.shipbtn:hover{transform:scale(1.2)}
.link{background:none;border:none;color:#1d4ed8;cursor:pointer;font-size:13px;padding:0;text-decoration:underline}
.link.del{color:#b91c1c}
.btn{padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
.btn:hover{background:#f9fafb}.btn.primary{background:#1B3A5C;color:#fff;border-color:#1B3A5C}.btn:disabled{opacity:.5;cursor:default}
.of-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.pay-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px;border:1px solid #eef0f2;border-radius:8px;margin-bottom:8px}
.rem-form{display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;margin-bottom:10px}
.rem-form input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.cm-form{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start}
.cm-form textarea{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;min-height:60px;resize:vertical}
.rem-list,.cm-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.rem{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #eef0f2;border-radius:8px}
.rem.sent{opacity:.6}.rem.done{opacity:.5}.rem.cancelled{opacity:.4;text-decoration:line-through}
.rem-actions{display:flex;gap:8px;align-items:center}
.tag{font-size:11px;padding:1px 6px;border-radius:5px;background:#eef0f2;color:#6b7280}
.tag.sent{background:#dbeafe;color:#1e40af}.tag.done{background:#dcfce7;color:#166534}.tag.pending{background:#fef3c7;color:#92400e}.tag.cancelled{background:#f3f4f6}
.cm-list li{border:1px solid #f1f3f5;border-radius:8px;padding:8px 10px;font-size:13px}
.cm-meta{color:#9aa0a6;font-size:11px;margin-bottom:2px}
.of-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1B3A5C;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:50;max-width:92vw;text-align:center}
@media(max-width:1000px){.kpis{grid-template-columns:repeat(2,1fr)}.edit-grid{grid-template-columns:1fr 1fr}.of-cols{grid-template-columns:1fr}.of-add{grid-template-columns:1fr 1fr}.rem-form{grid-template-columns:1fr}}
`;