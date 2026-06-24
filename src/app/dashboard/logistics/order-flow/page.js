/* ============================================================
   BESTAND: page.js  (Order Flow portal — v2)
   KOPIEER NAAR: src/app/dashboard/logistics/order-flow/page.js
   (overschrijft de vorige versie)

   NIEUW t.o.v. v1:
   - Visuele reisweergave boven de tabel (fabriek -> schip -> douane
     -> DC -> winkel) met datum per stap; klik een rij om te tonen.
   - 'Gemiddelde container'-kaart met gem. dagen in douane + gem. demurrage.
   - Expliciete OPSLAAN-knop (geen stil auto-save meer) + bevestiging.
   - Demurrage: eerste 5 dagen vrij, daarna $100/dag (berekend in view).
   - Opmerkingen per PO blijven.

   Vereist view order_flow_v met velden demurrage_days / demurrage_est_usd
   (zie STAP 10).
   ============================================================ */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';

const NAVY = '#1B3A5C';
const fmtUSD = (n) => (n == null ? '—' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('nl-NL') : '—');
const toInput = (d) => (d ? String(d).slice(0, 10) : '');
const daysBetween = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null);
const STATUSES = ['open', 'in_transit', 'customs', 'received', 'closed'];

/* ---------- Reis-pictogram ---------- */
function Glyph({ type, cx }) {
  const t = `translate(${cx},30)`;
  const f = '#e8eff7';
  const p = { fill: f, stroke: NAVY, strokeWidth: 1 };
  const w = { fill: '#ffffff', stroke: NAVY, strokeWidth: 1 };
  if (type === 'factory') return (<g transform={t}><polygon points="-28,18 0,0 28,18" {...p} /><rect x="-26" y="18" width="52" height="28" rx="2" {...p} /><rect x="-16" y="4" width="7" height="14" {...p} /><rect x="-7" y="32" width="14" height="14" rx="1" {...w} /></g>);
  if (type === 'ship') return (<g transform={t}><polygon points="-30,28 30,28 22,42 -22,42" {...p} /><rect x="-22" y="14" width="18" height="14" rx="1" {...p} /><rect x="4" y="14" width="18" height="14" rx="1" {...p} /></g>);
  if (type === 'customs') return (<g transform={t}><rect x="-28" y="4" width="56" height="9" rx="1" {...p} /><rect x="-26" y="13" width="7" height="33" {...p} /><rect x="19" y="13" width="7" height="33" {...p} /><rect x="-19" y="24" width="38" height="7" rx="1" fill="#fde68a" stroke={NAVY} strokeWidth="1" /></g>);
  if (type === 'dc') return (<g transform={t}><rect x="-32" y="10" width="64" height="9" rx="1" {...p} /><rect x="-28" y="19" width="56" height="27" rx="2" {...p} /><rect x="-9" y="27" width="18" height="19" rx="1" {...w} /></g>);
  return (<g transform={t}><rect x="-28" y="12" width="56" height="8" rx="1" {...p} /><rect x="-26" y="20" width="52" height="26" rx="2" {...p} /><rect x="-20" y="26" width="12" height="10" rx="1" {...w} /><rect x="8" y="26" width="12" height="10" rx="1" {...w} /><rect x="-6" y="32" width="12" height="14" rx="1" {...w} /></g>);
}

