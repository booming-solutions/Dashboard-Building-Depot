/* ============================================================
   BESTAND: page_negative_inventory_v4.js
   KOPIEER NAAR: src/app/dashboard/inventory/negative/page.js
   VERSIE: v3.28.01
   
   Wijzigingen t.o.v. v3:
   - Layout matcht Voorraad vs Budget (kop, filterbalk, tabs, chips)
   - BUM filter toegevoegd
   - Inline invoerveld + opslaan-knop per rij (detail tab)
   - Historie-knop per rij opent modal
   - Kolom "Eerste keer negatief" (first_seen_date)
   - Sorteerbare kolommen (klik op header)
   ============================================================ */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

const supabase = createClient();

/* ── Formatters ── */
const fmt = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtMoney = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtMoneyShort = (n) => {
  const num = parseFloat(n) || 0;
  const abs = Math.abs(num);
  if (abs >= 1e6) return (num / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (abs >= 1e3) return Math.round(num / 1e3) + 'K';
  return Math.round(num).toString();
};
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateShort = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};
const daysSince = (d) => {
  if (!d) return null;
  const ms = new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000);
};
const regionOf = (storeNumber) => {
  const s = String(storeNumber || '').trim().toUpperCase();
  if (s === 'A' || s === 'B') return 'Bonaire';
  return 'Curacao';
};

/* ── Brand colors (matchen Voorraad vs Budget) ── */
const C = {
  ink: '#1B3A5C',         // donkerblauw
  accent: '#E84E1B',      // oranje
  text: '#333',
  muted: '#789',
  bg: '#f5f7fb',
  card: '#ffffff',
  border: '#dce6f1',
  panelHead: '#1B3A5C',
  red: '#c04040',
  green: '#16a34a',
  amber: '#d97706',
};

