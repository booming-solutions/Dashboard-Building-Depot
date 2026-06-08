/* ============================================================
   BESTAND: page_hr_salary.js (V28.01)
   KOPIEER NAAR: src/app/dashboard/hr/salary/page.js
   (vervangt iframe-versie v27.03)

   DOEL: React Salariskosten dashboard met data uit Supabase.
   Vervangt de oude iframe naar /api/private/salary-dashboard.

   SCOPE V28.01:
   - Periode-selectie (dropdown alle beschikbare maanden)
   - KPI's: totale loonkost, FTE, headcount, kost/FTE
   - Per BU tabel + uitklapbare sub-afdelingen
   - Per categorie tabel
   - Trend per BU over alle maanden
   - Per-maand FTE via C16 snapshot + in/uit-dienst dates
   ============================================================ */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

const BU_ORDER = [
  'BU Hardware', 'BU Living', 'BU Sanitair/Keuken', 'BU Appliance/Houseware',
  'BU Building Materials', 'Smart Finance', 'Logistiek', 'Store Support', 'BU Kantoor'
];

const NL_MAANDEN = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];

const CAT_ORDER = [
  { key: 'bruto', label: 'Bruto salaris', color: '#0056a3' },
  { key: 'overwerk', label: 'Overuren', color: '#6e3bb8' },
  { key: 'toeslagen', label: 'Toeslagen', color: '#8b5e3c' },
  { key: 'vakantiegeld', label: 'Vakantiegeld', color: '#c47a2b' },
  { key: 'sociale_premies', label: 'Sociale premies', color: '#2a6b8a' },
  { key: 'pensioen', label: 'Pensioen', color: '#5a7d3a' },
  { key: 'ziekengeld', label: 'Ziekengeld', color: '#a33225' },
  { key: 'voorschotten', label: 'Voorschotten', color: '#9c978c' },
  { key: 'overig', label: 'Overig', color: '#6b6960' },
];

function formatBedrag(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatMaand(year, month) {
  return `${NL_MAANDEN[month - 1]}-${String(year).slice(-2)}`;
}

// Bepaal of een medewerker actief was op een peildatum
function isActiefOp(emp, peildatumISO) {
  if (!emp.in_dienst) return false;
  if (emp.in_dienst > peildatumISO) return false;
  if (emp.uit_dienst && emp.uit_dienst <= peildatumISO) return false;
  return true;
}

// Laatste dag van een maand (ISO)
function endOfMonth(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0));
  return lastDay.toISOString().substring(0, 10);
}

