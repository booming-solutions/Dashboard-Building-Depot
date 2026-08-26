/* ============================================================
   BESTAND: page.js
   LOCATIE: src/app/projects/page.js
   Projectenoverzicht met KPI's en eilandtoggle.
   Bron: pm_projects + pm_v_project_status + crm_accounts
   ============================================================ */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';
import { Kpi, Card, Pill, Bar, Loading, Empty, Foutmelding, Th, Td, fmt } from '@/components/projects/ui';

const MODEL_LABEL = { bdt_levering: 'via BDT', commissie: 'commissie', mix: 'mix' };

export default function ProjectenPage() {
  const supabase = createClient();
  const [eiland, setEiland] = useState('CUR');
  const [rijen, setRijen] = useState(null);
  const [error, setError] = useState('');

  const laad = useCallback(async () => {
    setRijen(null);
    setError('');

    const { data: projecten, error: e1 } = await supabase
      .from('pm_projects')
      .select('id, code, name, island, status, delivery_model, units_planned, start_date, target_completion_date, currency, account_id, crm_accounts(name)')
      .eq('island', eiland)
      .order('code');

    if (e1) { setError(e1.message); return; }

    const { data: statussen, error: e2 } = await supabase
      .from('pm_v_project_status')
      .select('project_id, milestones_total, milestones_done, items_total, items_te_laat, items_kritiek, inputs_open, inputs_te_laat, commissie_te_factureren');

    if (e2) { setError(e2.message); return; }

    const perId = {};
    (statussen || []).forEach(s => { perId[s.project_id] = s; });

    setRijen((projecten || []).map(p => {
      const s = perId[p.id] || {};
      const totaal = Number(s.milestones_total || 0);
      const gereed = Number(s.milestones_done || 0);
      return {
        ...p,
        klant: p.crm_accounts ? p.crm_accounts.name : '—',
        telaat: Number(s.items_te_laat || 0),
        kritiek: Number(s.items_kritiek || 0),
        inputsTeLaat: Number(s.inputs_te_laat || 0),
        commissie: Number(s.commissie_te_factureren || 0),
        voortgang: totaal > 0 ? Math.round(gereed / totaal * 100) : 0,
      };
    }));
  }, [supabase, eiland]);

  useEffect(() => { laad(); }, [laad]);

  const actief = (rijen || []).filter(r => r.status === 'actief').length;
  const woningen = (rijen || []).reduce((a, r) => a + Number(r.units_planned || 0), 0);
  const telaat = (rijen || []).reduce((a, r) => a + r.telaat, 0);
  const kritiek = (rijen || []).reduce((a, r) => a + r.kritiek, 0);
  const commissie = (rijen || []).reduce((a, r) => a + r.commissie, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C]">Projecten</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Alle lopende ontwikkelingen op {eiland === 'CUR' ? 'Curaçao' : 'Bonaire'}.
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white">
          {[['CUR', 'Curaçao'], ['BON', 'Bonaire']].map(([k, l]) => (
            <button key={k} onClick={() => setEiland(k)}
              className={'px-3 py-1.5 text-[12.5px] font-medium ' + (eiland === k ? 'bg-[#1B3A5C] text-white font-semibold' : 'text-gray-500 hover:text-[#1B3A5C]')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {error && <Foutmelding error={error} />}

      {!error && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Kpi label="Actieve projecten" value={rijen ? actief : '—'} sub={rijen ? rijen.length + ' totaal' : ''} />
          <Kpi label="Woningen" value={rijen ? fmt(woningen) : '—'} sub="in portefeuille" />
          <Kpi label="Bestelregels te laat" value={rijen ? telaat : '—'} sub="besteldatum verstreken" tone="crit" />
          <Kpi label="Kritiek · binnen 7 dagen" value={rijen ? kritiek : '—'} sub="moet nu besteld worden" tone="warn" />
          <Kpi label="Commissie te factureren" value={rijen ? fmt(commissie) : '—'} sub="USD · na douanevrijgave" tone="navy" />
        </div>
      )}

      {!error && (
        <Card title="Overzicht" hint="klik op een regel voor het projectdossier">
          {!rijen && <Loading />}
          {rijen && rijen.length === 0 && (
            <Empty titel={'Nog geen projecten op ' + (eiland === 'CUR' ? 'Curaçao' : 'Bonaire')}
              hint="Voeg een project toe in Supabase (tabel pm_projects) of via het intakescherm zodra dat er staat." />
          )}
          {rijen && rijen.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <Th>Project</Th><Th>Klant</Th><Th>Model</Th><Th right>Woningen</Th>
                    <Th>Status</Th><Th>Voortgang</Th><Th>Inkooprisico</Th><Th right>Commissie open</Th>
                  </tr>
                </thead>
                <tbody>
                  {rijen.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <Td>
                        <Link href={'/projects/' + encodeURIComponent(r.code)} className="font-semibold text-[#1B3A5C] hover:underline">{r.name}</Link>
                        <div className="text-[11px] text-gray-400 font-mono">{r.code}</div>
                      </Td>
                      <Td>{r.klant}</Td>
                      <Td><Pill>{MODEL_LABEL[r.delivery_model] || r.delivery_model}</Pill></Td>
                      <Td right><span className="font-mono">{fmt(r.units_planned)}</span></Td>
                      <Td>{r.status === 'actief' ? <Pill tone="ok">actief</Pill> : <Pill>{r.status}</Pill>}</Td>
                      <Td>
                        <Bar pct={r.voortgang} />
                        <span className="text-[11px] text-gray-400 font-mono">{r.voortgang}%</span>
                      </Td>
                      <Td>
                        <span className="flex gap-1.5">
                          {r.telaat > 0 && <Pill tone="crit">{r.telaat} te laat</Pill>}
                          {r.kritiek > 0 && <Pill tone="warn">{r.kritiek} kritiek</Pill>}
                          {r.telaat === 0 && r.kritiek === 0 && <Pill tone="ok">op koers</Pill>}
                        </span>
                      </Td>
                      <Td right><span className="font-mono">{r.commissie ? fmt(r.commissie) : '—'}</span></Td>
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
