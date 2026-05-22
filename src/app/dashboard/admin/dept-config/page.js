/* ============================================================
   BESTAND: page.js (admin dept-config)
   KOPIEER NAAR: src/app/dashboard/admin/dept-config/page.js
   VERSIE: v3.30 — bewerk- en verwijder-functie toegevoegd

   Beheer pagina voor:
   - Afdelingen (bum_groups)
   - Dept → Afdeling mapping (time-aware via valid_from/valid_until)
   - Dept merges (bv. 31 → 30)

   WIJZIGINGEN T.O.V. v26.06:
   - Bewerk-knop per actieve mapping → inline bewerken van afdeling en notitie
   - Verwijder-knop per actieve mapping → herstelt vorige situatie (heropen
     meest recente afgesloten rij voor zelfde dept)
   - Idem voor merges
   - Historische rijen blijven onaantastbaar

   Alleen voor admins.
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

function fmtDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  return parseInt(parts[2]) + ' ' + MN[parseInt(parts[1]) - 1] + ' ' + parts[0];
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Wijzigingen gaan altijd in op 1 januari van het huidige jaar.
// Management reporting voor afgesloten jaren ligt vast.
function jan1ThisYear() {
  return new Date().getFullYear() + '-01-01';
}

function dec31LastYear() {
  return (new Date().getFullYear() - 1) + '-12-31';
}

function currentYear() {
  return new Date().getFullYear();
}

export default function DeptConfigPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState('groups');
  const supabase = createClient();

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsAdmin(prof?.role === 'admin');
    }
    setAuthChecked(true);
  }

  if (!authChecked) return <LoadingLogo text="Verifiëren..." />;
  if (!isAdmin) {
    return (
      <div className="max-w-[800px] mx-auto py-12 text-center">
        <p className="text-[15px] text-[#6b5240]">Deze pagina is alleen toegankelijk voor admins.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>
      <div className="mb-5">
        <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: '22px', fontWeight: 900 }}>Afdelingen & Mappings</h1>
        <p className="text-[13px] text-[#6b5240]">Beheer afdelingen, dept-toewijzingen en dept-samenvoegingen</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-5 border-b border-[#e5ddd4]">
        {[
          { id: 'groups', label: 'Afdelingen' },
          { id: 'mappings', label: 'Dept → Afdeling' },
          { id: 'merges', label: 'Dept samenvoegingen' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[13px] font-semibold transition-all border-b-2 -mb-px ${
              tab === t.id
                ? 'text-[#E84E1B] border-[#E84E1B]'
                : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'groups' && <GroupsTab supabase={supabase} />}
      {tab === 'mappings' && <MappingsTab supabase={supabase} />}
      {tab === 'merges' && <MergesTab supabase={supabase} />}
    </div>
  );
}

// ============================================================
// TAB 1: Afdelingen (bum_groups)
// ============================================================
function GroupsTab({ supabase }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('bum_groups').select('*').order('sort_order');
    setGroups(data || []);
    setLoading(false);
  }

  async function saveDisplayName(code) {
    setSaving(true);
    const { error } = await supabase
      .from('bum_groups')
      .update({ display_name: editName, updated_at: new Date().toISOString() })
      .eq('code', code);
    setSaving(false);
    if (error) { alert('Fout: ' + error.message); return; }
    setEditingId(null);
    await load();
  }

  if (loading) return <LoadingLogo text="Laden..." />;

  return (
    <div>
      <p className="text-[12px] text-[#6b5240] mb-4 italic">
        Deze afdelingen worden in het hele dashboard gebruikt. De interne code (BUILDING_MATERIALS etc) ligt vast,
        maar de display-naam kun je hier aanpassen.
      </p>
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#faf7f4]">
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Code</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Display naam</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Volgorde</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Actief</th>
              <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.code}>
                <td className="p-3 text-[12px] border-b border-[#e5ddd4] font-mono text-[#6b5240]">{g.code}</td>
                <td className="p-3 text-[13px] border-b border-[#e5ddd4]">
                  {editingId === g.code ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="border border-[#e5ddd4] rounded px-2 py-1 text-[13px] w-full max-w-[300px]"
                      autoFocus
                    />
                  ) : (
                    <span className="font-semibold">{g.display_name}</span>
                  )}
                </td>
                <td className="p-3 text-[12px] border-b border-[#e5ddd4] text-[#6b5240]">{g.sort_order}</td>
                <td className="p-3 text-[12px] border-b border-[#e5ddd4]">
                  {g.active ? <span className="text-green-600">●</span> : <span className="text-red-600">●</span>}
                </td>
                <td className="p-3 border-b border-[#e5ddd4] text-right">
                  {editingId === g.code ? (
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditingId(null)} className="text-[11px] px-2 py-1 rounded bg-[#faf7f4] text-[#6b5240]">Annuleer</button>
                      <button onClick={() => saveDisplayName(g.code)} disabled={saving} className="text-[11px] px-2 py-1 rounded bg-[#1B3A5C] text-white">{saving ? '...' : 'Opslaan'}</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingId(g.code); setEditName(g.display_name); }} className="text-[11px] text-[#1B3A5C] hover:underline">Bewerk</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// TAB 2: Dept → Afdeling mapping
// ============================================================
function MappingsTab({ supabase }) {
  const [mappings, setMappings] = useState([]);
  const [groups, setGroups] = useState([]);
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  // Wijziging form
  const [changeDepts, setChangeDepts] = useState('');  // comma-separated dept codes
  const [changeToGroup, setChangeToGroup] = useState('');
  const [changeNote, setChangeNote] = useState('');
  // Wijzigingen gaan altijd in per 1 jan van het huidige jaar
  const changeFromDate = jan1ThisYear();
  const closeOldOn = dec31LastYear();
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState('');
  // Inline edit / delete state
  const [editingMapId, setEditingMapId] = useState(null);
  const [editGroup, setEditGroup] = useState('');
  const [editNote, setEditNote] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    // Mappings (actief = valid_until IS NULL of in toekomst)
    const { data: m } = await supabase
      .from('dept_bum_mapping')
      .select('*')
      .order('dept_code')
      .order('valid_from', { ascending: false });
    setMappings(m || []);

    // Groups voor dropdown
    const { data: g } = await supabase.from('bum_groups').select('*').eq('active', true).order('sort_order');
    setGroups(g || []);

    // Dept names — pak meest recente uit sales_data
    const { data: deptRows } = await supabase
      .from('sales_data')
      .select('dept_code, dept_name')
      .order('sale_date', { ascending: false })
      .limit(2000);
    const namesMap = {};
    (deptRows || []).forEach(r => {
      if (r.dept_code && r.dept_name && !namesMap[r.dept_code]) {
        namesMap[r.dept_code] = r.dept_name;
      }
    });
    setDeptNames(namesMap);

    setLoading(false);
  }

  async function submitChange() {
    // Validatie
    const deptList = changeDepts.split(',').map(d => d.trim()).filter(d => d.length > 0);
    if (!deptList.length) { alert('Voer minimaal één dept code in'); return; }
    if (!changeToGroup) { alert('Kies een afdeling'); return; }

    const groupLabel = groups.find(g => g.code === changeToGroup)?.display_name || changeToGroup;

    // Bevestiging
    const ok = confirm(
      `Wijziging doorvoeren?\n\n` +
      `Dept(s): ${deptList.join(', ')}\n` +
      `Naar afdeling: ${groupLabel}\n` +
      `Vanaf: 1 januari ${currentYear()}\n\n` +
      `Bestaande mapping wordt afgesloten op ${closeOldOn}.\n` +
      `Nieuwe mapping rij krijgt valid_from = ${changeFromDate}.`
    );
    if (!ok) return;

    setSaving(true);
    const errors = [];

    for (const dept of deptList) {
      // 1. Sluit huidige actieve mapping voor deze dept af (valid_until = 31 dec vorig jaar)
      const { error: e1 } = await supabase
        .from('dept_bum_mapping')
        .update({ valid_until: closeOldOn })
        .eq('dept_code', dept)
        .is('valid_until', null);
      if (e1) { errors.push(`Dept ${dept} afsluiten: ${e1.message}`); continue; }

      // 2. Insert nieuwe mapping vanaf 1 jan huidig jaar
      const { error: e2 } = await supabase
        .from('dept_bum_mapping')
        .insert({
          dept_code: dept,
          bum_group_code: changeToGroup,
          valid_from: changeFromDate,
          valid_until: null,
          note: changeNote || null,
        });
      if (e2) { errors.push(`Dept ${dept} insert: ${e2.message}`); }
    }

    setSaving(false);

    if (errors.length > 0) {
      alert('Sommige wijzigingen faalden:\n\n' + errors.join('\n'));
    } else {
      alert(`Wijziging doorgevoerd voor ${deptList.length} dept(s).`);
      setChangeDepts('');
      setChangeToGroup('');
      setChangeNote('');
    }
    await load();
  }

  // Start inline bewerken van een actieve mapping
  function startEdit(m) {
    setEditingMapId(m.id);
    setEditGroup(m.bum_group_code);
    setEditNote(m.note || '');
  }
  function cancelEdit() {
    setEditingMapId(null);
    setEditGroup('');
    setEditNote('');
  }
  async function saveEdit(m) {
    if (!editGroup) { alert('Kies een afdeling'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('dept_bum_mapping')
      .update({ bum_group_code: editGroup, note: editNote || null })
      .eq('id', m.id);
    setSaving(false);
    if (error) { alert('Fout bij opslaan: ' + error.message); return; }
    cancelEdit();
    await load();
  }

  // Verwijder een actieve mapping en heropen de meest recente afgesloten rij voor zelfde dept.
  // Resultaat: terug naar de situatie vóór deze wijziging.
  async function deleteMapping(m) {
    const groupLabel = groups.find(g => g.code === m.bum_group_code)?.display_name || m.bum_group_code;
    // Zoek meest recente afgesloten rij voor dezelfde dept (valid_until vlak voor m.valid_from)
    const previous = mappings
      .filter(x => x.dept_code === m.dept_code && x.id !== m.id && x.valid_until !== null)
      .sort((a, b) => (b.valid_until || '').localeCompare(a.valid_until || ''))[0];

    const previousLabel = previous
      ? (groups.find(g => g.code === previous.bum_group_code)?.display_name || previous.bum_group_code)
      : null;

    const msg = previous
      ? `Verwijder wijziging dept ${m.dept_code} naar ${groupLabel} per ${fmtDate(m.valid_from)}?\n\nDe vorige mapping (${previousLabel}) wordt heropend en loopt door tot heden.`
      : `Verwijder wijziging dept ${m.dept_code} naar ${groupLabel} per ${fmtDate(m.valid_from)}?\n\nLet op: er is geen vorige mapping om te heropenen. Deze dept heeft daarna géén mapping meer.`;
    if (!confirm(msg)) return;

    setDeletingId(m.id);
    // 1. DELETE de actieve rij
    const { error: e1 } = await supabase.from('dept_bum_mapping').delete().eq('id', m.id);
    if (e1) { alert('Fout bij verwijderen: ' + e1.message); setDeletingId(null); return; }
    // 2. Heropen vorige rij (valid_until = NULL)
    if (previous) {
      const { error: e2 } = await supabase
        .from('dept_bum_mapping')
        .update({ valid_until: null })
        .eq('id', previous.id);
      if (e2) { alert('Verwijderd maar vorige rij niet heropend: ' + e2.message); setDeletingId(null); await load(); return; }
    }
    setDeletingId(null);
    await load();
  }

  if (loading) return <LoadingLogo text="Laden..." />;

  // Splits in actieve (valid_until IS NULL) en historie
  const activeMappings = mappings.filter(m => m.valid_until === null);
  const historicalMappings = mappings.filter(m => m.valid_until !== null);

  // Filter
  const filtered = activeMappings.filter(m => {
    if (!filterText.trim()) return true;
    const f = filterText.toLowerCase();
    return m.dept_code.toLowerCase().includes(f)
      || (deptNames[m.dept_code] || '').toLowerCase().includes(f)
      || m.bum_group_code.toLowerCase().includes(f);
  });

  return (
    <div>
      {/* Wijziging form */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-5 mb-5">
        <h3 className="text-[15px] font-bold mb-3">Nieuwe wijziging doorvoeren</h3>
        <p className="text-[12px] text-[#6b5240] mb-4 italic">
          Verplaats één of meerdere depts naar een andere afdeling per een datum. De bestaande mapping wordt automatisch
          afgesloten op de dag vóór de ingangsdatum, zodat historische data correct blijft.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Dept code(s)</label>
            <input
              type="text"
              value={changeDepts}
              onChange={e => setChangeDepts(e.target.value)}
              placeholder="71, 75"
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
            <p className="text-[10px] text-[#a08a74] italic mt-1">Comma-separated voor meerdere</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Naar afdeling</label>
            <select
              value={changeToGroup}
              onChange={e => setChangeToGroup(e.target.value)}
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px] bg-white"
            >
              <option value="">— Kies —</option>
              {groups.map(g => <option key={g.code} value={g.code}>{g.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Ingangsdatum</label>
            <div className="border border-[#e5ddd4] bg-[#faf7f4] rounded-lg px-3 py-2 text-[13px] text-[#6b5240]">
              1 januari {currentYear()} <span className="text-[10px] italic ml-2">(automatisch — hele jaar)</span>
            </div>
            <p className="text-[10px] text-[#a08a74] italic mt-1">Wijzigingen gelden altijd voor het hele lopende jaar</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Notitie (optioneel)</label>
            <input
              type="text"
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="Bv. Q2 2026 herinrichting"
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
          </div>
        </div>

        <button
          onClick={submitChange}
          disabled={saving}
          className={`px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors ${
            saving ? 'bg-gray-400' : 'bg-[#E84E1B] hover:bg-[#c93f0f]'
          }`}
        >
          {saving ? 'Bezig...' : 'Wijziging doorvoeren'}
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center justify-between mb-3">
        <input
          type="text"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter op dept code, naam of afdeling..."
          className="border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px] flex-1 max-w-[400px]"
        />
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[12px] text-[#6b5240] hover:text-[#1B3A5C] bg-[#faf7f4] border border-[#e5ddd4] px-3 py-1.5 rounded-full font-medium ml-3"
        >
          {showHistory ? 'Verberg historie' : `Toon historie (${historicalMappings.length})`}
        </button>
      </div>

      {/* Actieve mappings */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
          <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Actieve mappings ({filtered.length})</p>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#faf7f4]">
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Dept</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Naam</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Afdeling</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Sinds</th>
              <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Notitie</th>
              <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4] w-[160px]">Acties</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const isEditing = editingMapId === m.id;
              const isDeleting = deletingId === m.id;
              return (
                <tr key={m.id} className="hover:bg-[#faf5f0]">
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-mono font-semibold">{m.dept_code}</td>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] text-[#6b5240]">{deptNames[m.dept_code] || '—'}</td>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4]">
                    {isEditing ? (
                      <select
                        value={editGroup}
                        onChange={e => setEditGroup(e.target.value)}
                        className="w-full border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"
                      >
                        {groups.map(g => <option key={g.code} value={g.code}>{g.display_name}</option>)}
                      </select>
                    ) : (
                      groups.find(g => g.code === m.bum_group_code)?.display_name || m.bum_group_code
                    )}
                  </td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-[#6b5240]">{fmtDate(m.valid_from)}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-[#6b5240] italic">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editNote}
                        onChange={e => setEditNote(e.target.value)}
                        placeholder="Notitie..."
                        className="w-full border border-[#e5ddd4] rounded px-2 py-1 text-[11px] not-italic"
                      />
                    ) : (
                      m.note || '—'
                    )}
                  </td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-right">
                    {isEditing ? (
                      <div className="flex gap-1 justify-end">
                        <button onClick={cancelEdit} className="px-2 py-1 rounded bg-[#faf7f4] text-[#6b5240] text-[11px]">Annuleer</button>
                        <button onClick={() => saveEdit(m)} disabled={saving} className="px-2 py-1 rounded bg-[#1B3A5C] text-white text-[11px]">{saving ? '...' : 'Opslaan'}</button>
                      </div>
                    ) : (
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => startEdit(m)}
                          className="text-[#1B3A5C] hover:underline text-[11px] font-medium"
                          title="Bewerk afdeling/notitie"
                        >Bewerk</button>
                        <button
                          onClick={() => deleteMapping(m)}
                          disabled={isDeleting}
                          className="text-[#dc2626] hover:underline text-[11px] font-medium"
                          title="Verwijder en herstel vorige situatie"
                        >{isDeleting ? '...' : 'Verwijder'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Historische mappings */}
      {showHistory && historicalMappings.length > 0 && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
          <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
            <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Historische mappings ({historicalMappings.length})</p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf7f4]">
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Dept</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Naam</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Afdeling</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Periode</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Notitie</th>
              </tr>
            </thead>
            <tbody>
              {historicalMappings.map(m => (
                <tr key={m.id} className="text-[#a08a74]">
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-mono">{m.dept_code}</td>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4]">{deptNames[m.dept_code] || '—'}</td>
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4]">{groups.find(g => g.code === m.bum_group_code)?.display_name || m.bum_group_code}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4]">{fmtDate(m.valid_from)} t/m {fmtDate(m.valid_until)}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] italic">{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB 3: Dept samenvoegingen (dept_merge_mapping)
// ============================================================
function MergesTab({ supabase }) {
  const [merges, setMerges] = useState([]);
  const [deptNames, setDeptNames] = useState({});
  const [loading, setLoading] = useState(true);
  // Nieuwe merge form
  const [origCodes, setOrigCodes] = useState('');  // comma-separated
  const [displayCode, setDisplayCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mergeNote, setMergeNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Merges gaan altijd in per 1 jan huidig jaar (management reporting ligt vast)
  const mergeFromDate = jan1ThisYear();
  const closeOldOn = dec31LastYear();
  // Edit / delete state
  const [editingMergeId, setEditingMergeId] = useState(null);
  const [editDisplayCode, setEditDisplayCode] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editMergeNote, setEditMergeNote] = useState('');
  const [deletingMergeId, setDeletingMergeId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: m } = await supabase
      .from('dept_merge_mapping')
      .select('*')
      .order('valid_from', { ascending: false });
    setMerges(m || []);

    const { data: deptRows } = await supabase
      .from('sales_data')
      .select('dept_code, dept_name')
      .order('sale_date', { ascending: false })
      .limit(2000);
    const namesMap = {};
    (deptRows || []).forEach(r => {
      if (r.dept_code && r.dept_name && !namesMap[r.dept_code]) {
        namesMap[r.dept_code] = r.dept_name;
      }
    });
    setDeptNames(namesMap);
    setLoading(false);
  }

  async function submitMerge() {
    const origList = origCodes.split(',').map(d => d.trim()).filter(d => d.length > 0);
    if (!origList.length) { alert('Voer minimaal één dept code in om te mergen'); return; }
    if (!displayCode.trim()) { alert('Kies een display-code (waar wordt naartoe gemerged)'); return; }
    if (origList.includes(displayCode.trim())) {
      alert('Kan dept niet naar zichzelf mergen. Bij merge 31,32 → 30 voer je in: orig codes = "31, 32", display code = "30".');
      return;
    }

    const ok = confirm(
      `Merge doorvoeren?\n\n` +
      `Dept(s) ${origList.join(', ')} worden vanaf 1 januari ${currentYear()} weergegeven als dept ${displayCode}.\n\n` +
      `Bestaande merge wordt afgesloten op ${closeOldOn}.\n` +
      `Onderliggende data blijft ongewijzigd; alleen de weergave verandert.`
    );
    if (!ok) return;

    setSaving(true);
    const errors = [];

    for (const orig of origList) {
      // Sluit eventuele bestaande actieve merge af (valid_until = 31 dec vorig jaar)
      const { error: e1 } = await supabase
        .from('dept_merge_mapping')
        .update({ valid_until: closeOldOn })
        .eq('original_code', orig)
        .is('valid_until', null);
      if (e1) { errors.push(`${orig} afsluiten: ${e1.message}`); continue; }

      const { error: e2 } = await supabase
        .from('dept_merge_mapping')
        .insert({
          original_code: orig,
          display_code: displayCode.trim(),
          display_name: displayName.trim() || null,
          valid_from: mergeFromDate,
          valid_until: null,
          note: mergeNote || null,
        });
      if (e2) errors.push(`${orig} insert: ${e2.message}`);
    }

    setSaving(false);

    if (errors.length > 0) {
      alert('Sommige merges faalden:\n\n' + errors.join('\n'));
    } else {
      alert(`Merge doorgevoerd voor ${origList.length} dept(s).`);
      setOrigCodes(''); setDisplayCode(''); setDisplayName(''); setMergeNote('');
    }
    await load();
  }

  function startEditMerge(m) {
    setEditingMergeId(m.id);
    setEditDisplayCode(m.display_code);
    setEditDisplayName(m.display_name || '');
    setEditMergeNote(m.note || '');
  }
  function cancelEditMerge() {
    setEditingMergeId(null);
  }
  async function saveEditMerge(m) {
    if (!editDisplayCode.trim()) { alert('Display code is verplicht'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('dept_merge_mapping')
      .update({
        display_code: editDisplayCode.trim(),
        display_name: editDisplayName.trim() || null,
        note: editMergeNote || null,
      })
      .eq('id', m.id);
    setSaving(false);
    if (error) { alert('Fout bij opslaan: ' + error.message); return; }
    cancelEditMerge();
    await load();
  }

  // Verwijder een actieve merge en heropen de meest recente afgesloten rij voor zelfde original_code.
  async function deleteMerge(m) {
    const previous = merges
      .filter(x => x.original_code === m.original_code && x.id !== m.id && x.valid_until !== null)
      .sort((a, b) => (b.valid_until || '').localeCompare(a.valid_until || ''))[0];

    const msg = previous
      ? `Verwijder samenvoeging dept ${m.original_code} → ${m.display_code} per ${fmtDate(m.valid_from)}?\n\nVorige samenvoeging (${m.original_code} → ${previous.display_code}) wordt heropend.`
      : `Verwijder samenvoeging dept ${m.original_code} → ${m.display_code} per ${fmtDate(m.valid_from)}?\n\nLet op: er is geen vorige merge. Dept ${m.original_code} wordt daarna niet meer samengevoegd.`;
    if (!confirm(msg)) return;

    setDeletingMergeId(m.id);
    const { error: e1 } = await supabase.from('dept_merge_mapping').delete().eq('id', m.id);
    if (e1) { alert('Fout bij verwijderen: ' + e1.message); setDeletingMergeId(null); return; }
    if (previous) {
      const { error: e2 } = await supabase
        .from('dept_merge_mapping')
        .update({ valid_until: null })
        .eq('id', previous.id);
      if (e2) { alert('Verwijderd maar vorige niet heropend: ' + e2.message); setDeletingMergeId(null); await load(); return; }
    }
    setDeletingMergeId(null);
    await load();
  }

  if (loading) return <LoadingLogo text="Laden..." />;

  const activeMerges = merges.filter(m => m.valid_until === null);
  const historicalMerges = merges.filter(m => m.valid_until !== null);

  return (
    <div>
      {/* Nieuwe merge form */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-5 mb-5">
        <h3 className="text-[15px] font-bold mb-3">Nieuwe samenvoeging</h3>
        <p className="text-[12px] text-[#6b5240] mb-4 italic">
          Voorbeeld: dept 31 en 32 samenvoegen met dept 30 — voer in: <strong>Originele dept(s) = "31, 32"</strong>, 
          <strong> Wordt weergegeven als = "30"</strong>. De onderliggende data blijft 31/32, alleen in dashboards verschijnt het als 30.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Originele dept code(s)</label>
            <input
              type="text"
              value={origCodes}
              onChange={e => setOrigCodes(e.target.value)}
              placeholder="31, 32"
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
            <p className="text-[10px] text-[#a08a74] italic mt-1">Dit zijn de depts die "opgeslokt" worden</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Wordt weergegeven als</label>
            <input
              type="text"
              value={displayCode}
              onChange={e => setDisplayCode(e.target.value)}
              placeholder="30"
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
            <p className="text-[10px] text-[#a08a74] italic mt-1">Doel-dept code</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Display naam (optioneel)</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Anders wordt automatisch dept naam gebruikt"
              className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Ingangsdatum</label>
            <div className="border border-[#e5ddd4] bg-[#faf7f4] rounded-lg px-3 py-2 text-[13px] text-[#6b5240]">
              1 januari {currentYear()} <span className="text-[10px] italic ml-2">(automatisch — hele jaar)</span>
            </div>
            <p className="text-[10px] text-[#a08a74] italic mt-1">Merges gelden altijd voor het hele lopende jaar</p>
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Notitie (optioneel)</label>
          <input
            type="text"
            value={mergeNote}
            onChange={e => setMergeNote(e.target.value)}
            placeholder="Bv. Categorieën samenvoegen Q2 2026"
            className="w-full border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
          />
        </div>

        <button
          onClick={submitMerge}
          disabled={saving}
          className={`px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors ${
            saving ? 'bg-gray-400' : 'bg-[#E84E1B] hover:bg-[#c93f0f]'
          }`}
        >
          {saving ? 'Bezig...' : 'Merge doorvoeren'}
        </button>
      </div>

      {/* Actieve merges */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-5">
        <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
          <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Actieve samenvoegingen ({activeMerges.length})</p>
        </div>
        {activeMerges.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-[#6b5240] italic">Nog geen actieve samenvoegingen</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf7f4]">
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Origineel</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Weergegeven als</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Display naam</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Sinds</th>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4]">Notitie</th>
                <th className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b border-[#e5ddd4] w-[160px]">Acties</th>
              </tr>
            </thead>
            <tbody>
              {activeMerges.map(m => {
                const isEditing = editingMergeId === m.id;
                const isDeleting = deletingMergeId === m.id;
                return (
                  <tr key={m.id}>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-mono font-semibold">{m.original_code} <span className="text-[10px] text-[#a08a74] font-normal">({deptNames[m.original_code] || '—'})</span></td>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-mono font-semibold">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDisplayCode}
                          onChange={e => setEditDisplayCode(e.target.value)}
                          className="w-20 border border-[#e5ddd4] rounded px-2 py-1 text-[12px] font-mono"
                        />
                      ) : (
                        <>→ {m.display_code} <span className="text-[10px] text-[#a08a74] font-normal">({deptNames[m.display_code] || '—'})</span></>
                      )}
                    </td>
                    <td className="p-2 text-[12px] border-b border-[#e5ddd4]">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDisplayName}
                          onChange={e => setEditDisplayName(e.target.value)}
                          placeholder="(auto)"
                          className="w-full border border-[#e5ddd4] rounded px-2 py-1 text-[12px]"
                        />
                      ) : (
                        m.display_name || <span className="italic text-[#a08a74]">auto</span>
                      )}
                    </td>
                    <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-[#6b5240]">{fmtDate(m.valid_from)}</td>
                    <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-[#6b5240] italic">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editMergeNote}
                          onChange={e => setEditMergeNote(e.target.value)}
                          placeholder="Notitie..."
                          className="w-full border border-[#e5ddd4] rounded px-2 py-1 text-[11px] not-italic"
                        />
                      ) : (
                        m.note || '—'
                      )}
                    </td>
                    <td className="p-2 text-[11px] border-b border-[#e5ddd4] text-right">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={cancelEditMerge} className="px-2 py-1 rounded bg-[#faf7f4] text-[#6b5240] text-[11px]">Annuleer</button>
                          <button onClick={() => saveEditMerge(m)} disabled={saving} className="px-2 py-1 rounded bg-[#1B3A5C] text-white text-[11px]">{saving ? '...' : 'Opslaan'}</button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => startEditMerge(m)}
                            className="text-[#1B3A5C] hover:underline text-[11px] font-medium"
                          >Bewerk</button>
                          <button
                            onClick={() => deleteMerge(m)}
                            disabled={isDeleting}
                            className="text-[#dc2626] hover:underline text-[11px] font-medium"
                          >{isDeleting ? '...' : 'Verwijder'}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Historische merges */}
      {historicalMerges.length > 0 && (
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden">
          <div className="p-3 bg-[#faf7f4] border-b border-[#e5ddd4]">
            <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide">Historische samenvoegingen ({historicalMerges.length})</p>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {historicalMerges.map(m => (
                <tr key={m.id} className="text-[#a08a74]">
                  <td className="p-2 text-[12px] border-b border-[#e5ddd4] font-mono">{m.original_code} → {m.display_code}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4]">{fmtDate(m.valid_from)} t/m {fmtDate(m.valid_until)}</td>
                  <td className="p-2 text-[11px] border-b border-[#e5ddd4] italic">{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