export default function NegativeInventoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');

  const [tab, setTab] = useState('overzicht');

  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [firstSeen, setFirstSeen] = useState({}); // { item_number: { first_seen_date, last_seen_date } }

  // Filters (global, apply to both tabs where relevant)
  const [store, setStore] = useState('Totaal');       // 'Totaal' | 'Curaçao' | 'Bonaire'
  const [bum, setBum] = useState('Alle');
  const [dept, setDept] = useState('Totaal');         // dept_code or 'Totaal'

  // Detail-tab extras
  const [search, setSearch] = useState('');
  const [hideResolved, setHideResolved] = useState(false);
  const [sortCol, setSortCol] = useState('cost');
  const [sortDir, setSortDir] = useState('asc');      // asc = meest negatief eerst

  // Inline note editing
  const [inlineNote, setInlineNote] = useState({});   // { id: 'text' }
  const [inlineStatus, setInlineStatus] = useState({}); // { id: 'in_onderzoek' | 'opgelost' }
  const [savingRow, setSavingRow] = useState(null);

  // History modal
  const [historyItem, setHistoryItem] = useState(null);

  /* ── Load ── */
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      setUserEmail(session.user.email || '');

      const { data: prof } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      setProfile(prof);
      setUserName(prof?.full_name || prof?.name || session.user.email);

      const isAdmin = prof?.role === 'admin';
      const allowed = prof?.allowed_reports || [];
      if (!isAdmin && !allowed.includes('inventory_negative')) {
        router.push('/dashboard'); return;
      }

      await loadAll();
      setLoading(false);
    })();
  }, []);

  async function loadAll() {
    await Promise.all([loadItems(), loadNotes(), loadSnapshots(), loadFirstSeen()]);
  }

  async function loadItems() {
    let all = [];
    let from = 0;
    const step = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('negative_inventory').select('*').lt('qoh', 0)
        .range(from, from + step - 1);
      if (error) { console.error(error); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step) break;
      from += step;
    }
    setItems(all);
  }

  async function loadNotes() {
    let all = [];
    let from = 0;
    const step = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('negative_inventory_notes').select('*')
        .order('created_at', { ascending: false }).range(from, from + step - 1);
      if (error) { console.error(error); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step) break;
      from += step;
    }
    setNotes(all);
  }

  async function loadSnapshots() {
    let all = [];
    let from = 0;
    const step = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('negative_inventory_snapshots').select('*')
        .order('snapshot_date', { ascending: true }).range(from, from + step - 1);
      if (error) { console.error(error); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step) break;
      from += step;
    }
    setSnapshots(all);
  }

  async function loadFirstSeen() {
    let all = [];
    let from = 0;
    const step = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('negative_inventory_first_seen').select('*')
        .range(from, from + step - 1);
      if (error) { console.error(error); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step) break;
      from += step;
    }
    const map = {};
    all.forEach(r => { map[r.item_number] = r; });
    setFirstSeen(map);
  }

  /* ── Helpers ── */
  const notesByKey = useMemo(() => {
    const m = {};
    notes.forEach((n) => {
      const k = n.store_number + '|' + n.item_number;
      if (!m[k]) m[k] = [];
      m[k].push(n);
    });
    Object.keys(m).forEach((k) => {
      m[k].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    });
    return m;
  }, [notes]);

  const latestStatusFor = (storeNumber, itemNumber) => {
    const arr = notesByKey[storeNumber + '|' + itemNumber] || [];
    return arr[0]?.status || null;
  };

  /* ── Apply global filters ── */
  function applyGlobalFilters(arr) {
    let r = arr.slice();
    if (store === 'Curaçao') r = r.filter(it => regionOf(it.store_number) === 'Curacao');
    else if (store === 'Bonaire') r = r.filter(it => regionOf(it.store_number) === 'Bonaire');
    if (bum !== 'Alle') r = r.filter(it => (it.bum || '').toUpperCase() === bum.toUpperCase());
    if (dept !== 'Totaal') r = r.filter(it => it.dept_code === dept);
    return r;
  }

  const filteredItems = useMemo(() => applyGlobalFilters(items), [items, store, bum, dept]);

  /* ── Filter options ── */
  const bumOptions = useMemo(() => {
    const set = new Set();
    items.forEach(it => { if (it.bum) set.add(it.bum.toUpperCase()); });
    return ['Alle', ...Array.from(set).sort()];
  }, [items]);

  const deptOptions = useMemo(() => {
    const map = {};
    items.forEach(it => { map[it.dept_code] = it.dept_name || it.dept_code; });
    const arr = Object.entries(map).map(([code, name]) => ({ code, name }))
      .sort((a, b) => {
        if (a.code === 'OTHER') return 1;
        if (b.code === 'OTHER') return -1;
        return a.code.localeCompare(b.code);
      });
    return [{ code: 'Totaal', name: 'Totaal alle departementen' }, ...arr];
  }, [items]);

  /* ── Overzicht trend data ── */
  const trendData = useMemo(() => {
    const byDate = {};
    snapshots.forEach((s) => {
      if (store === 'Curaçao' && s.region !== 'Curacao') return;
      if (store === 'Bonaire' && s.region !== 'Bonaire') return;
      // Dept filter
      if (dept !== 'Totaal' && s.department_code !== dept) return;
      const d = s.snapshot_date;
      if (!byDate[d]) byDate[d] = { date: d, items: 0, value: 0 };
      byDate[d].items += s.items_count || 0;
      byDate[d].value += parseFloat(s.total_negative_value) || 0;
    });
    return Object.values(byDate)
      .map((d) => ({ ...d, value: Math.round(d.value) }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [snapshots, store, dept]);

  const latestSnapshotDate = useMemo(() => {
    if (!snapshots.length) return null;
    return snapshots.reduce((max, s) => (s.snapshot_date > max ? s.snapshot_date : max), snapshots[0].snapshot_date);
  }, [snapshots]);

  const deptBreakdown = useMemo(() => {
    const latest = snapshots.filter((s) => s.snapshot_date === latestSnapshotDate);
    const filtered = latest.filter((s) => {
      if (store === 'Curaçao') return s.region === 'Curacao';
      if (store === 'Bonaire') return s.region === 'Bonaire';
      return true;
    });
    const agg = {};
    filtered.forEach((s) => {
      const k = s.department_code;
      if (!agg[k]) agg[k] = { dept_code: s.department_code, dept_name: s.department_name, items: 0, value: 0 };
      agg[k].items += s.items_count || 0;
      agg[k].value += parseFloat(s.total_negative_value) || 0;
    });
    let arr = Object.values(agg).sort((a, b) => a.value - b.value);
    // If dept filter actief, toon alleen die rij (of leeg)
    if (dept !== 'Totaal') arr = arr.filter(d => d.dept_code === dept);
    return arr;
  }, [snapshots, latestSnapshotDate, store, dept]);

  const totals = useMemo(() => {
    const t = { items: 0, value: 0, depts: deptBreakdown.length };
    deptBreakdown.forEach((d) => { t.items += d.items; t.value += d.value; });
    return t;
  }, [deptBreakdown]);

  /* ── Detail items with sorting + search ── */
  const detailItems = useMemo(() => {
    let arr = filteredItems.slice();

    if (hideResolved) {
      arr = arr.filter((it) => latestStatusFor(it.store_number, it.item_number) !== 'opgelost');
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      arr = arr.filter((it) =>
        (it.item_number || '').toLowerCase().includes(s) ||
        (it.item_description || '').toLowerCase().includes(s) ||
        (it.dept_name || '').toLowerCase().includes(s)
      );
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let va, vb;
      switch (sortCol) {
        case 'store':       va = a.store_number; vb = b.store_number; break;
        case 'dept':        va = a.dept_code; vb = b.dept_code; break;
        case 'bum':         va = a.bum || ''; vb = b.bum || ''; break;
        case 'item':        va = a.item_number; vb = b.item_number; break;
        case 'desc':        va = a.item_description || ''; vb = b.item_description || ''; break;
        case 'qoh':         va = a.qoh || 0; vb = b.qoh || 0; break;
        case 'cost':        va = a.cost || 0; vb = b.cost || 0; break;
        case 'firstSeen': {
          const fa = firstSeen[a.item_number]?.first_seen_date || '9999-12-31';
          const fb = firstSeen[b.item_number]?.first_seen_date || '9999-12-31';
          va = fa; vb = fb; break;
        }
        case 'status': {
          va = latestStatusFor(a.store_number, a.item_number) || 'zzz';
          vb = latestStatusFor(b.store_number, b.item_number) || 'zzz';
          break;
        }
        default: va = a.cost || 0; vb = b.cost || 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [filteredItems, search, hideResolved, sortCol, sortDir, notesByKey, firstSeen]);

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  /* ── Save inline note ── */
  async function handleSaveInline(it) {
    const txt = (inlineNote[it.id] || '').trim();
    if (!txt) return;
    const status = inlineStatus[it.id] || 'in_onderzoek';
    setSavingRow(it.id);
    const row = {
      store_number: it.store_number,
      item_number: it.item_number,
      item_description: it.item_description,
      department_code: it.dept_code,
      department_name: it.dept_name,
      note: txt,
      status,
      created_by_email: userEmail,
      created_by_name: userName,
    };
    const { error } = await supabase.from('negative_inventory_notes').insert(row);
    if (error) alert('Opslaan mislukt: ' + error.message);
    else {
      setInlineNote({ ...inlineNote, [it.id]: '' });
      await loadNotes();
    }
    setSavingRow(null);
  }

  /* ── UI ── */
  if (loading) {
    return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Laden...</div>;
  }

  const regionLabel = store === 'Totaal' ? 'Curaçao + Bonaire' : store;

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'system-ui, sans-serif', maxWidth: 1400, margin: '0 auto', background: C.bg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: C.ink, fontFamily: '"Bookman Old Style", Georgia, serif', fontWeight: 700 }}>
            Negatieve Voorraad
          </h1>
          <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 13 }}>
            Building Depot — {regionLabel} — data t/m {latestSnapshotDate ? fmtDate(latestSnapshotDate) : '—'}
          </p>
        </div>
        <div style={{
          border: `1.5px solid ${C.accent}`, color: C.accent, padding: '6px 14px',
          borderRadius: 20, fontWeight: 600, fontSize: 13, background: 'white'
        }}>
          {regionLabel} · XCG
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: C.card, borderRadius: 12, padding: '16px 20px', marginBottom: 16, border: `1px solid ${C.border}` }}>
        <FilterRow label="STORE">
          {['Totaal', 'Curaçao', 'Bonaire'].map(o => (
            <Chip key={o} active={store === o} onClick={() => setStore(o)}>{o}</Chip>
          ))}
        </FilterRow>
        <FilterRow label="MANAGER">
          {bumOptions.map(o => (
            <Chip key={o} active={bum === o} onClick={() => setBum(o)}>{o}</Chip>
          ))}
        </FilterRow>
        <FilterRow label="AFDELING" last>
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            style={{
              padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
              fontSize: 13, background: 'white', minWidth: 260,
            }}
          >
            {deptOptions.map(d => (
              <option key={d.code} value={d.code}>
                {d.code === 'Totaal' ? d.name : `${d.code} — ${d.name}`}
              </option>
            ))}
          </select>
        </FilterRow>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
        <TabButton active={tab === 'overzicht'} onClick={() => setTab('overzicht')}>Overzicht</TabButton>
        <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>Detail</TabButton>
      </div>

      {tab === 'overzicht' && (
        <OverzichtTab
          trendData={trendData}
          deptBreakdown={deptBreakdown}
          totals={totals}
        />
      )}

      {tab === 'detail' && (
        <DetailTab
          items={detailItems}
          totalCount={filteredItems.length}
          search={search} setSearch={setSearch}
          hideResolved={hideResolved} setHideResolved={setHideResolved}
          sortCol={sortCol} sortDir={sortDir} handleSort={handleSort}
          inlineNote={inlineNote} setInlineNote={setInlineNote}
          inlineStatus={inlineStatus} setInlineStatus={setInlineStatus}
          handleSaveInline={handleSaveInline} savingRow={savingRow}
          latestStatusFor={latestStatusFor}
          notesByKey={notesByKey}
          firstSeen={firstSeen}
          openHistory={setHistoryItem}
        />
      )}

      {historyItem && (
        <HistoryModal
          item={historyItem}
          notes={notesByKey[historyItem.store_number + '|' + historyItem.item_number] || []}
          firstSeen={firstSeen[historyItem.item_number]}
          onClose={() => setHistoryItem(null)}
        />
      )}
    </div>
  );
}

