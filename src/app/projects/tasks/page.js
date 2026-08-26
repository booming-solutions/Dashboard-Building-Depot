/* ============================================================
   BESTAND: page.js
   LOCATIE: src/app/projects/tasks/page.js
   Werkvoorraad per rol. Bron: pm_tasks + pm_projects.
   Een taak afronden zet status op 'gereed' (RLS: intern).
   ============================================================ */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';
import { Card, Pill, Dot, Loading, Empty, Foutmelding, Th, Td, datum, dagenTot, dagTekst } from '@/components/projects/ui';

const ROLLEN = [
  ['alle', 'Alle rollen'],
  ['projectcoordinator', 'Projectcoördinator'],
  ['accountmanager', 'Accountmanager'],
  ['inkoper', 'Inkoper'],
  ['bum', 'Business unit manager'],
  ['directeur', 'Directeur'],
  ['finance', 'Finance'],
];

export default function TakenPage() {
  const supabase = createClient();
  const [taken, setTaken] = useState(null);
  const [rol, setRol] = useState('alle');
  const [toonGereed, setToonGereed] = useState(false);
  const [error, setError] = useState('');
  const [bezig, setBezig] = useState(null);

  const laad = useCallback(async () => {
    setError('');
    let q = supabase
      .from('pm_tasks')
      .select('*, pm_projects(code, name)')
      .order('due_date', { ascending: true });

    if (!toonGereed) q = q.in('status', ['open', 'in_behandeling']);
    const { data, error: e } = await q;
    if (e) { setError(e.message); return; }
    setTaken(data || []);
  }, [supabase, toonGereed]);

  useEffect(() => { laad(); }, [laad]);

  async function afronden(id) {
    setBezig(id);
    const { error: e } = await supabase
      .from('pm_tasks')
      .update({ status: 'gereed', completed_at: new Date().toISOString() })
      .eq('id', id);
    setBezig(null);
    if (e) { setError(e.message); return; }
    laad();
  }

  const zichtbaar = (taken || []).filter(t => rol === 'alle' || t.assigned_role === rol);
  const openHoog = (taken || []).filter(t => t.priority === 'hoog' && t.status !== 'gereed').length;

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C]">Taken</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Werkvoorraad per rol. Wat de tool zelf klaarzet, staat gemarkeerd als automatisch.
          </p>
        </div>
        <div className="flex-1" />
        <select value={rol} onChange={e => setRol(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-[13px] text-[#1B3A5C]">
          {ROLLEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-gray-600">
          <input type="checkbox" checked={toonGereed} onChange={e => setToonGereed(e.target.checked)} />
          Toon afgeronde
        </label>
      </div>

      {error && <Foutmelding error={error} />}

      {!error && (
        <Card title="Taken" hint={taken ? zichtbaar.length + ' zichtbaar · ' + openHoog + ' met hoge prioriteit' : ''}>
          {!taken && <Loading />}
          {taken && zichtbaar.length === 0 && (
            <Empty titel="Geen openstaande taken"
              hint="Zodra een zending door de douane komt of een besteldatum nadert, zet de tool hier automatisch een taak neer." />
          )}
          {taken && zichtbaar.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 1000 }}>
                <thead>
                  <tr><Th></Th><Th>Taak</Th><Th>Rol</Th><Th>Project</Th><Th>Deadline</Th><Th>Prioriteit</Th><Th>Herkomst</Th><Th></Th></tr>
                </thead>
                <tbody>
                  {zichtbaar.map(t => {
                    const d = dagenTot(t.due_date);
                    const teLaat = t.status !== 'gereed' && d !== null && d < 0;
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <Td><Dot tone={teLaat ? 'crit' : (t.priority === 'hoog' ? 'warn' : 'watch')} /></Td>
                        <Td wrap>
                          <span className="font-semibold text-[#1B3A5C]">{t.title}</span>
                          {t.description && <div className="text-[11.5px] text-gray-400">{t.description}</div>}
                        </Td>
                        <Td>{t.assigned_role || '—'}</Td>
                        <Td>
                          {t.pm_projects
                            ? <Link href={'/projects/' + encodeURIComponent(t.pm_projects.code)} className="font-mono text-[#1B3A5C] hover:underline">{t.pm_projects.code}</Link>
                            : '—'}
                        </Td>
                        <Td>
                          {teLaat
                            ? <Pill tone="crit">te laat</Pill>
                            : <span className="font-mono">{datum(t.due_date)}</span>}
                          {!teLaat && d !== null && <div className="text-[11px] text-gray-400 font-mono">{dagTekst(d)}</div>}
                        </Td>
                        <Td>{t.priority === 'hoog' ? <Pill tone="warn">hoog</Pill> : <Pill>{t.priority}</Pill>}</Td>
                        <Td>{t.source === 'automatisch' ? <Pill tone="watch">automatisch</Pill> : <Pill>handmatig</Pill>}</Td>
                        <Td right>
                          {t.status === 'gereed'
                            ? <Pill tone="ok">gereed</Pill>
                            : (
                              <button onClick={() => afronden(t.id)} disabled={bezig === t.id}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12.5px] font-medium text-[#1B3A5C] hover:border-[#1B3A5C] disabled:opacity-50">
                                {bezig === t.id ? '...' : 'Afronden'}
                              </button>
                            )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
