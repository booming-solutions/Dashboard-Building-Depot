/* ============================================================
   BESTAND: page.js
   LOCATIE: src/app/projects/[code]/page.js
   Projectdossier met vijf tabbladen.
   Bron: pm_projects, pm_v_project_status, pm_v_credit_status,
         pm_milestones, pm_v_order_planning, pm_customer_inputs,
         pm_commission_agreements, pm_commission_events, order_flow
   ============================================================ */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';
import {
  Kpi, Card, Pill, Dot, Bar, Loading, Empty, Foutmelding, Th, Td,
  fmt, geld, datum, dagenTot, dagTekst, planStatus, STATUS_TONE, STATUS_LABEL,
} from '@/components/projects/ui';

const TABS = [
  ['overzicht', 'Overzicht'],
  ['besteladvies', 'Besteladvies'],
  ['klantinput', 'Klantinput'],
  ['commissie', 'Commissie'],
  ['logistiek', 'Logistiek'],
];

const INPUT_TONE = { te_laat: 'crit', herinnerd: 'warn', open: 'watch', ontvangen: 'ok', vervallen: 'neutral', geannuleerd: 'neutral' };
const MIJLPAAL_TONE = { gereed: 'ok', onderhanden: 'warn', vertraagd: 'crit', gepland: 'neutral', geannuleerd: 'neutral' };

