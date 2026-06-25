/* ============================================================
   BESTAND: page.js
   KOPIEER NAAR: src/app/dashboard/marketing/website/page.js

   Marketing › Website foto-status  (v1)
   - Leest aggregatie uit view `website_photo_summary`
   - Detaillijst (producten zonder foto) gepagineerd uit
     `website_photo_status` (omzeilt de 1000-rijen-limiet)
   - Groepering per BUM of per department, filter op regio
   - "Scan nu" (admin) triggert /api/marketing/scan-website
   - Eenvoudige CSV-export van de zonder-foto-lijst

   TODO: vul DEPT_BUM met jouw dept→BUM-indeling (hieronder).
   ============================================================ */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

// dept_code -> BUM.  Vul aan met jouw indeling (leading zeros: '01'..'99').
// Onbekende depts vallen onder 'Niet toegewezen'.
const DEPT_BUM = {
  // '01': 'Henk',
  // '41': 'Pascal',
};
const bumFor = (code) => (code && DEPT_BUM[code]) || 'Niet toegewezen';

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

export default function WebsitePhotoStatusPage() {
  const supabase = createClient();

  const [region, setRegion] = useState('CUR');
  const [groupBy, setGroupBy] = useState('bum'); // 'bum' | 'dept'
  const [summary, setSummary] = useState([]);
  const [missing, setMissing] = useState([]);
  const [lastChecked, setLastChecked] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [role, setRole] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const isAdmin = role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setExpanded(null);

    // Aggregatie per department
    const { data: sum } = await supabase
      .from('website_photo_summary')
      .select('*')
      .eq('region', region);
    setSummary(sum || []);

    // Laatst bijgewerkt
    const { data: lc } = await supabase
      .from('website_photo_status')
      .select('last_checked')
      .eq('region', region)
      .order('last_checked', { ascending: false })
      .limit(1);
    setLastChecked(lc?.[0]?.last_checked || null);

    // Detail: alle producten zonder foto (gepagineerd)
    let all = [];
    let from = 0;
    const step = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from('website_photo_status')
        .select('sku,title,dept_code,dept_name,product_url,brand_name')
        .eq('region', region)
        .eq('has_image', false)
        .order('dept_code', { ascending: true })
        .order('sku', { ascending: true })
        .range(from, from + step - 1);
      if (error || !data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < step || from > 20000) break;
      from += step;
    }
    setMissing(all);
    setLoading(false);
  }, [supabase, region]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        setRole(prof?.role || null);
      }
    })();
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function runScan() {
    setScanning(true);
    setScanMsg('Scan loopt — dit kan een halve tot een hele minuut duren…');
    try {
      const res = await fetch('/api/marketing/scan-website', { cache: 'no-store' });
      const json = await res.json();
      if (json?.error) {
        setScanMsg(`Scan mislukt: ${json.error}`);
      } else {
        setScanMsg(`Klaar — ${NF.format(json.unique_skus || 0)} producten gescand, ${NF.format(json.without_photo || 0)} zonder foto.`);
        await load();
      }
    } catch (e) {
      setScanMsg(`Scan mislukt: ${String(e?.message || e)}`);
    }
    setScanning(false);
  }

  // ---- Totalen ----
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

  // ---- Groepering ----
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
      const b = bumFor(r.dept_code);
      if (!byBum[b]) byBum[b] = { key: b, label: b, total: 0, without: 0, with: 0 };
      byBum[b].total += r.total_skus || 0;
      byBum[b].without += r.without_photo || 0;
      byBum[b].with += r.with_photo || 0;
    }
    groups = Object.values(byBum);
  }
  groups.forEach((g) => { g.coverage = g.total ? Math.round((g.with / g.total) * 1000) / 10 : null; });
  groups.sort((a, b) => b.without - a.without);

  function detailFor(groupKey) {
    if (groupBy === 'dept') return missing.filter((m) => (m.dept_code || '—') === groupKey);
    return missing.filter((m) => bumFor(m.dept_code) === groupKey);
  }

  function exportCsv() {
    const rows = [['SKU', 'Titel', 'Dept', 'BUM', 'Merk', 'Product-URL']];
    for (const m of missing) {
      rows.push([
        m.sku || '',
        (m.title || '').replace(/"/g, '""'),
        m.dept_name || m.dept_code || '',
        bumFor(m.dept_code),
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
      {/* Kop */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#1B3A5C] flex items-center gap-2">
            <span>📣</span> Website foto-status
          </h1>
          <p className="text-[13px] text-[#1B3A5C]/50 mt-0.5">
            Welke producten op building-depot.com wel of geen foto hebben, per department en BUM.
          </p>
          {lastChecked && (
            <p className="text-[11px] text-[#1B3A5C]/40 mt-1">
              Laatst gescand: {new Date(lastChecked).toLocaleString('nl-NL')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px]">
            {['CUR', 'BON'].map((r) => (
              <button key={r} onClick={() => setRegion(r)}
                className={`px-3 py-1.5 font-medium transition-all ${region === r ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:bg-gray-50'}`}>
                {r}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={!missing.length}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-gray-200 text-[#1B3A5C]/70 hover:bg-gray-50 disabled:opacity-40">
            Export CSV
          </button>
          {isAdmin && (
            <button onClick={runScan} disabled={scanning}
              className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-[#1B3A5C] text-white hover:opacity-90 disabled:opacity-50">
              {scanning ? 'Scannen…' : 'Scan nu'}
            </button>
          )}
        </div>
      </div>

      {scanMsg && (
        <div className="mb-4 text-[12px] px-3 py-2 rounded-lg bg-[#1B3A5C]/5 text-[#1B3A5C] border border-[#1B3A5C]/10">
          {scanMsg}
        </div>
      )}

      {/* KPI's */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Totaal SKU's online" value={NF.format(totals.total)} />
        <Kpi label="Met foto" value={NF.format(totals.withPhoto)} accent="#16a34a" />
        <Kpi label="Zonder foto" value={NF.format(totals.withoutPhoto)} accent="#dc2626" sub="prioriteit" />
        <Kpi label="Dekking" value={coverage != null ? `${coverage}%` : '—'} accent={coverageColor(coverage).bar} />
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] text-[#1B3A5C]/40 font-medium">Groeperen per:</span>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[12px]">
          {[['bum', 'BUM'], ['dept', 'Department']].map(([v, l]) => (
            <button key={v} onClick={() => { setGroupBy(v); setExpanded(null); }}
              className={`px-3 py-1.5 font-medium transition-all ${groupBy === v ? 'bg-[#1B3A5C] text-white' : 'text-[#1B3A5C]/60 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabel */}
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
                <th className="px-4 py-2.5 font-semibold w-[40%]">Dekking</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const c = coverageColor(g.coverage);
                const open = expanded === g.key;
                const detail = open ? detailFor(g.key) : [];
                return (
                  <>
                    <tr key={g.key} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-medium text-[#1B3A5C]">{g.label}</td>
                      <td className="px-4 py-2.5 text-right text-[#1B3A5C]/70">{NF.format(g.total)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${g.without > 0 ? 'text-red-600' : 'text-[#1B3A5C]/30'}`}>
                        {NF.format(g.without)}
                      </td>
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
                            className="text-[12px] text-[#1B3A5C]/60 hover:text-[#1B3A5C] font-medium">
                            {open ? 'Verberg' : 'Toon'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${g.key}-detail`}>
                        <td colSpan={5} className="bg-gray-50/60 px-4 py-3">
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
                                        <a href={m.product_url} target="_blank" rel="noopener noreferrer"
                                          className="text-[#1B3A5C] hover:underline font-medium">Bekijk →</a>
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
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-[#1B3A5C]/30 mt-3">
        Bron: building-depot.com (EZ-AD storefront). Foto-status komt uit het veld <code>has_image</code> van het product.
      </p>
    </div>
  );
}
