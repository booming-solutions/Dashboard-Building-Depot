/* ============================================================
   BESTAND: page.js
   KOPIEER NAAR: src/app/dashboard/marketing/website/page.js

   Marketing › Website foto-status  (v3)
   - BUM-indeling uit bum_groups + dept_bum_mapping (zoals sales)
   - "Scan nu" loopt nu department voor department (live voortgang,
     korte requests, geen timeout) en sluit af met een snapshot
   - Δ-kolom: verschil in 'zonder foto' t.o.v. de vorige meting
     (uit website_photo_history) — groen = vooruitgang
   - Robuust tegen niet-JSON antwoorden van de scan
   ============================================================ */
'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { createClient } from '@/lib/supabase';

const NF = new Intl.NumberFormat('nl-NL');

function coverageColor(pct) {
  if (pct == null) return { bar: '#cbd5e1', text: 'text-gray-400' };
  if (pct >= 90) return { bar: '#16a34a', text: 'text-green-600' };
  if (pct >= 75) return { bar: '#f59e0b', text: 'text-amber-600' };
  return { bar: '#dc2626', text: 'text-red-600' };
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] uppercase tracking-wider text-[#1B3A5C]/40 font-semibold">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: accent || '#1B3A5C' }}>{value}</p>
      {sub && <p className="text-[12px] text-[#1B3A5C]/40 mt-0.5">{sub}</p>}
    </div>
  );
}

// Δ-weergave: minder zonder-foto = vooruitgang (groen, met ↓)
function Delta({ value }) {
  if (value == null) return <span className="text-[#1B3A5C]/25">—</span>;
  if (value === 0) return <span className="text-[#1B3A5C]/30">0</span>;
  const better = value < 0;
  return (
    <span className={better ? 'text-green-600' : 'text-red-600'}>
      {better ? '↓' : '↑'} {NF.format(Math.abs(value))}
    </span>
  );
}