function Journey({ nodes, badge }) {
  const cx = [80, 210, 340, 470, 600];
  const types = ['factory', 'ship', 'customs', 'dc', 'store'];
  const y = 53;
  const danger = badge && badge.tone === 'red';
  const bcol = danger ? { bg: '#fef2f2', br: '#fecaca', t1: '#b91c1c', t2: '#dc2626' } : { bg: '#fef3c7', br: '#fde68a', t1: '#92400e', t2: '#b45309' };
  const dArr = danger ? '#dc2626' : '#94a3b8';
  return (
    <svg viewBox="0 0 680 188" width="100%" style={{ maxWidth: 680, display: 'block', margin: '0 auto' }}>
      <defs>
        <marker id="ofa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker>
        <marker id="ofd" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke={dArr} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></marker>
      </defs>
      <line x1="112" y1={y} x2="178" y2={y} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#ofa)" />
      <line x1="242" y1={y} x2="308" y2={y} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#ofa)" />
      <line x1="372" y1={y} x2="438" y2={y} stroke={dArr} strokeWidth={danger ? 2.5 : 1.5} markerEnd="url(#ofd)" />
      <line x1="502" y1={y} x2="568" y2={y} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#ofa)" />
      {cx.map((x, i) => (
        <g key={i}>
          <Glyph type={types[i]} cx={x} />
          <text x={x} y="92" textAnchor="middle" fontSize="13" fontWeight="600" fill={NAVY}>{nodes[i].title}</text>
          <text x={x} y="110" textAnchor="middle" fontSize="12" fill={nodes[i].value === '—' ? '#9ca3af' : '#374151'}>{nodes[i].value}</text>
        </g>
      ))}
      {badge && (
        <g>
          <line x1="405" y1="60" x2="405" y2="128" stroke={bcol.br} strokeWidth="1" strokeDasharray="4 4" />
          <rect x="316" y="128" width="178" height="42" rx="10" fill={bcol.bg} stroke={bcol.br} strokeWidth="1" />
          <text x="405" y="146" textAnchor="middle" fontSize="12" fontWeight="600" fill={bcol.t1}>{badge.line1}</text>
          <text x="405" y="162" textAnchor="middle" fontSize="11" fill={bcol.t2}>{badge.line2}</text>
        </g>
      )}
    </svg>
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [rem, setRem] = useState({ assignee_email: '', message: '', due_at: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [np, setNp] = useState({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });
  const panelRef = useRef(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3500); };

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
    setSel(row);
    setSaved(false);
    setEdit({
      customs_date: toInput(row.customs_date),
      dc_received_date: toInput(row.dc_received_date),
      dc_store: row.dc_store ?? '',
      status: row.status || 'open',
      total_cost: row.total_cost ?? '',
    });
    const [{ data: cm }, { data: rm }] = await Promise.all([
      supabase.from('order_flow_comments').select('*').eq('po_id', row.id).order('created_at', { ascending: false }),
      supabase.from('order_flow_reminders').select('*').eq('po_id', row.id).order('due_at', { ascending: true }),
    ]);
    setComments(cm || []); setReminders(rm || []);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function saveEdits() {
    if (!sel) return;
    setSaving(true);
    const patch = {
      customs_date: edit.customs_date || null,
      dc_received_date: edit.dc_received_date || null,
      dc_store: edit.dc_store === '' ? null : Number(edit.dc_store),
      status: edit.status || 'open',
      total_cost: edit.total_cost === '' ? null : Number(edit.total_cost),
    };
    const { error } = await supabase.from('order_flow').update(patch).eq('id', sel.id);
    setSaving(false);
    if (error) { flash('Opslaan mislukt: ' + error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    await refreshRow(sel.id);
  }

  async function addPo() {
    if (!np.po_number.trim()) { flash('PO-nummer is verplicht'); return; }
    setBusy(true);
    const { error } = await supabase.from('order_flow').insert({
      po_number: np.po_number.trim(), vendor_name: np.vendor_name || null, dept: np.dept || null,
      eta: np.eta || null, total_cost: np.total_cost ? Number(np.total_cost) : null,
    });
    setBusy(false);
    if (error) { flash('Toevoegen mislukt: ' + error.message); return; }
    setNp({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });
    await loadRows(); flash('PO toegevoegd');
  }

  async function deletePo(id, po, e) {
    e?.stopPropagation();
    if (!confirm(`PO ${po} verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
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

  /* Gemiddelden over alle PO's */
  const avg = useMemo(() => {
    const mean = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
    const lead = [], etaCus = [], cusDc = [], dcSt = [], dem = [];
    for (const r of rows) {
      const l = daysBetween(r.po_created_date, r.eta); if (l != null && l >= 0) lead.push(l);
      const ec = daysBetween(r.eta, r.customs_date); if (ec != null && ec >= 0) etaCus.push(ec);
      if (r.days_in_customs != null) cusDc.push(r.days_in_customs);
      const ds = daysBetween(r.dc_received_date, r.store1_date); if (ds != null && ds >= 0) dcSt.push(ds);
      if (r.demurrage_est_usd != null) dem.push(Number(r.demurrage_est_usd));
    }
    return { lead: mean(lead), etaCus: mean(etaCus), cusDc: mean(cusDc), dcSt: mean(dcSt), dem: mean(dem), n: cusDc.length };
  }, [rows]);

  const totals = useMemo(() => ({
    count: rows.length,
    inWindow: rows.filter((r) => r.in_demurrage_window).length,
    demSum: rows.reduce((s, r) => s + (Number(r.demurrage_est_usd) || 0), 0),
  }), [rows]);

  const selNodes = sel ? [
    { title: 'Fabriek', value: fmtDate(sel.po_created_date) },
    { title: 'Onderweg', value: fmtDate(sel.eta) },
    { title: 'Douane', value: fmtDate(sel.customs_date) },
    { title: 'BD DC', value: sel.dc_received_date ? `${fmtDate(sel.dc_received_date)}${sel.dc_store ? ` · st ${sel.dc_store}` : ''}` : '—' },
    { title: 'Winkel', value: fmtDate(sel.store1_date) },
  ] : null;
  const selBadge = sel && sel.customs_date ? {
    tone: sel.in_demurrage_window ? 'red' : 'amber',
    line1: `${sel.days_in_customs} dagen in douane`,
    line2: sel.demurrage_est_usd ? `${fmtUSD(sel.demurrage_est_usd)} demurrage` : 'binnen vrije dagen',
  } : null;

  const avgNodes = [
    { title: 'Fabriek', value: 'Besteld' },
    { title: 'Onderweg', value: avg.lead != null ? `+${avg.lead} dgn` : '—' },
    { title: 'Douane', value: avg.etaCus != null ? `+${avg.etaCus} dgn` : '—' },
    { title: 'BD DC', value: avg.cusDc != null ? `+${avg.cusDc} dgn` : '—' },
    { title: 'Winkel', value: avg.dcSt != null ? `+${avg.dcSt} dgn` : '—' },
  ];
  const avgBadge = avg.cusDc != null ? {
    tone: 'amber',
    line1: `gem. ${avg.cusDc} dagen in douane`,
    line2: `gem. ${fmtUSD(avg.dem)} demurrage (n=${avg.n})`,
  } : null;

  return (
    <div className="of-wrap">
      <style>{css}</style>

      <div className="of-head">
        <div>
          <h1>Order Flow</h1>
          <p className="of-sub">Van bestelling tot ontvangst · demurrage = eerste 5 dagen vrij, daarna $100/container/dag</p>
        </div>
        <div className="of-kpis">
          <div className="kpi"><span>{totals.count}</span>PO&apos;s</div>
          <div className="kpi warn"><span>{totals.inWindow}</span>in demurrage-venster</div>
          <div className="kpi warn"><span>{fmtUSD(totals.demSum)}</span>demurrage (schatting)</div>
        </div>
      </div>

      <div className="of-card">
        <div className="of-card-title">Gemiddelde container</div>
        <Journey nodes={avgNodes} badge={avgBadge} />
        {avg.cusDc == null && <div className="of-hint center">Nog geen douane-/finalize-datums ingevuld — vul er een paar in en deze gemiddelden vullen zich.</div>}
      </div>

      {sel && (
        <div className="of-card hl" ref={panelRef}>
          <div className="of-detail-head">
            <div>
              <div className="of-card-title">PO {sel.po_number}</div>
              <div className="of-sub">{sel.vendor_name || sel.vendor_code || '—'} · {sel.dept || 'afd. —'} · totaal {fmtUSD(sel.total_cost)}</div>
            </div>
            <button className="link" onClick={() => setSel(null)}>sluiten ✕</button>
          </div>

          <Journey nodes={selNodes} badge={selBadge} />

          <div className="of-block-title">Bewerken</div>
          <div className="edit-grid">
            <label>Douanedatum<input type="date" value={edit.customs_date} onChange={(e) => setEdit({ ...edit, customs_date: e.target.value })} /></label>
            <label>Finalize (DC)<input type="date" value={edit.dc_received_date} onChange={(e) => setEdit({ ...edit, dc_received_date: e.target.value })} /></label>
            <label>Store<select value={edit.dc_store} onChange={(e) => setEdit({ ...edit, dc_store: e.target.value })}><option value="">—</option><option value="1">1</option><option value="2">2</option><option value="5">5</option></select></label>
            <label>Status<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>PO-totaal (USD)<input type="number" value={edit.total_cost} onChange={(e) => setEdit({ ...edit, total_cost: e.target.value })} /></label>
            <div className="save-cell">
              <button className="btn primary" disabled={saving} onClick={saveEdits}>{saving ? 'Opslaan…' : 'Opslaan'}</button>
              {saved && <span className="saved">Opgeslagen ✓</span>}
            </div>
          </div>

          <div className="of-cols">
            <div className="of-col">
              <div className="of-block-title">Betalingen</div>
              <div className="pay-row"><div><b>Aanbetaling 30%</b><div className="of-sub">{sel.deposit_requested_at ? `Aangevraagd ${fmtDate(sel.deposit_requested_at)} · ${sel.deposit_invoice_no} · ${fmtUSD(sel.deposit_amount)}` : 'Nog niet aangevraagd'}</div></div><button className="btn" disabled={busy} onClick={() => requestPayment('deposit')}>Aanvragen</button></div>
              <div className="pay-row"><div><b>Restbetaling 70%</b><div className="of-sub">{sel.final_requested_at ? `Aangevraagd ${fmtDate(sel.final_requested_at)} · ${sel.final_invoice_no} · ${fmtUSD(sel.final_amount)}` : 'Nog niet aangevraagd'}</div></div><button className="btn" disabled={busy} onClick={() => requestPayment('final')}>Aanvragen</button></div>
              <div className="of-hint">Een aanvraag maakt een pro forma en mailt die naar de crediteuren-mailbox.</div>
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
          <input placeholder="PO-nummer *" value={np.po_number} onChange={(e) => setNp({ ...np, po_number: e.target.value })} />
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
              <thead><tr><th>PO</th><th>Leverancier</th><th>Afd.</th><th>ETA</th><th>Douane</th><th>Finalize</th><th>Store</th><th>Dagen douane</th><th>Demurrage</th><th>Betaling</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${r.in_demurrage_window ? 'danger' : ''} ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => selectRow(r)}>
                    <td className="po">{r.po_number}</td>
                    <td>{r.vendor_name || r.vendor_code || '—'}</td>
                    <td>{r.dept || '—'}</td>
                    <td>{fmtDate(r.eta)}</td>
                    <td>{fmtDate(r.customs_date)}</td>
                    <td>{fmtDate(r.dc_received_date)}</td>
                    <td className="num">{r.dc_store ?? '—'}</td>
                    <td className="num">{r.days_in_customs ?? '—'}</td>
                    <td className="num">{r.demurrage_est_usd ? fmtUSD(r.demurrage_est_usd) : '—'}</td>
                    <td className="pay"><span className={r.deposit_requested_at ? 'dot on' : 'dot'}>30</span><span className={r.final_requested_at ? 'dot on' : 'dot'}>70</span></td>
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
.of-wrap{padding:24px;max-width:1300px;margin:0 auto;color:#1a1a1a;font-family:system-ui,Arial,sans-serif}
.of-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.of-wrap h1{margin:0;font-size:24px;color:#1B3A5C}
.of-sub{color:#6b7280;font-size:13px;margin:2px 0 0;font-weight:400}
.of-kpis{display:flex;gap:10px;flex-wrap:wrap}
.kpi{background:#eef3f9;border-radius:10px;padding:10px 14px;font-size:12px;color:#6b7280;text-align:center;min-width:96px}
.kpi span{display:block;font-size:18px;font-weight:600;color:#1B3A5C}
.kpi.warn{background:#fef2f2;color:#991b1b}.kpi.warn span{color:#b91c1c}
.of-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}
.of-card.hl{border-color:#1B3A5C;box-shadow:0 0 0 3px rgba(27,58,92,0.06)}
.of-card-title{font-weight:600;margin-bottom:10px;color:#1B3A5C}
.of-add{display:grid;grid-template-columns:1.2fr 1.4fr 1fr 1fr 1fr auto;gap:8px}
.of-add input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;width:100%}
.of-error{background:#fef2f2;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.of-empty{color:#6b7280;text-align:center;padding:24px}
.of-hint{color:#6b7280;font-size:12px;margin-top:6px}.of-hint.center{text-align:center}
.of-tablewrap{overflow-x:auto}
.of-table{width:100%;border-collapse:collapse;font-size:13px}
.of-table th{text-align:left;color:#6b7280;font-weight:500;padding:8px;border-bottom:2px solid #e5e7eb;white-space:nowrap}
.of-table td{padding:8px;border-bottom:1px solid #f1f3f5;white-space:nowrap}
.of-table tbody tr{cursor:pointer}
.of-table tbody tr:hover{background:#f8fafc}
.of-table tr.danger td{background:#fff5f5}
.of-table tr.selected td{background:#eef3f9}
.of-table td.po{font-weight:600;color:#1B3A5C}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pay{display:flex;gap:4px}
.dot{display:inline-flex;align-items:center;justify-content:center;width:24px;height:20px;border-radius:5px;background:#eef0f2;color:#9aa0a6;font-size:11px;font-weight:600}
.dot.on{background:#d97706;color:#fff}
.link{background:none;border:none;color:#1d4ed8;cursor:pointer;font-size:13px;padding:0;text-decoration:underline}
.link.del{color:#b91c1c}
.btn{padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
.btn:hover{background:#f9fafb}
.btn.primary{background:#1B3A5C;color:#fff;border-color:#1B3A5C}
.btn:disabled{opacity:.5;cursor:default}
.of-detail-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.of-block-title{font-weight:600;font-size:13px;margin:14px 0 8px;color:#374151}
.edit-grid{display:grid;grid-template-columns:repeat(5,1fr) auto;gap:10px;align-items:end}
.edit-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#6b7280}
.edit-grid input,.edit-grid select{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.save-cell{display:flex;align-items:center;gap:10px}
.saved{color:#166534;font-size:13px;font-weight:500}
.of-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:6px}
.pay-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px;border:1px solid #eef0f2;border-radius:8px;margin-bottom:8px}
.rem-form,.cm-form{display:grid;gap:8px;margin-bottom:10px}
.rem-form{grid-template-columns:1fr 1fr auto auto}
.rem-form input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
.cm-form{grid-template-columns:1fr auto;align-items:start}
.cm-form textarea{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;min-height:60px;resize:vertical}
.rem-list,.cm-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.rem{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #eef0f2;border-radius:8px}
.rem.sent{opacity:.6}.rem.done{opacity:.5}.rem.cancelled{opacity:.4;text-decoration:line-through}
.rem-actions{display:flex;gap:8px;align-items:center}
.tag{font-size:11px;padding:1px 6px;border-radius:5px;background:#eef0f2;color:#6b7280}
.tag.sent{background:#dbeafe;color:#1e40af}.tag.done{background:#dcfce7;color:#166534}.tag.pending{background:#fef3c7;color:#92400e}.tag.cancelled{background:#f3f4f6}
.cm-list li{border:1px solid #f1f3f5;border-radius:8px;padding:8px 10px;font-size:13px}
.cm-meta{color:#9aa0a6;font-size:11px;margin-bottom:2px}
.of-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1B3A5C;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:50;max-width:90vw}
@media(max-width:900px){.of-add{grid-template-columns:1fr 1fr}.of-cols{grid-template-columns:1fr}.rem-form{grid-template-columns:1fr}.edit-grid{grid-template-columns:1fr 1fr}}
`;