/* ============================================================
   BESTAND: page.js  (Order Flow portal)
   KOPIEER NAAR: src/app/dashboard/logistics/order-flow/page.js   (NIEUW)

   Interactieve PO-portal:
   - tabel uit order_flow_v (incl. live demurrage)
   - regels toevoegen / verwijderen (verwijderen = admin)
   - inline bewerken: douanedatum (inklaring), finalize/DC (DC-manager), status
   - betaalknoppen: aanbetaling 30% / restbetaling 70% (-> pro forma + mail)
   - feedback/opmerkingen per PO
   - reminders met toewijzing + vervaldatum (mail via dagelijkse cron)

   Importeert exact zoals de rest van je dashboard:
     import { createClient } from '@/lib/supabase'
   ============================================================ */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';

const fmtUSD = (n) =>
  n == null ? '—' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('nl-NL') : '—');
const toInput = (d) => (d ? String(d).slice(0, 10) : '');

const STATUSES = ['open', 'in_transit', 'customs', 'received', 'closed'];

export default function OrderFlowPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [email, setEmail] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [sel, setSel] = useState(null); // geselecteerde PO (detailpaneel)
  const [comments, setComments] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [rem, setRem] = useState({ assignee_email: '', message: '', due_at: '' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [np, setNp] = useState({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase.from('order_flow_v').select('*').order('eta', { ascending: true, nullsFirst: false });
    if (error) setErr(error.message);
    else setRows(data || []);
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
    if (data) {
      setRows((r) => r.map((x) => (x.id === id ? data : x)));
      setSel((s) => (s && s.id === id ? data : s));
    }
  }

  async function updateField(id, field, value) {
    const v = value === '' ? null : value;
    setRows((r) => r.map((x) => (x.id === id ? { ...x, [field]: v } : x)));
    const { error } = await supabase.from('order_flow').update({ [field]: v }).eq('id', id);
    if (error) { flash('Opslaan mislukt: ' + error.message); return; }
    await refreshRow(id);
  }

  async function addPo() {
    if (!np.po_number.trim()) { flash('PO-nummer is verplicht'); return; }
    setBusy(true);
    const payload = {
      po_number: np.po_number.trim(),
      vendor_name: np.vendor_name || null,
      dept: np.dept || null,
      eta: np.eta || null,
      total_cost: np.total_cost ? Number(np.total_cost) : null,
    };
    const { error } = await supabase.from('order_flow').insert(payload);
    setBusy(false);
    if (error) { flash('Toevoegen mislukt: ' + error.message); return; }
    setNp({ po_number: '', vendor_name: '', dept: '', eta: '', total_cost: '' });
    await loadRows();
    flash('PO toegevoegd');
  }

  async function deletePo(id, po) {
    if (!confirm(`PO ${po} verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    const { error } = await supabase.from('order_flow').delete().eq('id', id);
    if (error) { flash('Verwijderen mislukt: ' + error.message); return; }
    setRows((r) => r.filter((x) => x.id !== id));
    if (sel?.id === id) setSel(null);
    flash('PO verwijderd');
  }

  async function openDetail(row) {
    setSel(row);
    const [{ data: cm }, { data: rm }] = await Promise.all([
      supabase.from('order_flow_comments').select('*').eq('po_id', row.id).order('created_at', { ascending: false }),
      supabase.from('order_flow_reminders').select('*').eq('po_id', row.id).order('due_at', { ascending: true }),
    ]);
    setComments(cm || []);
    setReminders(rm || []);
  }

  async function requestPayment(kind) {
    if (!sel) return;
    if (!sel.total_cost) { flash('Vul eerst PO-totaal in voor deze PO'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/order-flow/proforma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_id: sel.id, kind }),
      });
      const j = await res.json();
      if (!res.ok) { flash(j.error || 'Aanvraag mislukt'); return; }
      flash(`Pro forma ${j.invoice_no} gemaild (${fmtUSD(j.amount)} → ${j.sent_to})`);
      await refreshRow(sel.id);
    } catch (e) {
      flash('Netwerkfout: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!commentText.trim() || !sel) return;
    const { error } = await supabase.from('order_flow_comments').insert({
      po_id: sel.id, body: commentText.trim(), author_email: email,
    });
    if (error) { flash('Opmerking mislukt: ' + error.message); return; }
    setCommentText('');
    await openDetail(sel);
  }

  async function addReminder() {
    if (!sel || !rem.assignee_email.trim() || !rem.message.trim() || !rem.due_at) {
      flash('Vul e-mail, bericht en datum in'); return;
    }
    const { error } = await supabase.from('order_flow_reminders').insert({
      po_id: sel.id,
      assignee_email: rem.assignee_email.trim(),
      message: rem.message.trim(),
      due_at: new Date(rem.due_at).toISOString(),
      created_by_email: email,
    });
    if (error) { flash('Reminder mislukt: ' + error.message); return; }
    setRem({ assignee_email: '', message: '', due_at: '' });
    await openDetail(sel);
    flash('Reminder ingepland');
  }

  async function setReminderStatus(id, status) {
    await supabase.from('order_flow_reminders').update({ status }).eq('id', id);
    if (sel) await openDetail(sel);
  }

  const totals = useMemo(() => {
    const inWindow = rows.filter((r) => r.in_demurrage_window);
    const demSum = rows.reduce((s, r) => s + (Number(r.demurrage_est_usd) || 0), 0);
    return { count: rows.length, inWindow: inWindow.length, demSum };
  }, [rows]);

  return (
    <div className="of-wrap">
      <style>{css}</style>

      <div className="of-head">
        <div>
          <h1>Order Flow</h1>
          <p className="of-sub">PO-traject van bestelling tot ontvangst · demurrage = $100/container/dag tussen douane en DC</p>
        </div>
        <div className="of-kpis">
          <div className="kpi"><span>{totals.count}</span>PO&apos;s</div>
          <div className="kpi warn"><span>{totals.inWindow}</span>in demurrage-venster</div>
          <div className="kpi warn"><span>{fmtUSD(totals.demSum)}</span>demurrage (schatting)</div>
        </div>
      </div>

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
        {loading ? (
          <div className="of-empty">Laden…</div>
        ) : rows.length === 0 ? (
          <div className="of-empty">Nog geen PO&apos;s. Voeg er hierboven een toe.</div>
        ) : (
          <div className="of-tablewrap">
            <table className="of-table">
              <thead>
                <tr>
                  <th>PO</th><th>Leverancier</th><th>Afd.</th><th>ETA</th>
                  <th>Douanedatum</th><th>Finalize (DC)</th><th>Store</th>
                  <th>Dagen douane</th><th>Demurrage</th><th>Betaling</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.in_demurrage_window ? 'danger' : ''}>
                    <td><button className="link" onClick={() => openDetail(r)}>{r.po_number}</button></td>
                    <td>{r.vendor_name || r.vendor_code || '—'}</td>
                    <td>{r.dept || '—'}</td>
                    <td>{fmtDate(r.eta)}</td>
                    <td><input type="date" value={toInput(r.customs_date)} onChange={(e) => updateField(r.id, 'customs_date', e.target.value)} /></td>
                    <td><input type="date" value={toInput(r.dc_received_date)} onChange={(e) => updateField(r.id, 'dc_received_date', e.target.value)} /></td>
                    <td>
                      <select value={r.dc_store ?? ''} onChange={(e) => updateField(r.id, 'dc_store', e.target.value ? Number(e.target.value) : '')}>
                        <option value="">—</option><option value="1">1</option><option value="2">2</option><option value="5">5</option>
                      </select>
                    </td>
                    <td className="num">{r.days_in_customs ?? '—'}</td>
                    <td className="num">{r.demurrage_est_usd ? fmtUSD(r.demurrage_est_usd) : '—'}</td>
                    <td className="pay">
                      <span className={r.deposit_requested_at ? 'dot on' : 'dot'} title={r.deposit_requested_at ? `30% aangevraagd ${r.deposit_invoice_no || ''}` : '30% nog niet aangevraagd'}>30</span>
                      <span className={r.final_requested_at ? 'dot on' : 'dot'} title={r.final_requested_at ? `70% aangevraagd ${r.final_invoice_no || ''}` : '70% nog niet aangevraagd'}>70</span>
                    </td>
                    <td>
                      <select value={r.status || 'open'} onChange={(e) => updateField(r.id, 'status', e.target.value)}>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>{isAdmin && <button className="link del" onClick={() => deletePo(r.id, r.po_number)}>verwijder</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && (
        <div className="of-detail">
          <div className="of-card">
            <div className="of-detail-head">
              <div>
                <div className="of-card-title">PO {sel.po_number}</div>
                <div className="of-sub">{sel.vendor_name || sel.vendor_code || '—'} · {sel.dept || '—'} · ETA {fmtDate(sel.eta)} · totaal {fmtUSD(sel.total_cost)}</div>
              </div>
              <button className="link" onClick={() => setSel(null)}>sluiten ✕</button>
            </div>

            <div className="of-cols">
              <div className="of-col">
                <div className="of-block-title">Betalingen</div>
                <div className="pay-row">
                  <div>
                    <b>Aanbetaling 30%</b>
                    <div className="of-sub">{sel.deposit_requested_at ? `Aangevraagd ${fmtDate(sel.deposit_requested_at)} · ${sel.deposit_invoice_no} · ${fmtUSD(sel.deposit_amount)}` : 'Nog niet aangevraagd'}</div>
                  </div>
                  <button className="btn" disabled={busy} onClick={() => requestPayment('deposit')}>Aanvragen</button>
                </div>
                <div className="pay-row">
                  <div>
                    <b>Restbetaling 70%</b>
                    <div className="of-sub">{sel.final_requested_at ? `Aangevraagd ${fmtDate(sel.final_requested_at)} · ${sel.final_invoice_no} · ${fmtUSD(sel.final_amount)}` : 'Nog niet aangevraagd'}</div>
                  </div>
                  <button className="btn" disabled={busy} onClick={() => requestPayment('final')}>Aanvragen</button>
                </div>
                <div className="of-hint">Een aanvraag genereert een pro forma en mailt die naar de crediteuren-mailbox.</div>
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
                      <div>
                        <b>{x.assignee_email}</b> · {fmtDate(x.due_at)} <span className={`tag ${x.status}`}>{x.status}</span>
                        <div className="of-sub">{x.message}</div>
                      </div>
                      {x.status === 'pending' && (
                        <div className="rem-actions">
                          <button className="link" onClick={() => setReminderStatus(x.id, 'done')}>klaar</button>
                          <button className="link del" onClick={() => setReminderStatus(x.id, 'cancelled')}>annuleer</button>
                        </div>
                      )}
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
              {comments.map((c) => (
                <li key={c.id}>
                  <div className="cm-meta">{c.author_email || 'onbekend'} · {new Date(c.created_at).toLocaleString('nl-NL')}</div>
                  <div>{c.body}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {toast && <div className="of-toast">{toast}</div>}
    </div>
  );
}

const css = `
.of-wrap{padding:24px;max-width:1300px;margin:0 auto;color:#1a1a1a;font-family:system-ui,Arial,sans-serif}
.of-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.of-wrap h1{margin:0;font-size:24px}
.of-sub{color:#6b7280;font-size:13px;margin:2px 0 0}
.of-kpis{display:flex;gap:10px;flex-wrap:wrap}
.kpi{background:#f3f4f6;border-radius:10px;padding:10px 14px;font-size:12px;color:#6b7280;text-align:center;min-width:96px}
.kpi span{display:block;font-size:18px;font-weight:600;color:#111}
.kpi.warn{background:#fef2f2;color:#991b1b}
.kpi.warn span{color:#b91c1c}
.of-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}
.of-card-title{font-weight:600;margin-bottom:10px}
.of-add{display:grid;grid-template-columns:1.2fr 1.4fr 1fr 1fr 1fr auto;gap:8px}
.of-add input{padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;width:100%}
.of-error{background:#fef2f2;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.of-empty{color:#6b7280;text-align:center;padding:24px}
.of-tablewrap{overflow-x:auto}
.of-table{width:100%;border-collapse:collapse;font-size:13px}
.of-table th{text-align:left;color:#6b7280;font-weight:500;padding:8px;border-bottom:2px solid #e5e7eb;white-space:nowrap}
.of-table td{padding:6px 8px;border-bottom:1px solid #f1f3f5;white-space:nowrap}
.of-table tr.danger td{background:#fff5f5}
.of-table input[type=date],.of-table select{padding:5px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pay{display:flex;gap:4px}
.dot{display:inline-flex;align-items:center;justify-content:center;width:24px;height:20px;border-radius:5px;background:#eef0f2;color:#9aa0a6;font-size:11px;font-weight:600}
.dot.on{background:#d97706;color:#fff}
.link{background:none;border:none;color:#1d4ed8;cursor:pointer;font-size:13px;padding:0;text-decoration:underline}
.link.del{color:#b91c1c}
.btn{padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;white-space:nowrap}
.btn:hover{background:#f9fafb}
.btn.primary{background:#111;color:#fff;border-color:#111}
.btn:disabled{opacity:.5;cursor:default}
.of-detail-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.of-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:8px}
.of-block-title{font-weight:600;font-size:13px;margin:12px 0 8px;color:#374151}
.pay-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px;border:1px solid #eef0f2;border-radius:8px;margin-bottom:8px}
.of-hint{color:#6b7280;font-size:12px;margin-top:4px}
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
.of-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:50;max-width:90vw}
@media(max-width:900px){.of-add{grid-template-columns:1fr 1fr}.of-cols{grid-template-columns:1fr}.rem-form{grid-template-columns:1fr}}
`;
