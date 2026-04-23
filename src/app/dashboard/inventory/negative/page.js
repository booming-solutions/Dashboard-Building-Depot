/* ============================================================
   BESTAND: page_negative_inventory_v2.js
   KOPIEER NAAR: src/app/dashboard/inventory/negative/page.js
   (vervangt de huidige page.js)
   
   Twee tabs:
   - Overzicht: trendgrafiek (Curaçao/Bonaire/Samen) + totalen per dept
   - Detail: werklijst met opmerkingen en status
   ============================================================ */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const supabase = createClientComponentClient();

const fmt = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtMoney = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};

const regionOf = (storeNumber) => {
  const s = String(storeNumber || '').trim().toUpperCase();
  if (s === 'A' || s === 'B') return 'Bonaire';
  return 'Curacao';
};

export default function NegativeInventoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');

  const [tab, setTab] = useState('overzicht');  // 'overzicht' | 'detail'

  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [snapshots, setSnapshots] = useState([]);

  // Filters (overzicht)
  const [regionFilter, setRegionFilter] = useState('samen');  // 'curacao' | 'bonaire' | 'samen'

  // Filters (detail)
  const [detailRegion, setDetailRegion] = useState('alle');  // 'alle' | 'curacao' | 'bonaire'
  const [detailDept, setDetailDept] = useState('alle');
  const [search, setSearch] = useState('');
  const [hideResolved, setHideResolved] = useState(false); // "items met opgeloste status verbergen"

  // Modal state
  const [activeItem, setActiveItem] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [newStatus, setNewStatus] = useState('in_onderzoek');
  const [saving, setSaving] = useState(false);

  /* ── Load user + data ── */
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      setUserEmail(session.user.email || '');

      // Load profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      setProfile(prof);
      setUserName(prof?.full_name || prof?.name || session.user.email);

      // Check permission
      const isAdmin = prof?.role === 'admin';
      const allowed = prof?.allowed_reports || [];
      if (!isAdmin && !allowed.includes('inventory_negative')) {
        router.push('/dashboard');
        return;
      }

      await loadAll();
      setLoading(false);
    })();
  }, []);

  async function loadAll() {
    await Promise.all([loadItems(), loadNotes(), loadSnapshots()]);
  }

  async function loadItems() {
    // Negatieve voorraad items (live)
    let all = [];
    let from = 0;
    const step = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('negative_inventory')
        .select('*')
        .lt('qoh', 0)
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
        .from('negative_inventory_notes')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + step - 1);
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
        .from('negative_inventory_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: true })
        .range(from, from + step - 1);
      if (error) { console.error(error); break; }
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step) break;
      from += step;
    }
    setSnapshots(all);
  }

  /* ── Note helpers ── */
  const notesByKey = useMemo(() => {
    const m = {};
    notes.forEach((n) => {
      const k = n.store_number + '|' + n.item_number;
      if (!m[k]) m[k] = [];
      m[k].push(n);
    });
    // sorted descending per item
    Object.keys(m).forEach((k) => {
      m[k].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    });
    return m;
  }, [notes]);

  const latestStatusFor = (storeNumber, itemNumber) => {
    const arr = notesByKey[storeNumber + '|' + itemNumber] || [];
    return arr[0]?.status || null;
  };

  /* ── Overzicht data ── */
  const trendData = useMemo(() => {
    // Group by date, filter by region
    const byDate = {};
    snapshots.forEach((s) => {
      if (regionFilter === 'curacao' && s.region !== 'Curacao') return;
      if (regionFilter === 'bonaire' && s.region !== 'Bonaire') return;
      const d = s.snapshot_date;
      if (!byDate[d]) byDate[d] = { date: d, items: 0, value: 0 };
      byDate[d].items += s.items_count || 0;
      byDate[d].value += parseFloat(s.total_negative_value) || 0;
    });
    return Object.values(byDate)
      .map((d) => ({ ...d, value: Math.round(d.value), dateLabel: fmtDate(d.date) }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [snapshots, regionFilter]);

  const latestSnapshotDate = useMemo(() => {
    if (!snapshots.length) return null;
    return snapshots.reduce((max, s) => (s.snapshot_date > max ? s.snapshot_date : max), snapshots[0].snapshot_date);
  }, [snapshots]);

  const deptBreakdown = useMemo(() => {
    // Latest snapshot per region/dept
    const latest = snapshots.filter((s) => s.snapshot_date === latestSnapshotDate);
    const filtered = latest.filter((s) => {
      if (regionFilter === 'curacao') return s.region === 'Curacao';
      if (regionFilter === 'bonaire') return s.region === 'Bonaire';
      return true;
    });
    // Aggregate per dept across regions when "samen"
    const agg = {};
    filtered.forEach((s) => {
      const k = s.department_code;
      if (!agg[k]) agg[k] = { dept_code: s.department_code, dept_name: s.department_name, items: 0, value: 0 };
      agg[k].items += s.items_count || 0;
      agg[k].value += parseFloat(s.total_negative_value) || 0;
    });
    return Object.values(agg).sort((a, b) => a.value - b.value);  // meest negatief bovenaan
  }, [snapshots, latestSnapshotDate, regionFilter]);

  const totals = useMemo(() => {
    const t = { items: 0, value: 0 };
    deptBreakdown.forEach((d) => {
      t.items += d.items;
      t.value += d.value;
    });
    return t;
  }, [deptBreakdown]);

  /* ── Detail data ── */
  const detailItems = useMemo(() => {
    let arr = items.slice();

    // Hide resolved (opgelost)
    if (hideResolved) {
      arr = arr.filter((it) => latestStatusFor(it.store_number, it.item_number) !== 'opgelost');
    }

    // Region
    if (detailRegion !== 'alle') {
      arr = arr.filter((it) => regionOf(it.store_number).toLowerCase() === detailRegion);
    }

    // Dept
    if (detailDept !== 'alle') {
      arr = arr.filter((it) => it.dept_code === detailDept);
    }

    // Search
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      arr = arr.filter((it) =>
        (it.item_number || '').toLowerCase().includes(s) ||
        (it.item_description || '').toLowerCase().includes(s) ||
        (it.dept_name || '').toLowerCase().includes(s)
      );
    }

    // Sort: most negative value first
    return arr.sort((a, b) => (a.cost || 0) - (b.cost || 0));
  }, [items, detailRegion, detailDept, search, hideResolved, notesByKey]);

  const deptOptions = useMemo(() => {
    const set = {};
    items.forEach((it) => { set[it.dept_code] = it.dept_name || it.dept_code; });
    return Object.entries(set)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [items]);

  /* ── Add note ── */
  async function handleSaveNote() {
    if (!newNote.trim() || !activeItem) return;
    setSaving(true);
    const row = {
      store_number: activeItem.store_number,
      item_number: activeItem.item_number,
      item_description: activeItem.item_description,
      department_code: activeItem.dept_code,
      department_name: activeItem.dept_name,
      note: newNote.trim(),
      status: newStatus,
      created_by_email: userEmail,
      created_by_name: userName,
    };
    const { error } = await supabase.from('negative_inventory_notes').insert(row);
    if (error) {
      alert('Opslaan mislukt: ' + error.message);
    } else {
      setNewNote('');
      setNewStatus('in_onderzoek');
      await loadNotes();
    }
    setSaving(false);
  }

  function openItem(it) {
    setActiveItem(it);
    setNewNote('');
    setNewStatus(latestStatusFor(it.store_number, it.item_number) || 'in_onderzoek');
  }

  /* ── UI ── */
  if (loading) {
    return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Laden...</div>;
  }

  return (
    <div style={{ padding: '24px 32px', fontFamily: 'system-ui, sans-serif', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26, color: '#0f3c6e', fontFamily: '"Bookman Old Style", serif' }}>
          Negatieve Voorraad
        </h1>
        <p style={{ margin: '4px 0 0', color: '#556', fontSize: 13 }}>
          Overzicht en opvolging van items met negatieve voorraad
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #dce6f1', marginBottom: 20 }}>
        <TabButton active={tab === 'overzicht'} onClick={() => setTab('overzicht')}>
          Overzicht
        </TabButton>
        <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>
          Detail
        </TabButton>
      </div>

      {tab === 'overzicht' && (
        <OverzichtTab
          regionFilter={regionFilter}
          setRegionFilter={setRegionFilter}
          trendData={trendData}
          deptBreakdown={deptBreakdown}
          totals={totals}
          latestSnapshotDate={latestSnapshotDate}
        />
      )}

      {tab === 'detail' && (
        <DetailTab
          items={detailItems}
          allItemsCount={items.length}
          deptOptions={deptOptions}
          detailRegion={detailRegion} setDetailRegion={setDetailRegion}
          detailDept={detailDept} setDetailDept={setDetailDept}
          search={search} setSearch={setSearch}
          hideResolved={hideResolved} setHideResolved={setHideResolved}
          openItem={openItem}
          notesByKey={notesByKey}
          latestStatusFor={latestStatusFor}
        />
      )}

      {/* Modal */}
      {activeItem && (
        <ItemModal
          item={activeItem}
          notes={notesByKey[activeItem.store_number + '|' + activeItem.item_number] || []}
          newNote={newNote} setNewNote={setNewNote}
          newStatus={newStatus} setNewStatus={setNewStatus}
          saving={saving}
          onSave={handleSaveNote}
          onClose={() => setActiveItem(null)}
        />
      )}
    </div>
  );
}

/* ── Components ── */

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: '10px 20px',
        fontSize: 14,
        fontWeight: 600,
        color: active ? '#0f3c6e' : '#789',
        borderBottom: active ? '3px solid #0f3c6e' : '3px solid transparent',
        marginBottom: -2,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function OverzichtTab({ regionFilter, setRegionFilter, trendData, deptBreakdown, totals, latestSnapshotDate }) {
  return (
    <>
      {/* Region toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'samen', lbl: 'Samen' },
          { id: 'curacao', lbl: 'Curaçao' },
          { id: 'bonaire', lbl: 'Bonaire' },
        ].map((r) => (
          <button
            key={r.id}
            onClick={() => setRegionFilter(r.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid ' + (regionFilter === r.id ? '#0f3c6e' : '#ccd'),
              background: regionFilter === r.id ? '#0f3c6e' : 'white',
              color: regionFilter === r.id ? 'white' : '#0f3c6e',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {r.lbl}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', color: '#789', fontSize: 12, alignSelf: 'center' }}>
          Laatste snapshot: {latestSnapshotDate ? fmtDate(latestSnapshotDate) : '—'}
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Aantal items negatief" value={fmt(totals.items)} />
        <KpiCard label="Totaal waarde negatief" value={fmtMoney(totals.value)} prefix="XCG " negative />
        <KpiCard label="Aantal departementen" value={fmt(deptBreakdown.length)} />
      </div>

      {/* Trend chart */}
      <div style={{ background: 'white', padding: 20, borderRadius: 12, border: '1px solid #dce6f1', marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#0f3c6e' }}>Verloop in de tijd</h3>
        {trendData.length === 0 ? (
          <p style={{ color: '#789', fontSize: 13 }}>Nog geen snapshots beschikbaar. De eerste snapshot wordt aangemaakt bij de volgende data-update.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v, n) => {
                  if (n === 'Waarde (XCG)') return fmtMoney(v);
                  return fmt(v);
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="items" name="Aantal items" stroke="#0f3c6e" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="value" name="Waarde (XCG)" stroke="#c04040" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Dept breakdown */}
      <div style={{ background: 'white', padding: 20, borderRadius: 12, border: '1px solid #dce6f1' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#0f3c6e' }}>
          Per departement {latestSnapshotDate ? '(' + fmtDate(latestSnapshotDate) + ')' : ''}
        </h3>
        {deptBreakdown.length === 0 ? (
          <p style={{ color: '#789', fontSize: 13 }}>Geen negatieve voorraad.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f5f9fd', borderBottom: '2px solid #dce6f1' }}>
                  <th style={th}>Dept</th>
                  <th style={th}>Omschrijving</th>
                  <th style={{ ...th, textAlign: 'right' }}>Aantal items</th>
                  <th style={{ ...th, textAlign: 'right' }}>Waarde (XCG)</th>
                </tr>
              </thead>
              <tbody>
                {deptBreakdown.map((d) => (
                  <tr key={d.dept_code} style={{ borderBottom: '1px solid #eef' }}>
                    <td style={td}>{d.dept_code}</td>
                    <td style={td}>{d.dept_name}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(d.items)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#c04040', fontWeight: 600 }}>{fmtMoney(d.value)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #0f3c6e', background: '#f5f9fd', fontWeight: 700 }}>
                  <td style={td} colSpan={2}>Totaal</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(totals.items)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#c04040' }}>{fmtMoney(totals.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function DetailTab({ items, allItemsCount, deptOptions, detailRegion, setDetailRegion, detailDept, setDetailDept, search, setSearch, hideResolved, setHideResolved, openItem, notesByKey, latestStatusFor }) {
  return (
    <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={detailRegion} onChange={(e) => setDetailRegion(e.target.value)} style={selectStyle}>
          <option value="alle">Alle regio&apos;s</option>
          <option value="curacao">Curaçao</option>
          <option value="bonaire">Bonaire</option>
        </select>
        <select value={detailDept} onChange={(e) => setDetailDept(e.target.value)} style={selectStyle}>
          <option value="alle">Alle departementen</option>
          {deptOptions.map((d) => (
            <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Zoek op itemnummer of omschrijving..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...selectStyle, minWidth: 280 }}
        />
        <label style={{ fontSize: 13, color: '#556', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
          Verberg items met status &quot;opgelost&quot;
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#789' }}>
          {items.length} van {allItemsCount} items
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #dce6f1', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f9fd', borderBottom: '2px solid #dce6f1' }}>
                <th style={th}>Store</th>
                <th style={th}>Dept</th>
                <th style={th}>Item</th>
                <th style={th}>Omschrijving</th>
                <th style={{ ...th, textAlign: 'right' }}>Aantal</th>
                <th style={{ ...th, textAlign: 'right' }}>Waarde (XCG)</th>
                <th style={th}>Status</th>
                <th style={th}>Opmerkingen</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: 'center', color: '#789' }}>
                    Geen items die aan de filters voldoen.
                  </td>
                </tr>
              ) : items.map((it) => {
                const key = it.store_number + '|' + it.item_number;
                const itemNotes = notesByKey[key] || [];
                const status = latestStatusFor(it.store_number, it.item_number);
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #eef' }}>
                    <td style={td}>{it.store_number}</td>
                    <td style={td}>{it.dept_code}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{it.item_number}</td>
                    <td style={td}>{it.item_description}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#c04040', fontWeight: 600 }}>{fmt(it.qoh)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#c04040' }}>{fmtMoney(it.cost)}</td>
                    <td style={td}><StatusBadge status={status} /></td>
                    <td style={td}>{itemNotes.length > 0 ? itemNotes.length + 'x' : '—'}</td>
                    <td style={td}>
                      <button
                        onClick={() => openItem(it)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid #0f3c6e',
                          background: '#0f3c6e',
                          color: 'white',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span style={{ color: '#aab', fontSize: 12 }}>—</span>;
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

function KpiCard({ label, value, prefix = '', negative }) {
  return (
    <div style={{ background: 'white', padding: 16, borderRadius: 12, border: '1px solid #dce6f1' }}>
      <div style={{ fontSize: 11, color: '#789', textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: negative ? '#c04040' : '#0f3c6e', marginTop: 4 }}>
        {prefix}{value}
      </div>
    </div>
  );
}

function ItemModal({ item, notes, newNote, setNewNote, newStatus, setNewStatus, saving, onSave, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,60,110,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 12, padding: 24, maxWidth: 700, width: '100%',
          maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,60,110,0.3)'
        }}
      >
        {/* Header */}
        <div style={{ borderBottom: '2px solid #dce6f1', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: '#0f3c6e' }}>{item.item_description || 'Geen omschrijving'}</h2>
              <div style={{ fontSize: 12, color: '#789', marginTop: 4 }}>
                Item <strong style={{ fontFamily: 'monospace' }}>{item.item_number}</strong> · Store {item.store_number} · {item.dept_code} {item.dept_name}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: '#789', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 13 }}>
            <span>Aantal: <strong style={{ color: '#c04040' }}>{fmt(item.qoh)}</strong></span>
            <span>Waarde: <strong style={{ color: '#c04040' }}>XCG {fmtMoney(item.cost)}</strong></span>
          </div>
        </div>

        {/* New note */}
        <div style={{ background: '#f5f9fd', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#0f3c6e' }}>Opmerking toevoegen</h3>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Wat heb je uitgezocht? Welke actie is ondernomen?"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 6, border: '1px solid #ccd',
              fontFamily: 'inherit', fontSize: 13, resize: 'vertical'
            }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: '#556' }}>Status:</label>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={selectStyle}>
              <option value="in_onderzoek">In onderzoek</option>
              <option value="opgelost">Opgelost</option>
            </select>
            <button
              onClick={onSave}
              disabled={saving || !newNote.trim()}
              style={{
                marginLeft: 'auto', padding: '8px 18px', borderRadius: 6, border: 'none',
                background: saving || !newNote.trim() ? '#aab' : '#0f3c6e', color: 'white',
                fontWeight: 600, cursor: saving || !newNote.trim() ? 'default' : 'pointer'
              }}
            >
              {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </div>
        </div>

        {/* History */}
        <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#0f3c6e' }}>Historie ({notes.length})</h3>
        {notes.length === 0 ? (
          <p style={{ color: '#789', fontSize: 13, fontStyle: 'italic' }}>Nog geen opmerkingen.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ background: '#fafcfe', padding: 12, borderRadius: 8, border: '1px solid #eef' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: '#556' }}>
                    <strong>{n.created_by_name || n.created_by_email}</strong>
                    <span style={{ margin: '0 6px', color: '#aab' }}>·</span>
                    {fmtDateTime(n.created_at)}
                  </div>
                  <StatusBadge status={n.status} />
                </div>
                <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap' }}>{n.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Styles ── */
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, color: '#0f3c6e', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.3 };
const td = { padding: '8px 12px', color: '#333' };
const selectStyle = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #ccd',
  fontSize: 13,
  background: 'white',
  cursor: 'pointer',
};