export default function ProjectDossier({ params }) {
  const code = decodeURIComponent(params.code);
  const supabase = createClient();

  const [tab, setTab] = useState('overzicht');
  const [filter, setFilter] = useState('alle');
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const laad = useCallback(async () => {
    setError('');
    const { data: p, error: e1 } = await supabase
      .from('pm_projects')
      .select('*, crm_accounts(name)')
      .eq('code', code)
      .single();

    if (e1) { setError(e1.message); return; }

    const id = p.id;
    const [status, krediet, mijlpalen, regels, inputs, afspraken, events, zendingen] = await Promise.all([
      supabase.from('pm_v_project_status').select('*').eq('project_id', id).maybeSingle(),
      supabase.from('pm_v_credit_status').select('*').eq('project_id', id).maybeSingle(),
      supabase.from('pm_milestones').select('*').eq('project_id', id).order('target_date', { ascending: true }),
      supabase.from('pm_v_order_planning').select('*').eq('project_id', id).order('order_by_date', { ascending: true }),
      supabase.from('pm_customer_inputs').select('*').eq('project_id', id).order('due_date', { ascending: true }),
      supabase.from('pm_commission_agreements').select('*').eq('project_id', id).order('vendor_name'),
      supabase.from('pm_commission_events').select('*').eq('project_id', id).order('trigger_date', { ascending: false }),
      supabase.from('order_flow').select('po_number, vendor_name, container_no, vessel_name, eta, customs_date, tracking_progress, tracking_status, status').eq('pm_project_id', id).order('eta', { ascending: true }),
    ]);

    setData({
      p,
      klant: p.crm_accounts ? p.crm_accounts.name : '—',
      status: status.data || {},
      krediet: krediet.data || null,
      mijlpalen: mijlpalen.data || [],
      regels: regels.data || [],
      inputs: inputs.data || [],
      afspraken: afspraken.data || [],
      events: events.data || [],
      zendingen: zendingen.data || [],
    });
  }, [supabase, code]);

  useEffect(() => { laad(); }, [laad]);

  if (error) return <Foutmelding error={error} />;
  if (!data) return <Loading tekst="Projectdossier laden..." />;

  const { p, klant, status, krediet, mijlpalen, regels, inputs, afspraken, events, zendingen } = data;

  const telStatus = k => regels.filter(r => planStatus(r) === k).length;
  const zichtbaar = filter === 'alle' ? regels : regels.filter(r => planStatus(r) === filter);
  const openCommissie = events.filter(e => ['open', 'te_factureren'].includes(e.status))
    .reduce((a, e) => a + Number(e.commission_amount || 0), 0);
  const inputTeLaat = inputs.filter(i => i.status !== 'ontvangen' && dagenTot(i.due_date) < 0).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C]">{p.name}</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            <span className="font-mono">{p.code}</span> · {klant} · {fmt(p.units_planned)} woningen ·
            model <span className="font-semibold">{p.delivery_model}</span> · {p.island}
          </p>
        </div>
        <div className="flex-1" />
        <Link href="/projects" className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-[13px] font-medium text-[#1B3A5C]">
          Terug naar overzicht
        </Link>
      </div>

      <div className="flex gap-1 border-b border-gray-200 bg-white rounded-t-lg px-1.5">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'px-3.5 py-2.5 text-[13px] border-b-2 -mb-px transition-colors ' +
              (tab === k ? 'border-[#1B3A5C] text-[#1B3A5C] font-semibold' : 'border-transparent text-gray-500 hover:text-[#1B3A5C]')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'overzicht' && (
        <div className="space-y-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Kpi label="Woningen" value={fmt(p.units_planned)} sub={fmt(status.milestones_total) + ' mijlpalen'} />
            <Kpi label="Te laat" value={fmt(status.items_te_laat || 0)} sub="bestelregels" tone="crit" />
            <Kpi label="Kritiek" value={fmt(status.items_kritiek || 0)} sub="binnen 7 dagen bestellen" tone="warn" />
            <Kpi label="Klantinput te laat" value={fmt(inputTeLaat)} sub={fmt(status.inputs_open || 0) + ' open'} tone="crit" />
            <Kpi label="Commissie te factureren" value={fmt(openCommissie)} sub={(p.currency || 'USD') + ' · na douanevrijgave'} tone="navy" />
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
            <Card title="Mijlpalen" hint="bron: intake met de klant">
              <div className="p-4">
                {mijlpalen.length === 0 && <Empty titel="Nog geen mijlpalen" hint="Voeg ze toe vanuit de intake met de klant, of laat ze voorstellen op basis van een geüploade materiaalstaat." />}
                {mijlpalen.length > 0 && (
                  <div className="relative pl-5" style={{ borderLeft: '2px solid #eef1f5' }}>
                    {mijlpalen.map(m => (
                      <div key={m.id} className="relative pb-4 last:pb-0">
                        <span className="absolute rounded-full"
                          style={{
                            left: -26, top: 5, width: 11, height: 11,
                            background: m.status === 'gereed' ? '#059669' : (m.status === 'onderhanden' ? '#1B3A5C' : '#fff'),
                            border: '2px solid ' + (m.status === 'gereed' ? '#059669' : (m.status === 'onderhanden' ? '#1B3A5C' : '#d7dde5')),
                          }} />
                        <p className="text-[11px] text-gray-400 font-mono">{datum(m.target_date)}</p>
                        <p className="text-[13.5px] font-semibold text-[#1B3A5C]">{m.name}</p>
                        <p className="text-[12px] text-gray-500">
                          {m.phase ? m.phase + ' · ' : ''}
                          {regels.filter(r => r.milestone_id === m.id).length} productregels
                          {m.status !== 'gepland' && <span className="ml-1"><Pill tone={MIJLPAAL_TONE[m.status]}>{m.status}</Pill></span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card title="Krediet en betaaltermijn">
              <div className="p-4">
                {!krediet && <Empty titel="Nog geen kredietgegevens" hint="Vul kredietlimiet en betaaltermijn op het project, en laad de openstaande debiteuren uit Eagle." />}
                {krediet && (
                  <>
                    <div className="divide-y divide-gray-50">
                      <Regel titel="Kredietlimiet" sub="vastgesteld door de directeur" waarde={geld(krediet.kredietlimiet, p.currency)} />
                      <Regel titel="Openstaand" sub={'per ' + datum(krediet.as_of)} waarde={geld(krediet.open_amount, p.currency)} />
                      <Regel titel="Ruimte" sub={'betaaltermijn ' + (krediet.betaaltermijn_dagen || '—') + ' dagen'} waarde={geld(krediet.ruimte, p.currency)} />
                    </div>
                    {krediet.kredietlimiet > 0 && (
                      <div className="mt-3">
                        <Bar pct={Math.round(Number(krediet.open_amount || 0) / Number(krediet.kredietlimiet) * 100)}
                          tone={krediet.krediet_status === 'geblokkeerd' ? 'crit' : 'warn'} />
                        <p className="text-[12px] text-gray-500 mt-1.5">
                          {Math.round(Number(krediet.open_amount || 0) / Number(krediet.kredietlimiet) * 100)}% van de limiet gebruikt ·{' '}
                          <Pill tone={krediet.krediet_status === 'geblokkeerd' ? 'crit' : (krediet.krediet_status === 'bijna vol' ? 'warn' : 'ok')}>
                            {krediet.krediet_status}
                          </Pill>
                        </p>
                        {krediet.krediet_status === 'geblokkeerd' && (
                          <p className="text-[12px] text-red-700 mt-2">De kredietlimiet is bereikt. Er kan niet besteld worden tot dit is opgelost.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'besteladvies' && (
        <Card title="Besteladvies" hint="uiterste besteldatum = benodigd op de bouw − leadtime − buffer">
          <div className="px-4 pt-4 flex gap-2 flex-wrap">
            {[['alle', 'Alle', regels.length], ['te_laat', 'Te laat', telStatus('te_laat')], ['kritiek', 'Kritiek', telStatus('kritiek')],
              ['let_op', 'Let op', telStatus('let_op')], ['op_tijd', 'Op tijd', telStatus('op_tijd')]].map(([k, l, n]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={'px-3 py-1 rounded-full border text-[12.5px] ' +
                  (filter === k ? 'bg-[#1B3A5C] border-[#1B3A5C] text-white font-semibold' : 'bg-white border-gray-200 text-gray-600')}>
                {l} <span className="font-mono opacity-70">{n}</span>
              </button>
            ))}
          </div>

          {regels.length === 0 && <Empty titel="Nog geen productregels" hint="Hang producten aan de mijlpalen; de besteldatum wordt dan automatisch berekend." />}
          {regels.length > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-[13px]" style={{ minWidth: 1120 }}>
                <thead>
                  <tr>
                    <Th></Th><Th>Artikel</Th><Th>Leverancier</Th><Th right>Aantal</Th><Th>Mijlpaal</Th>
                    <Th>Nodig op de bouw</Th><Th right>Leadtime</Th><Th>Bestellen vóór</Th><Th>Status</Th><Th>Route</Th>
                  </tr>
                </thead>
                <tbody>
                  {zichtbaar.map(r => {
                    const s = planStatus(r);
                    const d = dagenTot(r.order_by_date);
                    return (
                      <tr key={r.item_id} className="hover:bg-gray-50">
                        <Td><Dot tone={STATUS_TONE[s]} /></Td>
                        <Td>
                          <span className="font-semibold text-[#1B3A5C]">{r.description}</span>
                          {r.sku && <span className="text-[11px] text-gray-400 font-mono ml-2">{r.sku}</span>}
                        </Td>
                        <Td>{r.vendor_name || '—'}</Td>
                        <Td right><span className="font-mono">{fmt(r.quantity)} {r.unit || ''}</span></Td>
                        <Td><span className="text-gray-500">{r.milestone_name}</span></Td>
                        <Td><span className="font-mono">{datum(r.needed_on_site)}</span></Td>
                        <Td right><span className="font-mono text-gray-400">{r.leadtime_days} + {r.buffer_days} d</span></Td>
                        <Td><span className="font-mono font-semibold">{datum(r.order_by_date)}</span></Td>
                        <Td>
                          <Pill tone={STATUS_TONE[s]}>{STATUS_LABEL[s] || s}</Pill>
                          <div className="text-[11px] text-gray-400 font-mono">{dagTekst(d)}</div>
                        </Td>
                        <Td>{r.sourcing === 'direct' ? <Pill tone="navy">direct</Pill> : <Pill>via BDT</Pill>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'klantinput' && (
        <div className="space-y-4">
          <Card title="Wat wij van de klant nodig hebben" hint="deadline teruggerekend uit de besteldatum · herinneringen gaan automatisch">
            {inputs.length === 0 && <Empty titel="Nog geen klantinput vastgelegd" hint="Leg per beslissing vast wat je nodig hebt en wanneer; de tool bewaakt de deadline." />}
            {inputs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ minWidth: 900 }}>
                  <thead>
                    <tr><Th>Beslissing</Th><Th>Soort</Th><Th>Deadline</Th><Th>Status</Th><Th>Ontvangen</Th><Th>Gevolg bij uitstel</Th></tr>
                  </thead>
                  <tbody>
                    {inputs.map(i => {
                      const d = dagenTot(i.due_date);
                      const teLaat = i.status !== 'ontvangen' && d < 0;
                      return (
                        <tr key={i.id} className="hover:bg-gray-50">
                          <Td><span className="font-semibold text-[#1B3A5C]">{i.title}</span></Td>
                          <Td><span className="text-gray-500">{i.input_type}</span></Td>
                          <Td>
                            <span className="font-mono">{datum(i.due_date)}</span>
                            {i.status !== 'ontvangen' && <div className="text-[11px] text-gray-400 font-mono">{dagTekst(d)}</div>}
                          </Td>
                          <Td><Pill tone={teLaat ? 'crit' : (INPUT_TONE[i.status] || 'neutral')}>{teLaat ? 'te laat' : i.status}</Pill></Td>
                          <Td><span className="font-mono text-gray-500">{i.received_at ? datum(i.received_at) : '—'}</span></Td>
                          <Td wrap><span className="text-gray-500">{i.impact_note || '—'}</span></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="bg-[#1B3A5C]/5 border border-[#1B3A5C]/10 rounded-lg p-4 text-[12.5px] text-[#1B3A5C]">
            <b className="font-semibold">Dit is ook het dossier.</b> Elke deadline, elke herinnering en het moment van aanleveren worden vastgelegd.
            Ontstaat er later discussie over vertraging en boeteclausules, dan staat hier waar die is ontstaan.
          </div>
        </div>
      )}

      {tab === 'commissie' && (
        <div className="space-y-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <Card title="Commissielijst" hint="leeg = alles loopt via BDT">
              {afspraken.length === 0 && <Empty titel="Geen commissieafspraken" hint="Alles in dit project loopt via Building Depot." />}
              {afspraken.length > 0 && (
                <table className="w-full text-[13px]">
                  <thead><tr><Th>Leverancier</Th><Th>Grondslag</Th><Th right>Percentage</Th></tr></thead>
                  <tbody>
                    {afspraken.map(a => (
                      <tr key={a.id}>
                        <Td><span className="font-semibold text-[#1B3A5C]">{a.vendor_name}</span></Td>
                        <Td wrap><span className="text-gray-500">{a.notes || a.basis}</span></Td>
                        <Td right><span className="font-mono font-semibold">{String(a.commission_pct).replace('.', ',')} %</span></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Te factureren">
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Open commissie</p>
                <p className="text-2xl font-bold text-[#1B3A5C] mt-0.5">{geld(openCommissie, p.currency)}</p>
                <p className="text-[12px] text-gray-500 mt-1">
                  {events.filter(e => e.status === 'te_factureren').length} concepten klaar, wachten op controle
                </p>
                <Link href="/projects/tasks" className="inline-block mt-4 px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold">
                  Open de controletaken
                </Link>
              </div>
            </Card>
          </div>

          <Card title="Commissieregels" hint="automatisch opgesteld na douanevrijgave">
            {events.length === 0 && <Empty titel="Nog geen commissieregels" hint="Zodra een zending door de douane is vrijgegeven, maakt de tool hier automatisch een conceptfactuur aan." />}
            {events.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ minWidth: 900 }}>
                  <thead>
                    <tr><Th>PO</Th><Th>Omschrijving</Th><Th right>Inkoopwaarde</Th><Th right>%</Th><Th right>Commissie</Th><Th>Douanevrijgave</Th><Th>Status</Th></tr>
                  </thead>
                  <tbody>
                    {events.map(e => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <Td><span className="font-mono font-semibold">{e.po_number || '—'}</span></Td>
                        <Td wrap><span className="text-gray-600">{e.description}</span></Td>
                        <Td right><span className="font-mono">{fmt(e.basis_amount)}</span></Td>
                        <Td right><span className="font-mono">{String(e.commission_pct).replace('.', ',')}</span></Td>
                        <Td right><span className="font-mono font-semibold">{fmt(e.commission_amount)}</span></Td>
                        <Td><span className="font-mono">{datum(e.trigger_date)}</span></Td>
                        <Td>
                          {e.status === 'gefactureerd' && <Pill tone="ok">gefactureerd</Pill>}
                          {e.status === 'te_factureren' && <Pill tone="navy">concept klaar</Pill>}
                          {!['gefactureerd', 'te_factureren'].includes(e.status) && <Pill>{e.status}</Pill>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'logistiek' && (
        <Card title="Zendingen" hint="komt uit de bestaande Order Flow">
          {zendingen.length === 0 && <Empty titel="Nog geen zendingen gekoppeld" hint="Zet pm_project_id op de PO in order_flow, of koppel de regels via pm_po_links." />}
          {zendingen.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 900 }}>
                <thead>
                  <tr><Th>PO</Th><Th>Leverancier</Th><Th>Container</Th><Th>Schip</Th><Th>ETA</Th><Th>Douane</Th><Th>Voortgang</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {zendingen.map(z => (
                    <tr key={z.po_number} className="hover:bg-gray-50">
                      <Td><span className="font-mono font-semibold">{z.po_number}</span></Td>
                      <Td>{z.vendor_name || '—'}</Td>
                      <Td><span className="font-mono text-gray-500">{z.container_no || '—'}</span></Td>
                      <Td>{z.vessel_name || '—'}</Td>
                      <Td><span className="font-mono">{datum(z.eta)}</span></Td>
                      <Td><span className="font-mono">{datum(z.customs_date)}</span></Td>
                      <Td><Bar pct={z.tracking_progress || 0} /></Td>
                      <Td>{z.customs_date ? <Pill tone="ok">ingeklaard</Pill> : <Pill tone="watch">{z.tracking_status || z.status || 'onderweg'}</Pill>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Regel({ titel, sub, waarde }) {
  return (
    <div className="flex gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[#1B3A5C]">{titel}</p>
        <p className="text-[11.5px] text-gray-400">{sub}</p>
      </div>
      <p className="text-[13px] font-semibold font-mono text-[#1B3A5C]">{waarde}</p>
    </div>
  );
}