/* ── Small components ── */

function FilterRow({ label, children, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      marginBottom: last ? 0 : 10,
    }}>
      <div style={{
        width: 90, fontSize: 11, color: C.muted, fontWeight: 700,
        letterSpacing: 0.5, flexShrink: 0,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accent : 'white',
        color: active ? 'white' : C.ink,
        cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: '10px 4px',
        marginRight: 24, fontSize: 14, fontWeight: 600,
        color: active ? C.accent : C.muted,
        borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
        marginBottom: -1, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/* ── KPI cards ── */
function KpiCard({ label, value, sub, color = C.ink, borderTop }) {
  return (
    <div style={{
      background: C.card, padding: 18, borderRadius: 10,
      border: `1px solid ${C.border}`,
      borderTop: borderTop ? `3px solid ${C.accent}` : `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 8, fontFamily: '"Bookman Old Style", Georgia, serif' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ── OVERZICHT TAB ── */
function OverzichtTab({ trendData, deptBreakdown, totals }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Aantal items" value={fmt(totals.items)} borderTop />
        <KpiCard label="Waarde negatief" value={fmtMoneyShort(totals.value)} sub={fmtMoney(totals.value)} color={C.red} borderTop />
        <KpiCard label="Departementen" value={fmt(totals.depts)} borderTop />
      </div>

      <Panel title="Verloop in de tijd">
        <TrendChart data={trendData} />
      </Panel>

      <Panel title="Per departement">
        {deptBreakdown.length === 0 ? (
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Geen negatieve voorraad.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={panelHeadRow}>
                  <th style={{ ...panelTh, width: 70 }}>DEP</th>
                  <th style={panelTh}>DEPARTEMENT</th>
                  <th style={{ ...panelTh, textAlign: 'right', width: 120 }}>AANTAL ITEMS</th>
                  <th style={{ ...panelTh, textAlign: 'right', width: 160 }}>WAARDE (XCG)</th>
                </tr>
              </thead>
              <tbody>
                {deptBreakdown.map((d) => (
                  <tr key={d.dept_code} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={td}>{d.dept_code}</td>
                    <td style={td}>{d.dept_name}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(d.items)}</td>
                    <td style={{ ...td, textAlign: 'right', color: C.red, fontWeight: 600 }}>{fmtMoney(d.value)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.ink}`, background: '#f9fbfd', fontWeight: 700 }}>
                  <td style={td} colSpan={2}>Totaal</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(totals.items)}</td>
                  <td style={{ ...td, textAlign: 'right', color: C.red }}>{fmtMoney(totals.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/* ── Panel wrapper with dark-blue header strip ── */
function Panel({ title, children, headerRight }) {
  return (
    <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{
        background: C.panelHead, color: 'white',
        padding: '10px 16px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        textTransform: 'uppercase',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{title}</span>
        {headerRight}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

/* ── Inline SVG line chart ── */
function TrendChart({ data }) {
  const W = 800; const H = 280;
  const padL = 60; const padR = 60; const padT = 20; const padB = 40;

  if (data.length === 0) {
    return <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>Nog geen snapshots beschikbaar.</p>;
  }
  if (data.length === 1) {
    const d = data[0];
    return (
      <div style={{ padding: 18, background: '#f5f9fd', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: C.muted }}>Eerste snapshot: {fmtDate(d.date)}</div>
        <div style={{ fontSize: 14, color: C.text, marginTop: 6 }}>
          {fmt(d.items)} items, XCG {fmtMoney(d.value)} negatief
        </div>
        <div style={{ fontSize: 11, color: '#aab', marginTop: 6, fontStyle: 'italic' }}>
          Grafiek verschijnt zodra er meer snapshots zijn.
        </div>
      </div>
    );
  }

  const maxItems = Math.max(...data.map(d => d.items), 1);
  const minValue = Math.min(...data.map(d => d.value), 0);
  const valueRange = Math.abs(minValue) || 1;
  const xFor = (i) => padL + (i * (W - padL - padR)) / Math.max(data.length - 1, 1);
  const yItems = (v) => padT + ((maxItems - v) / maxItems) * (H - padT - padB);
  const yValue = (v) => padT + ((0 - v) / valueRange) * (H - padT - padB);

  const pathItems = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yItems(d.items)}`).join(' ');
  const pathValue = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yValue(d.value)}`).join(' ');

  const itemTicks = [0, Math.round(maxItems * 0.5), maxItems];
  const valueTicks = [0, Math.round(minValue * 0.5), minValue];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 280, display: 'block' }}>
      {itemTicks.map((t, i) => (
        <line key={'g' + i} x1={padL} x2={W - padR} y1={yItems(t)} y2={yItems(t)} stroke="#eef" strokeDasharray="3 3" />
      ))}
      <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="#ccd" />
      {itemTicks.map((t, i) => (
        <text key={'l' + i} x={padL - 6} y={yItems(t) + 4} textAnchor="end" fontSize="10" fill={C.ink}>{fmt(t)}</text>
      ))}
      <line x1={W - padR} x2={W - padR} y1={padT} y2={H - padB} stroke="#ccd" />
      {valueTicks.map((t, i) => (
        <text key={'r' + i} x={W - padR + 6} y={yValue(t) + 4} textAnchor="start" fontSize="10" fill={C.red}>{fmtMoneyShort(t)}</text>
      ))}
      <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#ccd" />
      {data.map((d, i) => (
        <text key={'x' + i} x={xFor(i)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill={C.muted}>
          {fmtDateShort(d.date)}
        </text>
      ))}
      <path d={pathItems} fill="none" stroke={C.ink} strokeWidth="2" />
      {data.map((d, i) => (
        <circle key={'pi' + i} cx={xFor(i)} cy={yItems(d.items)} r="3" fill={C.ink}>
          <title>{fmtDate(d.date)}: {fmt(d.items)} items</title>
        </circle>
      ))}
      <path d={pathValue} fill="none" stroke={C.red} strokeWidth="2" />
      {data.map((d, i) => (
        <circle key={'pv' + i} cx={xFor(i)} cy={yValue(d.value)} r="3" fill={C.red}>
          <title>{fmtDate(d.date)}: XCG {fmtMoney(d.value)}</title>
        </circle>
      ))}
      <g transform={`translate(${padL}, 8)`}>
        <circle cx="6" cy="6" r="4" fill={C.ink} />
        <text x="16" y="10" fontSize="11" fill={C.text}>Aantal items (links)</text>
        <circle cx="140" cy="6" r="4" fill={C.red} />
        <text x="150" y="10" fontSize="11" fill={C.text}>Waarde XCG (rechts)</text>
      </g>
    </svg>
  );
}

/* ── DETAIL TAB ── */
function DetailTab({
  items, totalCount, search, setSearch, hideResolved, setHideResolved,
  sortCol, sortDir, handleSort,
  inlineNote, setInlineNote, inlineStatus, setInlineStatus,
  handleSaveInline, savingRow,
  latestStatusFor, notesByKey, firstSeen, openHistory,
}) {
  return (
    <>
      <div style={{
        display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <input
          type="text"
          placeholder="Zoek op itemnummer of omschrijving..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            fontSize: 13, minWidth: 280, background: 'white',
          }}
        />
        <label style={{ fontSize: 13, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
          Verberg opgeloste items
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
          {items.length} van {totalCount} items
        </div>
      </div>

      <Panel title="Items">
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={panelHeadRow}>
                <SortableTh col="store" current={sortCol} dir={sortDir} onClick={handleSort} width={60}>STORE</SortableTh>
                <SortableTh col="dept" current={sortCol} dir={sortDir} onClick={handleSort} width={60}>DEP</SortableTh>
                <SortableTh col="bum" current={sortCol} dir={sortDir} onClick={handleSort} width={90}>MGR</SortableTh>
                <SortableTh col="item" current={sortCol} dir={sortDir} onClick={handleSort} width={120}>ITEM</SortableTh>
                <SortableTh col="desc" current={sortCol} dir={sortDir} onClick={handleSort}>OMSCHRIJVING</SortableTh>
                <SortableTh col="qoh" current={sortCol} dir={sortDir} onClick={handleSort} align="right" width={70}>AANTAL</SortableTh>
                <SortableTh col="cost" current={sortCol} dir={sortDir} onClick={handleSort} align="right" width={110}>WAARDE</SortableTh>
                <SortableTh col="firstSeen" current={sortCol} dir={sortDir} onClick={handleSort} width={120}>EERSTE NEG</SortableTh>
                <SortableTh col="status" current={sortCol} dir={sortDir} onClick={handleSort} width={120}>STATUS</SortableTh>
                <th style={{ ...panelTh, width: 280 }}>OPMERKING</th>
                <th style={{ ...panelTh, width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: 28, textAlign: 'center', color: C.muted }}>
                    Geen items die aan de filters voldoen.
                  </td>
                </tr>
              ) : items.map((it) => {
                const key = it.store_number + '|' + it.item_number;
                const itemNotes = notesByKey[key] || [];
                const status = latestStatusFor(it.store_number, it.item_number);
                const fs = firstSeen[it.item_number];
                const days = fs ? daysSince(fs.first_seen_date) : null;

                return (
                  <tr key={it.id} style={{ borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                    <td style={td}>{it.store_number}</td>
                    <td style={td}>{it.dept_code}</td>
                    <td style={{ ...td, fontSize: 11 }}>{it.bum || ''}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{it.item_number}</td>
                    <td style={{ ...td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.item_description}</td>
                    <td style={{ ...td, textAlign: 'right', color: C.red, fontWeight: 600 }}>{fmt(it.qoh)}</td>
                    <td style={{ ...td, textAlign: 'right', color: C.red }}>{fmtMoney(it.cost)}</td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {fs ? (
                        <>
                          {fmtDate(fs.first_seen_date)}
                          {days !== null && days > 0 && (
                            <div style={{ fontSize: 10, color: C.muted }}>{days} dagen</div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td style={td}><StatusBadge status={status} /></td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          type="text"
                          placeholder="Nieuwe opmerking..."
                          value={inlineNote[it.id] || ''}
                          onChange={(e) => setInlineNote({ ...inlineNote, [it.id]: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveInline(it); }}
                          style={{
                            padding: '4px 8px', fontSize: 12, borderRadius: 4,
                            border: `1px solid ${C.border}`, width: '100%', boxSizing: 'border-box',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <select
                            value={inlineStatus[it.id] || 'in_onderzoek'}
                            onChange={(e) => setInlineStatus({ ...inlineStatus, [it.id]: e.target.value })}
                            style={{
                              padding: '3px 6px', fontSize: 11, borderRadius: 4,
                              border: `1px solid ${C.border}`, background: 'white',
                            }}
                          >
                            <option value="in_onderzoek">In onderzoek</option>
                            <option value="opgelost">Opgelost</option>
                          </select>
                          <button
                            onClick={() => handleSaveInline(it)}
                            disabled={savingRow === it.id || !(inlineNote[it.id] || '').trim()}
                            style={{
                              padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                              background: (savingRow === it.id || !(inlineNote[it.id] || '').trim()) ? '#aab' : C.accent,
                              color: 'white', fontWeight: 600,
                              cursor: (savingRow === it.id || !(inlineNote[it.id] || '').trim()) ? 'default' : 'pointer',
                            }}
                          >
                            {savingRow === it.id ? '...' : 'Opslaan'}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => openHistory(it)}
                        style={{
                          padding: '4px 10px', fontSize: 11, borderRadius: 4,
                          border: `1px solid ${C.ink}`, background: 'white', color: C.ink,
                          fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Historie {itemNotes.length > 0 ? `(${itemNotes.length})` : ''}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ── Sortable header ── */
function SortableTh({ col, current, dir, onClick, children, align, width }) {
  const isActive = current === col;
  const arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={() => onClick(col)}
      style={{
        ...panelTh,
        textAlign: align || 'left',
        width: width || 'auto',
        cursor: 'pointer',
        userSelect: 'none',
        color: isActive ? C.accent : 'white',
      }}
    >
      {children}{arrow}
    </th>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span style={{ color: '#aab', fontSize: 11 }}>—</span>;
  const colors = {
    in_onderzoek: { bg: '#fff3cd', fg: '#856404', label: 'In onderzoek' },
    opgelost: { bg: '#d4edda', fg: '#155724', label: 'Opgelost' },
  };
  const c = colors[status] || { bg: '#eee', fg: '#555', label: status };
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

/* ── History modal ── */
function HistoryModal({ item, notes, firstSeen, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(27,58,92,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 12, padding: 0, maxWidth: 700, width: '100%',
          maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(27,58,92,0.3)',
        }}
      >
        <div style={{
          background: C.panelHead, color: 'white', padding: '14px 20px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{item.item_description || 'Geen omschrijving'}</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              Item <strong style={{ fontFamily: 'monospace' }}>{item.item_number}</strong> · Store {item.store_number} · {item.dept_code} {item.dept_name}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 22, color: 'white',
            cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 14, display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
            <span>Aantal: <strong style={{ color: C.red }}>{fmt(item.qoh)}</strong></span>
            <span>Waarde: <strong style={{ color: C.red }}>XCG {fmtMoney(item.cost)}</strong></span>
            {firstSeen && (
              <span>Eerste keer negatief: <strong>{fmtDate(firstSeen.first_seen_date)}</strong>
                {' '}({daysSince(firstSeen.first_seen_date)} dagen geleden)
              </span>
            )}
          </div>

          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: C.ink }}>Historie ({notes.length})</h3>
          {notes.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13, fontStyle: 'italic' }}>Nog geen opmerkingen.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ background: '#fafcfe', padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: C.text }}>
                      <strong>{n.created_by_name || n.created_by_email}</strong>
                      <span style={{ margin: '0 6px', color: '#aab' }}>·</span>
                      {fmtDateTime(n.created_at)}
                    </div>
                    <StatusBadge status={n.status} />
                  </div>
                  <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>{n.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Table styles ── */
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const panelHeadRow = { background: C.panelHead };
const panelTh = {
  padding: '10px 10px', textAlign: 'left', fontSize: 10, color: 'white',
  textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5,
};
const td = { padding: '8px 10px', color: C.text };