export default function SalaryDashboard() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const [payrollRows, setPayrollRows] = useState([]);
  const [empSnapshots, setEmpSnapshots] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(null); // 'YYYY-MM'
  const [expandedBUs, setExpandedBUs] = useState({});
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (!p || !['admin', 'finance', 'directie'].includes(p.role)) {
        router.push('/dashboard');
        return;
      }
      setAuthorized(true);
      setLoading(false);
      loadData();
    })();
  }, []);

  async function loadData() {
    setDataLoading(true);
    const [{ data: payroll }, { data: snaps }] = await Promise.all([
      supabase.from('payroll_journal').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false }),
      supabase.from('employee_snapshots').select('*').order('snapshot_date', { ascending: false }),
    ]);
    setPayrollRows(payroll || []);
    setEmpSnapshots(snaps || []);
    // Default periode = laatste beschikbare
    if (payroll && payroll.length > 0) {
      const latest = payroll[0];
      setSelectedPeriod(`${latest.period_year}-${String(latest.period_month).padStart(2, '0')}`);
    }
    setDataLoading(false);
  }

  // === DATA AGGREGATIES ===

  // Beschikbare periodes uit payroll_journal
  const availablePeriods = useMemo(() => {
    const set = new Set();
    payrollRows.forEach(r => {
      set.add(`${r.period_year}-${String(r.period_month).padStart(2, '0')}`);
    });
    return Array.from(set).sort().reverse();
  }, [payrollRows]);

  // Huidige periode parse
  const currentPeriod = useMemo(() => {
    if (!selectedPeriod) return null;
    const [y, m] = selectedPeriod.split('-').map(Number);
    return { year: y, month: m, label: formatMaand(y, m) };
  }, [selectedPeriod]);

  // Rows in huidige periode
  const rowsInPeriod = useMemo(() => {
    if (!currentPeriod) return [];
    return payrollRows.filter(r =>
      r.period_year === currentPeriod.year && r.period_month === currentPeriod.month
    );
  }, [payrollRows, currentPeriod]);

  // Vind de laatste C16 snapshot DIE BESCHIKBAAR is op of na het einde van de huidige periode
  // Logica: als we kijken naar april 2026 en we hebben snapshot 2026-05-31, gebruiken we die.
  // We filteren in/uit-dienst op 30 april om actieve mensen te bepalen.
  const activeSnapshot = useMemo(() => {
    if (!currentPeriod || empSnapshots.length === 0) return null;
    // Pak de meest recente snapshot
    return empSnapshots[0];
  }, [empSnapshots, currentPeriod]);

  // Actieve medewerkers op einde huidige periode
  const activeEmployees = useMemo(() => {
    if (!activeSnapshot || !currentPeriod) return [];
    const peildatum = endOfMonth(currentPeriod.year, currentPeriod.month);
    return empSnapshots
      .filter(e => e.snapshot_date === activeSnapshot.snapshot_date)
      .filter(e => isActiefOp(e, peildatum));
  }, [empSnapshots, activeSnapshot, currentPeriod]);

  // KPI's
  const kpis = useMemo(() => {
    const totalCost = rowsInPeriod.reduce((s, r) => s + (parseFloat(r.bedrag) || 0), 0);
    const headcount = activeEmployees.length;
    const fte = activeEmployees.reduce((s, e) => s + (parseFloat(e.fte) || 0), 0);
    const costPerFte = fte > 0 ? totalCost / fte : 0;
    return { totalCost, headcount, fte, costPerFte };
  }, [rowsInPeriod, activeEmployees]);

  // Per BU aggregatie (kost + FTE + per-sub-afdeling breakdown)
  const buBreakdown = useMemo(() => {
    const map = {};
    BU_ORDER.forEach(bu => {
      map[bu] = { bu, totalCost: 0, fte: 0, headcount: 0, subAfdelingen: {} };
    });
    rowsInPeriod.forEach(r => {
      if (!map[r.bu]) map[r.bu] = { bu: r.bu, totalCost: 0, fte: 0, headcount: 0, subAfdelingen: {} };
      map[r.bu].totalCost += parseFloat(r.bedrag) || 0;
      const subKey = r.hoofdafdeling || '(onbekend)';
      if (!map[r.bu].subAfdelingen[subKey]) {
        map[r.bu].subAfdelingen[subKey] = { name: subKey, totalCost: 0, headcount: 0, fte: 0 };
      }
      map[r.bu].subAfdelingen[subKey].totalCost += parseFloat(r.bedrag) || 0;
    });
    activeEmployees.forEach(e => {
      if (!map[e.bu]) map[e.bu] = { bu: e.bu, totalCost: 0, fte: 0, headcount: 0, subAfdelingen: {} };
      map[e.bu].headcount += 1;
      map[e.bu].fte += parseFloat(e.fte) || 0;
      const subKey = e.afdeling_raw || '(onbekend)';
      if (!map[e.bu].subAfdelingen[subKey]) {
        map[e.bu].subAfdelingen[subKey] = { name: subKey, totalCost: 0, headcount: 0, fte: 0 };
      }
      map[e.bu].subAfdelingen[subKey].headcount += 1;
      map[e.bu].subAfdelingen[subKey].fte += parseFloat(e.fte) || 0;
    });
    return Object.values(map)
      .filter(b => b.totalCost > 0 || b.headcount > 0)
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [rowsInPeriod, activeEmployees]);

  // Per categorie aggregatie
  const categoryBreakdown = useMemo(() => {
    const map = {};
    CAT_ORDER.forEach(c => { map[c.key] = { ...c, totalCost: 0 }; });
    rowsInPeriod.forEach(r => {
      const cat = r.categorie || 'overig';
      if (!map[cat]) {
        map[cat] = { key: cat, label: cat, color: '#9c978c', totalCost: 0 };
      }
      map[cat].totalCost += parseFloat(r.bedrag) || 0;
    });
    return Object.values(map).filter(c => c.totalCost > 0).sort((a, b) => b.totalCost - a.totalCost);
  }, [rowsInPeriod]);

  // Trend data per BU over alle beschikbare maanden
  const trendData = useMemo(() => {
    // Groepeer per periode (YYYY-MM)
    const periodMap = {};
    payrollRows.forEach(r => {
      const k = `${r.period_year}-${String(r.period_month).padStart(2, '0')}`;
      if (!periodMap[k]) periodMap[k] = { period: k, year: r.period_year, month: r.period_month, byBU: {} };
      const bu = r.bu;
      periodMap[k].byBU[bu] = (periodMap[k].byBU[bu] || 0) + (parseFloat(r.bedrag) || 0);
    });
    return Object.values(periodMap).sort((a, b) => a.period.localeCompare(b.period));
  }, [payrollRows]);

  if (loading) {
    return (
      <div style={{padding:40, textAlign:'center', color:'#9c978c', fontFamily:"'DM Sans',sans-serif"}}>
        Laden...
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={{maxWidth:1500, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:20, flexWrap:'wrap', gap:14}}>
        <div>
          <h1 style={{fontSize:22, fontWeight:700, margin:0}}>Salariskosten</h1>
          <p style={{fontSize:13, color:'#9c978c', margin:'4px 0 0'}}>
            Loonkosten + FTE per business unit. Data uit Celery (C4 + C16).
          </p>
        </div>
        <div>
          <label style={{display:'block', fontSize:10.5, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px', marginBottom:6}}>Periode</label>
          <select
            value={selectedPeriod || ''}
            onChange={e => setSelectedPeriod(e.target.value)}
            style={{padding:'8px 14px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:6, fontFamily:'inherit', fontSize:13, minWidth:160}}
          >
            {availablePeriods.map(p => {
              const [y, m] = p.split('-').map(Number);
              return <option key={p} value={p}>{formatMaand(y, m)}</option>;
            })}
          </select>
        </div>
      </div>

      {dataLoading ? (
        <div style={{padding:40, textAlign:'center', color:'#9c978c'}}>Data laden...</div>
      ) : availablePeriods.length === 0 ? (
        <div style={{background:'#fff3cd', border:'1px solid #856404', borderRadius:8, padding:'14px 18px', color:'#856404', fontSize:13}}>
          Nog geen loonkosten-data beschikbaar. Upload eerst Celery C4 bestanden via Admin → Salaris Import.
        </div>
      ) : !currentPeriod ? null : (
        <>
          {/* KPI's */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10, marginBottom:14}}>
            <KPIBlock label="Totale loonkost" value={'XCG ' + formatBedrag(kpis.totalCost)} sub={currentPeriod.label} color="#1a1a18" />
            <KPIBlock label="Headcount" value={kpis.headcount.toString()} sub={`einde ${currentPeriod.label}`} color="#0056a3" />
            <KPIBlock label="FTE" value={kpis.fte.toFixed(1)} sub={`einde ${currentPeriod.label}`} color="#2d6b3f" />
            <KPIBlock label="Kost / FTE" value={'XCG ' + formatBedrag(kpis.costPerFte)} sub={'per maand'} color="#6e3bb8" />
          </div>

          {!activeSnapshot && (
            <div style={{background:'#fff3cd', border:'1px solid #856404', borderRadius:8, padding:'10px 14px', color:'#856404', fontSize:12, marginBottom:14}}>
              ⚠ Geen C16 werknemers-snapshot beschikbaar. FTE en headcount kunnen niet berekend worden. Upload C16 via Admin → Salaris Import.
            </div>
          )}

          {/* Per BU tabel met uitklap */}
          <div style={{background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
            <h2 style={{fontSize:14, fontWeight:600, margin:'0 0 14px'}}>Per business unit · {currentPeriod.label}</h2>
            <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0, fontSize:12.5}}>
              <thead>
                <tr>
                  <th style={th()}>BU</th>
                  <th style={th('right')}>Loonkost</th>
                  <th style={th('right')}>% totaal</th>
                  <th style={th('right')}>Headcount</th>
                  <th style={th('right')}>FTE</th>
                  <th style={th('right')}>Kost/FTE</th>
                </tr>
              </thead>
              <tbody>
                {buBreakdown.map(b => {
                  const pct = kpis.totalCost > 0 ? (b.totalCost / kpis.totalCost * 100) : 0;
                  const costPerFte = b.fte > 0 ? b.totalCost / b.fte : 0;
                  const isExpanded = !!expandedBUs[b.bu];
                  const subs = Object.values(b.subAfdelingen).sort((a, b) => b.totalCost - a.totalCost);
                  return (
                    <>
                      <tr key={b.bu} style={{cursor:'pointer'}} onClick={() => setExpandedBUs(p => ({...p, [b.bu]: !p[b.bu]}))}>
                        <td style={{...td(), fontWeight:600}}>
                          <span style={{display:'inline-block', width:14, color:'#9c978c'}}>{isExpanded ? '−' : '+'}</span>
                          {b.bu}
                        </td>
                        <td style={td('right', '#1a1a18', true)}>{formatBedrag(b.totalCost)}</td>
                        <td style={td('right', '#9c978c')}>{pct.toFixed(1)}%</td>
                        <td style={td('right')}>{b.headcount || '-'}</td>
                        <td style={td('right')}>{b.fte > 0 ? b.fte.toFixed(1) : '-'}</td>
                        <td style={td('right', '#9c978c')}>{costPerFte > 0 ? formatBedrag(costPerFte) : '-'}</td>
                      </tr>
                      {isExpanded && subs.map((s, i) => {
                        const sCostPerFte = s.fte > 0 ? s.totalCost / s.fte : 0;
                        return (
                          <tr key={b.bu + '_' + i} style={{background:'#fafaf6'}}>
                            <td style={{...td(), paddingLeft:36, color:'#6b6960', fontSize:11.5}}>{s.name}</td>
                            <td style={td('right', '#6b6960')}>{formatBedrag(s.totalCost)}</td>
                            <td style={td('right', '#9c978c')}>—</td>
                            <td style={td('right', '#6b6960')}>{s.headcount || '-'}</td>
                            <td style={td('right', '#6b6960')}>{s.fte > 0 ? s.fte.toFixed(1) : '-'}</td>
                            <td style={td('right', '#9c978c')}>{sCostPerFte > 0 ? formatBedrag(sCostPerFte) : '-'}</td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{background:'#1a1a18', color:'#fff'}}>
                  <td style={{padding:'10px', fontWeight:700, fontSize:12}}>TOTAAL</td>
                  <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{formatBedrag(kpis.totalCost)}</td>
                  <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>100%</td>
                  <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{kpis.headcount}</td>
                  <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{kpis.fte.toFixed(1)}</td>
                  <td style={{padding:'10px', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontWeight:700}}>{formatBedrag(kpis.costPerFte)}</td>
                </tr>
              </tfoot>
            </table>
            <p style={{fontSize:11, color:'#9c978c', marginTop:8}}>Klik op een BU om sub-afdelingen te zien.</p>
          </div>

          {/* Per categorie tabel */}
          <div style={{background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
            <h2 style={{fontSize:14, fontWeight:600, margin:'0 0 14px'}}>Per categorie · {currentPeriod.label}</h2>
            <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0, fontSize:12.5}}>
              <thead>
                <tr>
                  <th style={th()}>Categorie</th>
                  <th style={th('right')}>Bedrag</th>
                  <th style={th('right')}>% totaal</th>
                  <th style={th('right')}>% bruto</th>
                </tr>
              </thead>
              <tbody>
                {categoryBreakdown.map(c => {
                  const bruto = categoryBreakdown.find(x => x.key === 'bruto')?.totalCost || 0;
                  const pctBruto = bruto > 0 ? (c.totalCost / bruto * 100) : 0;
                  const pctTotal = kpis.totalCost > 0 ? (c.totalCost / kpis.totalCost * 100) : 0;
                  return (
                    <tr key={c.key}>
                      <td style={td()}>
                        <span style={{display:'inline-block', width:10, height:10, background:c.color, borderRadius:2, marginRight:8, verticalAlign:'middle'}}></span>
                        {c.label}
                      </td>
                      <td style={td('right', '#1a1a18', true)}>{formatBedrag(c.totalCost)}</td>
                      <td style={td('right', '#9c978c')}>{pctTotal.toFixed(1)}%</td>
                      <td style={td('right', '#9c978c')}>{c.key === 'bruto' ? '—' : pctBruto.toFixed(1) + '%'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Trend per BU */}
          {trendData.length > 1 && (
            <div style={{background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
              <h2 style={{fontSize:14, fontWeight:600, margin:'0 0 14px'}}>Trend per BU</h2>
              <TrendChart data={trendData} />
            </div>
          )}

          <div style={{padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6, marginTop:14}}>
            <strong>Data-bronnen:</strong> Loonkosten uit Celery C4 - Loonjournaalpost · Headcount/FTE uit Celery C16 - Werknemerslijst (snapshot {activeSnapshot?.snapshot_date}). 
            FTE-berekening: deeltijdpercentage van actieve medewerkers op einde periode (= peildatum). 
            "Actief" = in dienst datum ≤ peildatum, en uit dienst datum leeg of > peildatum.
          </div>
        </>
      )}
    </div>
  );
}

function KPIBlock({label, value, sub, color}) {
  return (
    <div style={{background:'#fff', borderRadius:10, padding:'12px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
      <div style={{fontSize:10, fontWeight:600, textTransform:'uppercase', color:'#9c978c', letterSpacing:'.4px'}}>{label}</div>
      <div style={{fontSize:20, fontWeight:700, color, fontFamily:"'JetBrains Mono',monospace", marginTop:4}}>{value}</div>
      <div style={{fontSize:10.5, color:'#9c978c', marginTop:2}}>{sub}</div>
    </div>
  );
}

function TrendChart({data}) {
  // Bepaal alle BU's
  const allBUs = new Set();
  data.forEach(d => Object.keys(d.byBU).forEach(bu => allBUs.add(bu)));
  const buList = Array.from(allBUs).sort();
  const palette = ['#0056a3','#6e3bb8','#a33225','#2d6b3f','#856404','#8b5e3c','#5a7d3a','#c47a2b','#6b4c8a'];

  // Max waarde voor Y-as
  let maxVal = 0;
  data.forEach(d => {
    const total = Object.values(d.byBU).reduce((s, v) => s + v, 0);
    if (total > maxVal) maxVal = total;
  });
  maxVal = maxVal * 1.15 || 1;

  const w = 800;
  const h = 280;
  const padL = 60, padR = 20, padT = 20, padB = 50;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const xStep = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const xAt = i => padL + i * xStep;
  const yAt = v => padT + innerH * (1 - v / maxVal);

  return (
    <div style={{overflowX:'auto'}}>
      <svg width={w} height={h} style={{display:'block', minWidth:'100%'}}>
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map(fr => {
          const y = yAt(maxVal * fr);
          return (
            <g key={fr}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(0,0,0,0.06)" strokeDasharray={fr === 0 ? '' : '2 3'} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#9c978c" fontFamily="'JetBrains Mono',monospace">
                {formatBedrag(maxVal * fr)}
              </text>
            </g>
          );
        })}
        {/* Lijnen per BU */}
        {buList.map((bu, i) => {
          const color = palette[i % palette.length];
          const points = data.map((d, idx) => {
            const v = d.byBU[bu] || 0;
            return `${xAt(idx)},${yAt(v)}`;
          }).join(' ');
          return (
            <g key={bu}>
              <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
              {data.map((d, idx) => {
                const v = d.byBU[bu] || 0;
                return (
                  <circle key={idx} cx={xAt(idx)} cy={yAt(v)} r={3} fill={color}>
                    <title>{`${bu} · ${d.period}: ${formatBedrag(v)}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
        {/* X-as labels */}
        {data.map((d, idx) => (
          <text key={idx} x={xAt(idx)} y={h - padB + 14} textAnchor="middle" fontSize="10" fill="#6b6960" fontFamily="'JetBrains Mono',monospace">
            {formatMaand(d.year, d.month)}
          </text>
        ))}
      </svg>
      {/* Legende */}
      <div style={{display:'flex', flexWrap:'wrap', gap:14, marginTop:10, fontSize:11, color:'#6b6960'}}>
        {buList.map((bu, i) => {
          const color = palette[i % palette.length];
          return (
            <div key={bu} style={{display:'flex', alignItems:'center', gap:5}}>
              <div style={{width:14, height:3, background:color}}></div>
              <span>{bu}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function th(align = 'left', color = '#9c978c') {
  return {position:'sticky', top:0, background:'#fff', padding:'10px 8px', borderBottom:'2px solid rgba(0,0,0,0.14)', fontSize:10, textTransform:'uppercase', letterSpacing:'.4px', color, fontWeight:600, textAlign:align};
}
function td(align = 'left', color = '#1a1a18', bold = false) {
  return {padding:'8px', borderBottom:'1px solid rgba(0,0,0,0.05)', fontFamily: align === 'right' ? "'JetBrains Mono',monospace" : 'inherit', fontSize:12, color, fontWeight: bold ? 600 : 400, textAlign:align};
}
