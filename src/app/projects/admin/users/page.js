/* ============================================================
   BESTAND: page.js
   LOCATIE: src/app/projects/admin/users/page.js
   Beheer van toegang tot de projectomgeving (alleen admin).
   Bron: pm_v_portal_users, pm_projects, profiles
   Koppelen gaat via de functie pm_grant_project_access().
   ============================================================ */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { Card, Pill, Loading, Empty, Foutmelding, Th, Td, datum } from '@/components/projects/ui';

const ROLLEN = [
  'klant', 'leverancier', 'projectcoordinator', 'accountmanager',
  'inkoper', 'bum', 'directeur', 'verkoper', 'finance', 'viewer',
];

export default function ToegangPage() {
  const supabase = createClient();
  const [gebruikers, setGebruikers] = useState(null);
  const [projecten, setProjecten] = useState([]);
  const [error, setError] = useState('');
  const [melding, setMelding] = useState('');
  const [form, setForm] = useState({ profile_id: '', project_id: '', role: 'klant', is_spoc: false, can_edit: false });
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setError('');
    const [u, p] = await Promise.all([
      supabase.from('pm_v_portal_users').select('*').order('soort').order('email'),
      supabase.from('pm_projects').select('id, code, name').order('code'),
    ]);
    if (u.error) { setError(u.error.message); return; }
    setGebruikers(u.data || []);
    setProjecten(p.data || []);
  }, [supabase]);

  useEffect(() => { laad(); }, [laad]);

  async function koppel(e) {
    e.preventDefault();
    setBezig(true); setMelding(''); setError('');
    const { error: e1 } = await supabase.rpc('pm_grant_project_access', {
      p_profile_id: form.profile_id,
      p_project_id: form.project_id,
      p_role: form.role,
      p_is_spoc: form.is_spoc,
      p_can_edit: form.can_edit,
    });
    setBezig(false);
    if (e1) { setError(e1.message); return; }
    setMelding('Toegang toegekend.');
    setForm({ ...form, profile_id: '', project_id: '' });
    laad();
  }

  async function wisselApp(profileId, apps, app) {
    const nieuw = apps.includes(app) ? apps.filter(a => a !== app) : [...apps, app];
    if (nieuw.length === 0) { setError('Een gebruiker moet minstens één omgeving houden.'); return; }
    const { error: e } = await supabase.from('profiles').update({ apps: nieuw }).eq('id', profileId);
    if (e) { setError(e.message); return; }
    laad();
  }

  const intern = (gebruikers || []).filter(g => g.soort === 'internal');
  const extern = (gebruikers || []).filter(g => g.soort !== 'internal');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#1B3A5C]">Toegang</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Wie mag welke omgeving in, en aan welke projecten is iemand gekoppeld. Accounts zelf maak je aan bij Admin → Gebruikers.
        </p>
      </div>

      {error && <Foutmelding error={error} />}
      {melding && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] rounded-lg px-4 py-2.5">{melding}</div>}

      <Card title="Koppel een gebruiker aan een project" hint="zet meteen de juiste omgeving en rol">
        <form onSubmit={koppel} className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <div>
            <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Gebruiker</label>
            <select required value={form.profile_id} onChange={e => setForm({ ...form, profile_id: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] bg-white">
              <option value="">— kies —</option>
              {(gebruikers || []).map(g => (
                <option key={g.profile_id} value={g.profile_id}>{g.full_name || g.email} ({g.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Project</label>
            <select required value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] bg-white">
              <option value="">— kies —</option>
              {projecten.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Rol</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] bg-white">
              {ROLLEN.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-[12.5px] text-gray-600">
              <input type="checkbox" checked={form.is_spoc} onChange={e => setForm({ ...form, is_spoc: e.target.checked })} /> SPOC
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-gray-600">
              <input type="checkbox" checked={form.can_edit} onChange={e => setForm({ ...form, can_edit: e.target.checked })} /> Mag wijzigen
            </label>
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={bezig}
              className="w-full px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold disabled:opacity-50">
              {bezig ? 'Bezig...' : 'Toegang geven'}
            </button>
          </div>
        </form>
      </Card>

      {!gebruikers && <Loading />}

      {gebruikers && (
        <>
          <Tabel titel="Externe gebruikers" hint="klanten en leveranciers · zien alleen hun eigen projecten"
            rijen={extern} wisselApp={wisselApp} leeg="Nog geen externe gebruikers gekoppeld." />
          <Tabel titel="Interne gebruikers" hint="vink 'projects' aan om iemand toegang te geven tot de projectomgeving"
            rijen={intern} wisselApp={wisselApp} leeg="Geen interne gebruikers gevonden." />
        </>
      )}
    </div>
  );
}

function Tabel({ titel, hint, rijen, wisselApp, leeg }) {
  return (
    <Card title={titel} hint={hint}>
      {rijen.length === 0 && <Empty titel={leeg} />}
      {rijen.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 980 }}>
            <thead>
              <tr><Th>Naam</Th><Th>E-mail</Th><Th>Soort</Th><Th>Dashboarding</Th><Th>Projecten</Th><Th>Gekoppeld aan</Th><Th>Laatste login</Th></tr>
            </thead>
            <tbody>
              {rijen.map(g => {
                const apps = g.apps || [];
                return (
                  <tr key={g.profile_id} className="hover:bg-gray-50">
                    <Td>
                      <span className="font-semibold text-[#1B3A5C]">{g.full_name || '—'}</span>
                      {g.is_active === false && <span className="ml-2"><Pill tone="crit">inactief</Pill></span>}
                    </Td>
                    <Td><span className="font-mono text-gray-500">{g.email}</span></Td>
                    <Td>{g.soort === 'internal' ? <Pill>intern</Pill> : <Pill tone="watch">{g.soort === 'customer' ? 'klant' : 'leverancier'}</Pill>}</Td>
                    <Td>
                      <input type="checkbox" checked={apps.includes('dashboard')}
                        onChange={() => wisselApp(g.profile_id, apps, 'dashboard')} />
                    </Td>
                    <Td>
                      <input type="checkbox" checked={apps.includes('projects')}
                        onChange={() => wisselApp(g.profile_id, apps, 'projects')} />
                    </Td>
                    <Td wrap><span className="text-gray-500">{g.projecten || '—'}</span></Td>
                    <Td><span className="font-mono text-gray-400">{g.last_login ? datum(g.last_login) : '—'}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
