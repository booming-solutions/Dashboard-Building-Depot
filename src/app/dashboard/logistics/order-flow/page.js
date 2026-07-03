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

const fmtUSD = (n) => (n == null ? '—' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('nl-NL') : '—');
const toInput = (d) => (d ? String(d).slice(0, 10) : '');
const STATUSES = ['open', 'in_transit', 'customs', 'received', 'closed'];
const PO_RE = /^([12]\d{4}|[BMR]\d{4})$/;
const PAY_TERMS = [['deposit_final', 'Aanbetaling + eindfactuur'], ['prepaid', 'Alles vooraf'], ['on_account', 'Op rekening / achteraf']];
const SEALINES = [
  ['AUTO', 'Automatisch (detecteer)'], ['MAEU', 'Maersk'], ['MSCU', 'MSC'], ['CMDU', 'CMA CGM'],
  ['HLCU', 'Hapag-Lloyd'], ['COSU', 'COSCO'], ['EGLV', 'Evergreen'], ['ONEY', 'ONE'],
  ['SUDU', 'Hamburg Süd'], ['YMLU', 'Yang Ming'], ['HDMU', 'HMM'], ['ZIMU', 'ZIM'], ['SMLU', 'Seaboard Marine'],
];
const isBonaireMultimart = (r) => ['B', 'M'].includes(String(r.order_store || '')) || /^[BM]/.test(r.po_number || '');
const demColor = (usd) => (usd == null ? '' : usd <= 0 ? 'g' : usd <= 300 ? 'o' : 'r');

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
  const [tracking, setTracking] = useState(false);
  const [comments, setComments] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [rem, setRem] = useState({ assignee_email: '', message: '', due_at: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [np, setNp] = useState({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      container_no: row.container_no || '',
      sealine: row.sealine || 'AUTO',
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
      container_no: edit.container_no ? edit.container_no.trim().toUpperCase() : null,
      sealine: edit.sealine || 'AUTO',
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

  async function trackVessel() {
    if (!sel) return;
    const c = (edit.container_no || '').trim();
    if (c.length !== 11) { flash('Containernummer moet 11 tekens zijn (4 letters + 7 cijfers).'); return; }
    setTracking(true);
    try {
      await saveEdits();
      const res = await fetch('/api/order-flow/track', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ po_id: sel.id }),
      });
      const j = await res.json();
      if (!res.ok) { flash(j.error || 'Ophalen mislukt'); return; }
      if (j.status === 'processing') { flash(j.message); }
      else if (j.status === 'error') { flash('VesselFinder: ' + j.message); }
      else { flash(`ETA ${fmtDate(j.eta)} · ${j.carrier || ''} · schip ${j.vessel || '—'} (nog ${j.containers_remaining} containers over)`); }
      await refreshRow(sel.id);
    } catch (e) { flash('Netwerkfout: ' + e.message); } finally { setTracking(false); }
  }

  async function addPo() {
    const po = np.po_number.trim().toUpperCase();
    if (!PO_RE.test(po)) { flash('PO-nummer moet 5 tekens zijn: 1/2 + 4 cijfers, of B/M/R + 4 cijfers.'); return; }
    setBusy(true);
    const { error } = await supabase.from('order_flow').insert({
      po_number: po, vendor_name: np.vendor_name || null, dept: np.dept || null,
      eta: np.eta || null, total_cost: np.total_cost ? Number(np.total_cost) : null,
    });
    setBusy(false);
    if (error) { flash('Toevoegen mislukt: ' + error.message); return; }
    setNp({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });
    await loadRows(); flash('PO toegevoegd');
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

  return (
    <div className="of-wrap">
      <style>{css}</style>

      <div className="of-head">
        <h1>Order Flow</h1>
        <p className="of-sub">Van bestelling tot winkel · demurrage stap douane→chassis: 5 dagen vrij, daarna $100/container/dag</p>
      </div>

      <div className="kpis">
        <div className="kpi"><span>{kpi.pt ?? '—'}{kpi.pt != null ? ' d' : ''}</span>PO → onderweg</div>
        <div className="kpi"><span>{kpi.cd ?? '—'}{kpi.cd != null ? ' d' : ''}</span>Douane → DC</div>
        <div className="kpi"><span>{kpi.ds ?? '—'}{kpi.ds != null ? ' d' : ''}</span>DC → winkel</div>
        <div className={`kpi ${kpi.dem ? 'warn' : ''}`}><span>{fmtUSD(kpi.dem)}</span>gem. demurrage</div>
        <div className={`kpi ${kpi.inWindow ? 'warn' : ''}`}><span>{kpi.inWindow}</span>in demurrage-venster</div>
      </div>

      {sel && (
        <div className="of-card hl" ref={panelRef}>
          <div className="of-detail-head">
            <div>
              <div className="of-card-title">PO {sel.po_number}{isBonaireMultimart(sel) && <span className="star"> *</span>}</div>
              <div className="of-sub">{sel.vendor_name || sel.vendor_code || '—'} · {sel.dept || 'afd. —'} · store {sel.order_store || '—'} · totaal {fmtUSD(sel.total_cost)}</div>
              {isBonaireMultimart(sel) && <div className="warnline">* Bonaire/Multimart — deze flow is tot op heden nog niet ingericht.</div>}
              {sel.final_payment_late && <div className="warnline">⚠ Laatste betaling valt minder dan 3 dagen vóór de douanedatum — risico voor de paper release.</div>}
            </div>
            <button className="link" onClick={() => setSel(null)}>sluiten ✕</button>
          </div>

          <Journey steps={selSteps} demUsd={sel.demurrage_est_usd} demDays={sel.demurrage_days} />

          {(sel.vessel_name || sel.tracking_status) && (
            <div className="track">
              {sel.tracking_status === 'success'
                ? <>🚢 <b>{sel.vessel_name || '—'}</b> · voortgang {sel.tracking_progress ?? '—'}% · {sel.pol_name || '—'} → {sel.pod_name || '—'} · positie {sel.vessel_lat != null ? `${sel.vessel_lat}, ${sel.vessel_lng}` : '—'}</>
                : <>VesselFinder: {sel.tracking_message || sel.tracking_status}</>}
            </div>
          )}

          <div className="of-block-title">Bewerken</div>
          <div className="edit-grid">
            <label>Container-nr (11 tekens)<input value={edit.container_no} onChange={(e) => setEdit({ ...edit, container_no: e.target.value })} placeholder="ABCD1234567" /></label>
            <label>Rederij<select value={edit.sealine} onChange={(e) => setEdit({ ...edit, sealine: e.target.value })}>{SEALINES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <div className="save-cell"><button className="btn" disabled={tracking} onClick={trackVessel}>{tracking ? 'Ophalen…' : 'ETA ophalen via VesselFinder'}</button></div>

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

          <div className="of-block-title">Producten in deze PO <span className="of-sub">({items.length} SKU&apos;s · {fmtUSD(itemsTotal)})</span></div>
          <div className="of-tablewrap">
            {items.length === 0 ? <div className="of-sub">Geen gekoppelde artikelen gevonden voor dit PO-nummer.</div> : (
              <table className="of-table sm">
                <thead><tr><th>SKU</th><th>Omschrijving</th><th>Afdeling</th><th className="num">Aantal</th><th className="num">Kostprijs</th><th className="num">Waarde</th></tr></thead>
                <tbody>
                  {items.slice(0, 200).map((i) => (
                    <tr key={i.id}><td>{i.item_number}</td><td>{i.item_description}</td><td>{i.dept_name || i.dept_code || '—'}</td><td className="num">{i.qoo ?? '—'}</td><td className="num">{i.avg_cost != null ? fmtUSD(i.avg_cost) : '—'}</td><td className="num">{i.order_value != null ? fmtUSD(i.order_value) : '—'}</td></tr>
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

      <div className="of-card">
        <div className="of-card-title">Nieuwe PO toevoegen</div>
        <div className="of-add">
          <input placeholder="PO-nummer (1/2/B/M/R + 4 cijfers)" value={np.po_number} onChange={(e) => setNp({ ...np, po_number: e.target.value })} />
          <input placeholder="Leverancier" value={np.vendor_name} onChange={(e) => setNp({ ...np, vendor_name: e.target.value })} />
          <input placeholder="Afdeling" value={np.dept} onChange={(e) => setNp({ ...np, dept: e.target.value })} />
          <input type="date" title="ETA" value={np.eta} onChange={(e) => setNp({ ...np, eta: e.target.value })} />
          <input type="number" placeholder="PO-totaal (USD)" value={np.total_cost} onChange={(e) => setNp({ ...np, total_cost: e.target.value })} />
          <button className="btn primary" disabled={busy} onClick={addPo}>Toevoegen</button>
        </div>
      </div>

      {err && <div className="of-error">Fout: {err}</div>}

      <div className="of-card">
        <div className="of-card-title">Alle PO&apos;s <span className="of-sub">— klik een rij voor de reis</span></div>
        {loading ? <div className="of-empty">Laden…</div> : rows.length === 0 ? <div className="of-empty">Nog geen PO&apos;s.</div> : (
          <div className="of-tablewrap">
            <table className="of-table">
              <thead><tr><th>PO</th><th>Leverancier</th><th>Afd.</th><th>Store</th><th>ETA</th><th>Douane</th><th>Chassis</th><th>Demurrage</th><th>Container</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${r.in_demurrage_window ? 'danger' : ''} ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => selectRow(r)}>
                    <td className="po">{r.po_number}{isBonaireMultimart(r) && <span className="star"> *</span>}</td>
                    <td>{r.vendor_name || r.vendor_code || '—'}</td>
                    <td>{r.dept || '—'}</td>
                    <td>{r.order_store || '—'}</td>
                    <td>{fmtDate(r.eta)}{r.eta_source === 'vesselfinder' && <span className="vf" title="ETA via VesselFinder"> ⚓</span>}</td>
                    <td>{fmtDate(r.customs_date)}</td>
                    <td>{fmtDate(r.chassis_return_date)}</td>
                    <td className="num"><span className={`dem ${demColor(r.demurrage_est_usd)}`}>{r.demurrage_est_usd != null ? fmtUSD(r.demurrage_est_usd) : '—'}</span></td>
                    <td>{r.container_no || '—'}</td>
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
.of-block-title{font-weight:600;font-size:13px;margin:14px 0 8px;color:#374151}
.edit-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:end}
.edit-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6b7280}
.edit-grid input,.edit-grid select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.save-cell{display:flex;align-items:center;gap:10px}
.saved{color:#166534;font-size:13px;font-weight:500}
.of-add{display:grid;grid-template-columns:1.4fr 1.4fr 1fr 1fr 1fr auto;gap:8px}
.of-add input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;width:100%}
.of-error{background:#fef2f2;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.of-empty{color:#6b7280;text-align:center;padding:24px}
.of-tablewrap{overflow-x:auto}
.of-table{width:100%;border-collapse:collapse;font-size:13px}
.of-table.sm{font-size:12px}
.of-table th{text-align:left;color:#6b7280;font-weight:500;padding:8px;border-bottom:2px solid #e5e7eb;white-space:nowrap}
.of-table td{padding:8px;border-bottom:1px solid #f1f3f5;white-space:nowrap}
.of-table tbody tr{cursor:pointer}
.of-table tbody tr:hover{background:#f8fafc}
.of-table tr.danger td{background:#fff5f5}
.of-table tr.selected td{background:#eef3f9}
.of-table td.po{font-weight:600;color:#1B3A5C}
.num{text-align:right;font-variant-numeric:tabular-nums}
.dem{padding:2px 6px;border-radius:5px;font-weight:600}
.dem.g{background:#dcfce7;color:#166534}.dem.o{background:#fef3c7;color:#92400e}.dem.r{background:#fee2e2;color:#b91c1c}
.vf{color:#1d4ed8}
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