export default function WebsitePhotoStatusPage() {
  const supabase = createClient();

  const [region, setRegion] = useState('CUR');
  const [groupBy, setGroupBy] = useState('bum');
  const [summary, setSummary] = useState([]);
  const [missing, setMissing] = useState([]);
  const [history, setHistory] = useState([]);
  const [baselineDate, setBaselineDate] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [role, setRole] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const [bumGroups, setBumGroups] = useState([]);
  const [deptBumMapping, setDeptBumMapping] = useState([]);

  const isAdmin = role === 'admin';

  // BUM-mapping per lopend jaar (peildatum 1 jan)
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const deptBumMap = {};
  deptBumMapping.forEach((m) => {
    if (m.valid_from <= yearStart && (!m.valid_until || m.valid_until >= yearStart)) {
      deptBumMap[m.dept_code] = m.bum_group_code;
    }
  });
  const bumLabel = {};
  bumGroups.forEach((g) => { bumLabel[g.code] = g.display_name; });

  const groupCodeFor = (deptCode) => {
    if (!deptCode) return 'OVERIG';
    return (
      deptBumMap[deptCode] ||
      deptBumMap[String(parseInt(deptCode, 10))] ||
      deptBumMap[String(deptCode).padStart(2, '0')] ||
      'OVERIG'
    );
  };
  const labelFor = (code) => bumLabel[code] || (code === 'OVERIG' ? 'Niet toegewezen' : code);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        setRole(prof?.role || null);
      }
      const { data: bg } = await supabase.from('bum_groups').select('*').eq('active', true).order('sort_order');
      const { data: dbm } = await supabase.from('dept_bum_mapping').select('*');
      setBumGroups(bg || []);
      setDeptBumMapping(dbm || []);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setExpanded(null);

    const { data: sum } = await supabase
      .from('website_photo_summary').select('*').eq('region', region);
    setSummary(sum || []);

    const { data: lc } = await supabase
      .from('website_photo_status').select('last_checked')
      .eq('region', region).order('last_checked', { ascending: false }).limit(1);
    setLastChecked(lc?.[0]?.last_checked || null);

    // History: bepaal de vorige meting (laatste snapshot vóór vandaag)
    const today = new Date().toISOString().slice(0, 10);
    const { data: dts } = await supabase
      .from('website_photo_history').select('snapshot_date')
      .eq('region', region).order('snapshot_date', { ascending: false }).limit(300);
    const uniqueDates = [...new Set((dts || []).map((d) => d.snapshot_date))];
    const baseDate = uniqueDates.find((d) => d < today) || null;
    setBaselineDate(baseDate);
    if (baseDate) {
      const { data: hist } = await supabase
        .from('website_photo_history').select('dept_code,without_photo')
        .eq('region', region).eq('snapshot_date', baseDate);
      setHistory(hist || []);
    } else {
      setHistory([]);
    }

    // Detail: alle producten zonder foto (gepagineerd)
    let all = [];
    let from = 0;
    const step = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from('website_photo_status')
        .select('sku,title,dept_code,dept_name,product_url,brand_name')
        .eq('region', region).eq('has_image', false)
        .order('dept_code', { ascending: true }).order('sku', { ascending: true })
        .range(from, from + step - 1);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step || from > 20000) break;
      from += step;
    }
    setMissing(all);
    setLoading(false);
  }, [supabase, region]);

  useEffect(() => { load(); }, [load]);

  // Scan: loop department voor department (korte requests + live voortgang)
  async function runScan() {
    setScanning(true);
    setScanMsg('Scan gestart…');
    try {
      let idx = 0;
      let total = null;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch(`/api/marketing/scan-website?dept_index=${idx}`, { cache: 'no-store' });
        const txt = await res.text();
        let json;
        try { json = JSON.parse(txt); } catch { throw new Error(txt.slice(0, 200)); }
        if (json.error) throw new Error(json.error);
        total = json.total_depts;
        setScanMsg(`Scannen… department ${idx + 1}/${total}`);
        if (json.next_index == null) break;
        idx = json.next_index;
      }
      setScanMsg('Snapshot opslaan…');
      await fetch('/api/marketing/scan-website?snapshot=1', { cache: 'no-store' });
      setScanMsg('Klaar.');
      await load();
    } catch (e) {
      setScanMsg(`Scan mislukt: ${String(e?.message || e)}`);
    }
    setScanning(false);
  }

  // Totalen
  const totals = summary.reduce(
    (a, r) => {
      a.total += r.total_skus || 0;
      a.withPhoto += r.with_photo || 0;
      a.withoutPhoto += r.without_photo || 0;
      return a;
    },
    { total: 0, withPhoto: 0, withoutPhoto: 0 },
  );
  const coverage = totals.total ? Math.round((totals.withPhoto / totals.total) * 1000) / 10 : null;

  // Baseline (vorige meting) zonder-foto, gegroepeerd zoals de huidige weergave
  function baselineWithout(groupKey) {
    if (!baselineDate) return null;
    return history
      .filter((r) => (groupBy === 'dept' ? (r.dept_code || '—') === groupKey : groupCodeFor(r.dept_code) === groupKey))
      .reduce((s, r) => s + (r.without_photo || 0), 0);
  }

  // Groepering
  let groups = [];
  if (groupBy === 'dept') {
    groups = summary.map((r) => ({
      key: r.dept_code || '—',
      label: r.dept_name || `Dept ${r.dept_code || '—'}`,
      total: r.total_skus || 0,
      without: r.without_photo || 0,
      with: r.with_photo || 0,
    }));
  } else {
    const byBum = {};
    for (const r of summary) {
      const code = groupCodeFor(r.dept_code);
      if (!byBum[code]) byBum[code] = { key: code, label: labelFor(code), total: 0, without: 0, with: 0 };
      byBum[code].total += r.total_skus || 0;
      byBum[code].without += r.without_photo || 0;
      byBum[code].with += r.with_photo || 0;
    }
    groups = Object.values(byBum);
  }
  groups.forEach((g) => {
    g.coverage = g.total ? Math.round((g.with / g.total) * 1000) / 10 : null;
    const base = baselineWithout(g.key);
    g.delta = base == null ? null : g.without - base;
  });
  groups.sort((a, b) => b.without - a.without);

  function detailFor(groupKey) {
    if (groupBy === 'dept') return missing.filter((m) => (m.dept_code || '—') === groupKey);
    return missing.filter((m) => groupCodeFor(m.dept_code) === groupKey);
  }

  function exportCsv() {
    const rows = [['SKU', 'Titel', 'Dept', 'BUM', 'Merk', 'Product-URL']];
    for (const m of missing) {
      rows.push([
        m.sku || '',
        (m.title || '').replace(/"/g, '""'),
        m.dept_name || m.dept_code || '',
        labelFor(groupCodeFor(m.dept_code)),
        m.brand_name || '',
        m.product_url || '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zonder-foto-${region}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C] flex items-center gap-2"><span>📣</span> Website foto-status</h1>
          <p className="text-[13px] text-[#1B3A5C]/50 mt-0.5">
            Welke producten op building-depot.com wel of geen foto hebben, per department en BUM.
          </p>
          {lastChecked && (
            <p className="text-[11px] text-[#1B3A5C]/40 mt-1">Laatst gescand: {new Date(lastChecked).toLocaleString('nl-NL')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px]">
            {['CUR', 'BON'].map((r) => (
              <button key={r} onClick={() => setRegion(r)}
                className={`px-3 py-1.5 font-medium transition-all ${region === r ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:bg-gray-50'}`}>{r}</button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={!missing.length}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-gray-200 text-[#1B3A5C]/70 hover:bg-gray-50 disabled:opacity-40">Export CSV</button>
          {isAdmin && (
            <button onClick={runScan} disabled={scanning}
              className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-[#1B3A5C] text-white hover:opacity-90 disabled:opacity-50">
              {scanning ? 'Scannen…' : 'Scan nu'}
            </button>
          )}
        </div>
      </div>

      {scanMsg && (
        <div className="mb-4 text-[12px] px-3 py-2 rounded-lg bg-[#1B3A5C]/5 text-[#1B3A5C] border border-[#1B3A5C]/10">{scanMsg}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Totaal SKU's online" value={NF.format(totals.total)} />
        <Kpi label="Met foto" value={NF.format(totals.withPhoto)} accent="#16a34a" />
        <Kpi label="Zonder foto" value={NF.format(totals.withoutPhoto)} accent="#dc2626" sub="prioriteit" />
        <Kpi label="Dekking" value={coverage != null ? `${coverage}%` : '—'} accent={coverageColor(coverage).bar} />
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#1B3A5C]/40 font-medium">Groeperen per:</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px]">
            {[['bum', 'BUM'], ['dept', 'Department']].map(([v, l]) => (
              <button key={v} onClick={() => { setGroupBy(v); setExpanded(null); }}
                className={`px-3 py-1.5 font-medium transition-all ${groupBy === v ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        </div>
        {baselineDate && (
          <span className="text-[11px] text-[#1B3A5C]/40">Δ t.o.v. {new Date(baselineDate).toLocaleDateString('nl-NL')}</span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-[#1B3A5C]/40">Laden…</div>
        ) : groups.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#1B3A5C]/40">
            Nog geen data voor {region}. {isAdmin ? 'Klik op "Scan nu" om te beginnen.' : 'Vraag een admin een scan te draaien.'}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[#1B3A5C]/40 border-b border-gray-100">
                <th className="px-4 py-2.5 font-semibold">{groupBy === 'bum' ? 'BUM' : 'Department'}</th>
                <th className="px-4 py-2.5 font-semibold text-right">Totaal</th>
                <th className="px-4 py-2.5 font-semibold text-right">Zonder foto</th>
                <th className="px-4 py-2.5 font-semibold text-right">Δ</th>
                <th className="px-4 py-2.5 font-semibold w-[35%]">Dekking</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const c = coverageColor(g.coverage);
                const open = expanded === g.key;
                const detail = open ? detailFor(g.key) : [];
                return (
                  <Fragment key={g.key}>
                    <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-medium text-[#1B3A5C]">{g.label}</td>
                      <td className="px-4 py-2.5 text-right text-[#1B3A5C]/70">{NF.format(g.total)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${g.without > 0 ? 'text-red-600' : 'text-[#1B3A5C]/30'}`}>{NF.format(g.without)}</td>
                      <td className="px-4 py-2.5 text-right text-[12px] font-medium"><Delta value={g.delta} /></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${g.coverage ?? 0}%`, backgroundColor: c.bar }} />
                          </div>
                          <span className={`text-[12px] font-medium w-10 text-right ${c.text}`}>{g.coverage != null ? `${g.coverage}%` : '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {g.without > 0 && (
                          <button onClick={() => setExpanded(open ? null : g.key)}
                            className="text-[12px] text-[#1B3A5C]/60 hover:text-[#1B3A5C] font-medium">{open ? 'Verberg' : 'Toon'}</button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className="bg-gray-50/60 px-4 py-3">
                          <div className="max-h-80 overflow-auto rounded-lg border border-gray-100 bg-white">
                            <table className="w-full text-[12px]">
                              <thead className="sticky top-0 bg-white">
                                <tr className="text-left text-[10px] uppercase tracking-wider text-[#1B3A5C]/40 border-b border-gray-100">
                                  <th className="px-3 py-2 font-semibold">SKU</th>
                                  <th className="px-3 py-2 font-semibold">Titel</th>
                                  <th className="px-3 py-2 font-semibold">Department</th>
                                  <th className="px-3 py-2 font-semibold"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((m) => (
                                  <tr key={m.sku} className="border-b border-gray-50">
                                    <td className="px-3 py-1.5 font-mono text-[#1B3A5C]/70">{m.sku}</td>
                                    <td className="px-3 py-1.5 text-[#1B3A5C]/80">{m.title || '—'}</td>
                                    <td className="px-3 py-1.5 text-[#1B3A5C]/50">{m.dept_name || m.dept_code || '—'}</td>
                                    <td className="px-3 py-1.5 text-right">
                                      {m.product_url && (
                                        <a href={m.product_url} target="_blank" rel="noopener noreferrer" className="text-[#1B3A5C] hover:underline font-medium">Bekijk →</a>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-[#1B3A5C]/30 mt-3">
        Bron: building-depot.com (EZ-AD storefront), veld <code>has_image</code>. BUM-indeling uit <code>dept_bum_mapping</code> (peildatum {year}).
        Δ vergelijkt 'zonder foto' met de vorige wekelijkse meting.
      </p>
    </div>
  );
}
