/* ============================================================
   BESTAND: StockRiskShared_v12.js
   KOPIEER NAAR: src/components/StockRiskShared.js
   (vervangt de huidige StockRiskShared.js)
   VERSIE: v3.28.30

   Wijzigingen t.o.v. v12 (v3.28.29):
   - BUGFIX: dropdown "Alle Afdelingen" toonde alleen dept-codes,
     geen namen (bv. "52 —" ipv "52 — TUINGEREEDSCHAP").
     Oorzaak: bij aggregatie werd dept_name overgenomen van de EERSTE
     rij per item. Nieuwe AI Voorraden exports vullen dept_name niet
     consistent per rij, dus soms had de eerste rij een lege naam.
     Fix: bij aggregatie én in depts-dropdown pakken we nu de eerste
     niet-lege dept_name in plaats van de eerste die we tegenkomen.

   Wijzigingen t.o.v. v11:
   - NIEUW: Stock Predictor slider bovenaan de tabel
     · Slider 0-13 weken (0 tot ~3 maanden), stap 1 week, default 12w
     · Nieuwe kolom "Voorraad +Xw" in detail-tabel toont voorspelde
       voorraad op geselecteerde horizon
     · Formule: QOH nu − (avg_monthly × weken/4.33) + som(PO's met
       ETA in de toekomst t/m horizon-datum)
     · Kleurcodering achtergrond:
       · Rood:   projected ≤ 0 (voorraad op)
       · Oranje: projected > 0 en < 25% van huidige QOH
       · Groen:  overig (voldoende voorraad)
     · Sortable, tooltip toont breakdown
     · Excel-export bevat de kolom "Voorraad +Xw"
   - avg_monthly telt maanden zonder verkoop niet mee (was al zo)

   Wijzigingen t.o.v. v10:
   - Dept 12 wordt samengevoegd met 11 (bij omzet al gebeurd, nu ook
     bij voorraad). Via shared helper @/lib/dept-merge.
   - Vereist nieuwe file: src/lib/dept-merge.js

   Wijzigingen t.o.v. v9:
   - Nieuwe kolom MFG# tussen Dept en Item in detail-tabel
     · Sortable
     · Toont fabrikant-artikelnummer (uit nieuwe buying_data.mfg_part_number)
     · Tooltip bij hover toont volledige MFG Part #
   - Vereist: SQL "ALTER TABLE buying_data ADD COLUMN mfg_part_number text;"
   - Vereist: route_email_v23 die de "MFG Part #" kolom uitleest
   - Excel-export: MFG# kolom toegevoegd
   - Tabel min-width 1400 → 1500px (voor extra kolom)
   - Groep-header "Item" colSpan 4 → 5
   - TOTAAL rij colSpan 4 → 5
   - Empty state colSpan 16/18 → 17/19
   - BUGFIX: ETA en PO tooltips toonden datum 1 dag te vroeg.
     Oorzaak: new Date('2026-06-08') → UTC midnight, daarna
     .getDate() in lokale Curaçao-tijd (UTC-4) = 7. Nu gebruik
     ik consequent getUTCDate/UTCMonth/UTCFullYear voor PO datums.
     De "isPast" check vergelijkt nu ook in UTC.
   - BUGFIX: bestelwaarde (suggested_value) was 0 voor items met
     negatieve QOH. Oorzaak: cost berekening gebruikte conditie
     m.qoh > 0 (sloeg negatieve voorraad over). Fix: absolute
     waarden gebruiken: cost = |inv_value| / |qoh|.
     Voorbeeld: MI2090891 qoh=-3, inv_value=-6,99 → cost=2,33/stk,
     28 stuks bestellen → waarde 65,21 (was 0).
   - NIEUW: "Inkoopvoorstel per Leverancier" sectie naast Risico per
     Afdeling (2-koloms layout).
     · Aggregeert items met suggested_qty>0 per vendor
     · Drempel-input (default XCG 25k) + quick-toggle 10k/25k/50k/100k
     · Sortable kolommen (Leverancier / Items / Qty / Waarde)
     · Default: bestelwaarde aflopend
     · Klik +/− om items per vendor uit te klappen (item, MFG#,
       omschrijving, qty, waarde)
     · Totaal-rij onder de lijst

   Wijzigingen t.o.v. v8:
   - BUGFIX: BU-folder namen (HARDWARE, LIVING, etc) worden nu correct
     gemapt naar BUM (JOHN, GIJS) zodat buying_data filter werkt
     · APPLIANCES-HOUSEWARE → DANIEL
     · BUILDING-MATERIALS → PASCAL
     · HARDWARE → JOHN
     · LIVING → GIJS
     · SANITAIR-KEUKENS → HENK
   - NOS Voorraad-status grafiek: bij ingezoomd op BUM (bumFilter actief)
     toont nu per afdeling (dept_code) in plaats van per BUM
     · Label: "20 — DEPT NAME" formaat
     · Sortering: oplopend op dept_code
     · Data: live uit items (geen snapshot nodig)
   - NOS Trend grafiek: bij ingezoomd op BUM toont nu lijnen per dept
     · Data uit nieuwe tabel nos_coverage_snapshots_dept
     · Tot er meerdere snapshots zijn: toont placeholder
     · Vereist eerst route_email_v22 deploy + SQL voor dept-tabel
   - Risico per Afdeling tabel: nu sortable per kolom
     · Default: oplopend op dept-code
     · Klikbare kolomheaders: Afdeling / Risico-verdeling / Kritiek+Urgent
     · ALLE afdelingen worden getoond (was: alleen met critical+urgent > 0)
     · Afdelingen zonder kritieke/urgente items tonen "OK" badge

   Wijzigingen t.o.v. v7:
   - NOS Trend grafiek: y-as begint op laagste waarneming
     afgerond naar 5-tallen (was vast op 0-100%)

   Wijzigingen t.o.v. v5:
   - Nieuwe feature: PO (purchase order) delivery info per item
     · Twee nieuwe kolommen rechts van QOO:
       "Volgende ETA" (datum, rood als in verleden)
       "Aantal" (qty op die ETA)
     · Tooltip op QOO cel: lijst van alle openstaande PO's
   - Sticky tabel-header bij scrollen

   Wijzigingen t.o.v. v4:
   - BUGFIX: lead time werd uit kolom 'max_lead_time' gehaald, maar
     die kolom is in Compass verkeerd gelabeld (was bedoeld als
     doel-voorraad). Werkelijke transit-tijd staat in 'min_lead_time'.
   - UI kolom 'Max Lead Time' hernoemd naar 'Lead Time'
   - BUGFIX: Excel-export filename gebruikte 'selBum' variabele die
     niet bestond. Vervangen door bumFilter (prop).
   ============================================================ */
'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { createClient } from '@/lib/supabase';
import { mergeDeptElevenTwelve } from '@/lib/dept-merge';
import LoadingLogo from '@/components/LoadingLogo';
import ExcelExportButton from '@/components/ExcelExportButton';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var fmt = function(n) { return (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
var fmtC = function(n) { return 'Cg ' + (n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var fmtK = function(n) { var a = Math.abs(n || 0); return (n < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : fmt(a)); };
var XCG_USD = 1.82;
var BU_ORDER = ['PASCAL', 'HENK', 'JOHN', 'DANIEL', 'GIJS'];

// Color palette per BUM (used in trend chart legend)
var BUM_COLORS = {
  PASCAL: '#1B3A5C',
  HENK:   '#0891b2',
  JOHN:   '#16a34a',
  DANIEL: '#a16207',
  GIJS:   '#7c3aed',
  TOTAL:  '#E84E1B',
};

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

function RiskBadge({ level }) {
  if (level === 'critical') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">KRITIEK</span>;
  if (level === 'urgent') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700">URGENT</span>;
  if (level === 'watch') return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">AANDACHT</span>;
  return <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700">OK</span>;
}

function CoverBar({ months, maxLT }) {
  var maxDisplay = Math.max(maxLT * 2, 6);
  var coverPct = Math.min((months / maxDisplay) * 100, 100);
  var ltPct = Math.min((maxLT / maxDisplay) * 100, 100);
  var barColor = months < 1 ? '#dc2626' : months < maxLT ? '#f97316' : months < maxLT * 1.5 ? '#d97706' : '#16a34a';
  return (
    <div className="relative h-[14px] w-[80px] bg-[#f0ebe5] rounded-sm overflow-hidden">
      <div className="absolute top-0 bottom-0 rounded-sm" style={{ width: coverPct + '%', backgroundColor: barColor, zIndex: 1 }}></div>
      <div className="absolute top-0 bottom-0 w-[2px] bg-[#1B3A5C]/60" style={{ left: ltPct + '%', zIndex: 2 }} title={'Lead time: ' + maxLT + ' mnd'}></div>
    </div>
  );
}

function Spark({ sales }) {
  var MN2 = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  var max = Math.max.apply(null, sales.concat([1]));
  var now = new Date();
  var labels = sales.map(function(v, i) {
    var monthsBack = sales.length - 1 - i;
    var d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return MN2[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  });
  return (
    <div className="flex items-end gap-px h-[18px]">
      {sales.map(function(v, i) {
        var h = max > 0 ? Math.max(1, (v / max) * 18) : 1;
        return <div key={i} className="w-[4px] rounded-t-sm cursor-default" style={{ height: h + 'px', backgroundColor: v > 0 ? '#E84E1B' : '#e5ddd4' }} title={labels[i] + ': ' + fmt(Math.round(v))}></div>;
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   NEW: NOS Stacked Bar (per BUM of per Dept als bumFilter is gezet)
   ════════════════════════════════════════════════════════════ */
function NosStackedBar({ snapshotsToday, store, bumFilter, items }) {
  // store: 'all' (=> Total), '1' (=> Curacao), 'B' (=> Bonaire)
  var region = store === '1' ? 'Curacao' : store === 'B' ? 'Bonaire' : 'Total';
  var deptMode = !!bumFilter;
  var rows;

  if (deptMode) {
    // Per-dept rendering: bouw rijen uit live items (al gefilterd op BUM)
    // We tellen NOS items per dept_code en classificeren in_stock / refilling / uncovered
    var nosItems = (items || []).filter(function(m) { return m.nos; });
    var byDept = {};
    nosItems.forEach(function(m) {
      var dc = String(m.dept_code || '').trim();
      if (!dc) return;
      if (!byDept[dc]) {
        byDept[dc] = {
          dept_code: dc, dept_name: m.dept_name || '',
          total: 0, in_stock: 0, refilling: 0, uncovered: 0,
        };
      }
      byDept[dc].total += 1;
      if (m.qoh > 0) byDept[dc].in_stock += 1;
      else if (m.qoh + m.qoo > 0) byDept[dc].refilling += 1;
      else byDept[dc].uncovered += 1;
    });
    rows = Object.values(byDept).sort(function(a, b) {
      return (parseInt(a.dept_code) || 0) - (parseInt(b.dept_code) || 0);
    });
  } else {
    // Per-BUM rendering (origineel)
    rows = snapshotsToday.filter(function(s) {
      return s.region === region && s.bum !== 'TOTAL';
    });
    rows.sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a.bum); var bi = BU_ORDER.indexOf(b.bum);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.bum.localeCompare(b.bum);
    });
  }

  var title = deptMode ? 'NOS Voorraad-status per Afdeling' : 'NOS Voorraad-status per BUM';

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
        <h3 className="text-[15px] font-bold mb-1">{title}</h3>
        <p className="text-[12px] text-[#6b5240] mb-3">Nog geen data beschikbaar.</p>
      </div>
    );
  }

  var regionLabel = region === 'Total' ? 'Curaçao + Bonaire' : region;

  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
      <h3 className="text-[15px] font-bold mb-1">{title}</h3>
      <p className="text-[12px] text-[#6b5240] mb-3">{regionLabel} — % van NOS-items per categorie</p>
      <div className="flex items-center gap-4 text-[10px] mb-4">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> Op voorraad (QOH &gt; 0)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> Wordt aangevuld (QOO compenseert)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Niet gedekt</span>
      </div>
      <div className="space-y-2">
        {rows.map(function(r) {
          var total = (deptMode ? r.total : r.total_nos_items) || 1;
          var inStock = deptMode ? r.in_stock : r.in_stock;
          var refilling = deptMode ? r.refilling : r.refilling;
          var uncovered = deptMode ? r.uncovered : r.uncovered;
          var pIn = (inStock / total) * 100;
          var pRef = (refilling / total) * 100;
          var pUnc = (uncovered / total) * 100;
          var label = deptMode ? (r.dept_code + (r.dept_name ? ' — ' + r.dept_name : '')) : r.bum;
          var rowKey = deptMode ? r.dept_code : r.bum;
          return (
            <div key={rowKey} className="flex items-center gap-2">
              <div className={(deptMode ? 'w-[180px]' : 'w-[80px]') + ' text-right text-[11px] font-semibold text-[#1a0a04] flex-shrink-0 truncate'} title={label}>
                {label}
              </div>
              <div className="flex-1 flex h-[20px] rounded-sm overflow-hidden bg-[#f0ebe5] relative">
                {pIn > 0 && (
                  <div
                    style={{ width: pIn + '%', backgroundColor: '#16a34a' }}
                    title={'Op voorraad: ' + inStock + ' items (' + pIn.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pIn > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pIn) + '%'}</span>}
                  </div>
                )}
                {pRef > 0 && (
                  <div
                    style={{ width: pRef + '%', backgroundColor: '#d97706' }}
                    title={'Wordt aangevuld: ' + refilling + ' items (' + pRef.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pRef > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pRef) + '%'}</span>}
                  </div>
                )}
                {pUnc > 0 && (
                  <div
                    style={{ width: pUnc + '%', backgroundColor: '#dc2626' }}
                    title={'Niet gedekt: ' + uncovered + ' items (' + pUnc.toFixed(1) + '%)'}
                    className="flex items-center justify-center"
                  >
                    {pUnc > 10 && <span className="text-[10px] text-white font-bold">{Math.round(pUnc) + '%'}</span>}
                  </div>
                )}
              </div>
              <div className="w-[60px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">
                {fmt(total)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   NEW: NOS Trend Chart (% in stock over time per BUM, of per Dept bij BUM-filter)
   ════════════════════════════════════════════════════════════ */
function NosTrendChart({ allSnapshots, deptSnapshots, store, bumFilter }) {
  var deptMode = !!bumFilter;
  var canvasId = 'nos-trend-chart-' + (store || 'all') + (deptMode ? '-dept' : '');
  var region = store === '1' ? 'Curacao' : store === 'B' ? 'Bonaire' : 'Total';

  // Filter for this region. In deptMode gebruiken we deptSnapshots (per dept_code),
  // anders allSnapshots (per BUM).
  var sourceRows;
  if (deptMode) {
    sourceRows = (deptSnapshots || []).filter(function(s) { return s.region === region; });
  } else {
    sourceRows = allSnapshots.filter(function(s) { return s.region === region; });
  }

  // Group by date -> { groupKey: pct } waar groupKey = dept_code of bum
  var byDate = {};
  sourceRows.forEach(function(r) {
    if (!byDate[r.snapshot_date]) byDate[r.snapshot_date] = {};
    var pct = r.total_nos_items > 0 ? (r.in_stock / r.total_nos_items * 100) : 0;
    var key = deptMode ? r.dept_code : r.bum;
    byDate[r.snapshot_date][key] = pct;
  });
  var dates = Object.keys(byDate).sort();

  // Compute TOTAL line per date — gewogen gemiddelde over de hele filter (BUM of regio)
  var totalsByDate = {};
  dates.forEach(function(d) {
    var sumIn = 0, sumTot = 0;
    sourceRows.filter(function(r) { return r.snapshot_date === d; }).forEach(function(r) {
      sumIn += r.in_stock; sumTot += r.total_nos_items;
    });
    totalsByDate[d] = sumTot > 0 ? (sumIn / sumTot * 100) : 0;
  });

  // Lijst van groepen: BUMs of dept_codes
  var groupSet = {};
  sourceRows.forEach(function(r) {
    var key = deptMode ? r.dept_code : r.bum;
    if (key) groupSet[key] = true;
  });
  var groupList;
  if (deptMode) {
    // Sorteer dept_codes oplopend numeriek
    groupList = Object.keys(groupSet).sort(function(a, b) {
      return (parseInt(a) || 0) - (parseInt(b) || 0);
    });
  } else {
    groupList = Object.keys(groupSet).sort(function(a, b) {
      var ai = BU_ORDER.indexOf(a); var bi = BU_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  // dept_name lookup voor labels (uit laatste snapshot per dept_code)
  var deptNameLookup = {};
  if (deptMode) {
    sourceRows.forEach(function(r) { if (r.dept_name) deptNameLookup[r.dept_code] = r.dept_name; });
  }

  // Palette voor dept lines (rotating). Voor BUMs gebruiken we BUM_COLORS.
  var DEPT_PALETTE = ['#1B3A5C', '#E84E1B', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0284c7', '#ea580c', '#15803d'];

  useEffect(function() {
    var existing = window['_nosChart_' + canvasId];
    if (existing) { existing.destroy(); }
    if (dates.length === 0) return;
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var datasets = groupList.map(function(g, idx) {
      var label = deptMode
        ? g + (deptNameLookup[g] ? ' — ' + deptNameLookup[g] : '')
        : g;
      var color = deptMode
        ? DEPT_PALETTE[idx % DEPT_PALETTE.length]
        : (BUM_COLORS[g] || '#888');
      return {
        label: label,
        data: dates.map(function(d) { return byDate[d][g] != null ? Math.round(byDate[d][g] * 10) / 10 : null; }),
        borderColor: color,
        backgroundColor: 'transparent',
        pointRadius: 3,
        tension: 0.25,
        borderWidth: 2,
        spanGaps: true,
      };
    });

    // TOTAAL line
    datasets.push({
      label: 'TOTAAL',
      data: dates.map(function(d) { return Math.round(totalsByDate[d] * 10) / 10; }),
      borderColor: BUM_COLORS.TOTAL || '#1B3A5C',
      backgroundColor: 'transparent',
      borderDash: [6, 3],
      pointRadius: 4,
      tension: 0.25,
      borderWidth: 3,
    });

    var labels = dates.map(function(d) {
      var p = d.split('-');
      return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1];
    });

    // Bereken laagste waarde over alle datasets, rond af naar beneden op 5-tallen
    var allValues = [];
    datasets.forEach(function(ds) {
      ds.data.forEach(function(v) { if (v != null && !isNaN(v)) allValues.push(v); });
    });
    var yMin = 0;
    if (allValues.length > 0) {
      var minVal = Math.min.apply(null, allValues);
      yMin = Math.max(0, Math.floor(minVal / 5) * 5);
      if (yMin > 95) yMin = 95;
    }

    window['_nosChart_' + canvasId] = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + (c.raw != null ? c.raw + '%' : '—'); } } },
        },
        scales: {
          y: {
            min: yMin, max: 100,
            ticks: { callback: function(v) { return v + '%'; } },
            grid: { color: '#f0ebe5' },
          },
          x: { grid: { display: false } },
        },
      },
    });

    return function() {
      var c = window['_nosChart_' + canvasId];
      if (c) { c.destroy(); window['_nosChart_' + canvasId] = null; }
    };
  }, [allSnapshots, deptSnapshots, store, bumFilter]);

  var regionLabel = region === 'Total' ? 'Curaçao + Bonaire' : region;
  var subtitle = deptMode
    ? regionLabel + ' — per afdeling, plus TOTAAL (gestreept)'
    : regionLabel + ' — per BUM, plus TOTAAL (gestreept)';

  return (
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
      <h3 className="text-[15px] font-bold mb-1">% NOS op voorraad — verloop in tijd</h3>
      <p className="text-[12px] text-[#6b5240] mb-3">{subtitle}</p>
      {dates.length === 0 ? (
        <div className="py-8 text-center bg-[#faf7f4] rounded-lg">
          <p className="text-[12px] text-[#6b5240]">Nog geen snapshots beschikbaar.</p>
          <p className="text-[10px] text-[#a08a74] mt-1 italic">Lijn verschijnt zodra er meer dan één snapshot is.</p>
        </div>
      ) : dates.length === 1 ? (
        <div className="py-6 text-center bg-[#faf7f4] rounded-lg">
          <p className="text-[12px] text-[#6b5240]">Eerste snapshot: {(function() { var p = dates[0].split('-'); return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1] + ' ' + p[0]; })()}</p>
          <p className="text-[10px] text-[#a08a74] mt-1 italic">Trendlijn verschijnt zodra er meer snapshots zijn.</p>
        </div>
      ) : (
        <div style={{ height: '300px' }}>
          <canvas id={canvasId}></canvas>
        </div>
      )}
    </div>
  );
}

// bumFilter: null = all BUMs (totaal), 'PASCAL' = only PASCAL, etc.
// NEW v9: accepteert ook BU folder-namen (bv. 'HARDWARE', 'BUILDING_MATERIALS')
// en mapt die naar de daadwerkelijke BUM in buying_data ('JOHN', 'PASCAL').
// Ondersteunt zowel underscore (BUILDING_MATERIALS) als dash (BUILDING-MATERIALS).
var BU_TO_BUM = {
  'APPLIANCES_HOUSEWARE': 'DANIEL',
  'APPLIANCES-HOUSEWARE': 'DANIEL',
  'BUILDING_MATERIALS': 'PASCAL',
  'BUILDING-MATERIALS': 'PASCAL',
  'HARDWARE': 'JOHN',
  'LIVING': 'GIJS',
  'SANITAIR_KEUKENS': 'HENK',
  'SANITAIR-KEUKENS': 'HENK',
};
function resolveBum(filter) {
  if (!filter) return null;
  var up = String(filter).toUpperCase();
  return BU_TO_BUM[up] || up;
}

export default function StockRiskShared({ bumFilter }) {
  // Vertaal de doorgegeven prop (kan BU-folder-naam of directe BUM zijn) naar BUM
  bumFilter = resolveBum(bumFilter);
  var _s = useState;
  var _d = _s([]), data = _d[0], setData = _d[1];
  var _lo = _s(true), loading = _lo[0], setLoading = _lo[1];
  var _upd = _s(null), lastUpdate = _upd[0], setLastUpdate = _upd[1];
  var _store = _s('all'), store = _store[0], setStore = _store[1];
  var _dept = _s('all'), dept = _dept[0], setDept = _dept[1];
  var _vendor = _s('all'), vendor = _vendor[0], setVendor = _vendor[1];
  var _filter = _s('urgent'), filter = _filter[0], setFilter = _filter[1];
  var _nos = _s('all'), nosFilter = _nos[0], setNosFilter = _nos[1];
  var _qoh = _s('all'), qohFilter = _qoh[0], setQohFilter = _qoh[1];
  var _sort = _s('months_cover'), sortCol = _sort[0], setSortCol = _sort[1];
  var _dir = _s('asc'), sortDir = _dir[0], setSortDir = _dir[1];
  // NEW v9: sort state voor Risico per Afdeling tabel (default oplopend op dept-code)
  var _deptSort = _s('code'), deptSortCol = _deptSort[0], setDeptSortCol = _deptSort[1];
  var _deptSortDir = _s('asc'), deptSortDir = _deptSortDir[0], setDeptSortDir = _deptSortDir[1];
  // NEW v10: vendor purchase suggestion sectie
  var _vThresh = _s(25000), vendorThreshold = _vThresh[0], setVendorThreshold = _vThresh[1];
  var _vSort = _s('value'), vendorSortCol = _vSort[0], setVendorSortCol = _vSort[1];
  var _vSortDir = _s('desc'), vendorSortDir = _vSortDir[0], setVendorSortDir = _vSortDir[1];
  var _vExp = _s({}), expandedVendors = _vExp[0], setExpandedVendors = _vExp[1];
  var _rows = _s(100), tableRows = _rows[0], setTableRows = _rows[1];
  var _search = _s(''), search = _search[0], setSearch = _search[1];

  // NEW: NOS coverage snapshots
  var _nosSnap = _s([]), nosSnapshots = _nosSnap[0], setNosSnapshots = _nosSnap[1];
  // NEW v9: dept-level NOS snapshots (alleen geladen als bumFilter actief is)
  var _deptSnap = _s([]), deptSnapshots = _deptSnap[0], setDeptSnapshots = _deptSnap[1];

  // PO deliveries: per item_number lijst van { po, date, qty }, gesorteerd op datum
  var _po = _s({}), poByItem = _po[0], setPoByItem = _po[1];
  // NEW v12: stock predictor slider — horizon in weken (0-13, default 12 ≈ 3 maanden)
  var _horizon = _s(12), projHorizonWeeks = _horizon[0], setProjHorizonWeeks = _horizon[1];

  var supabase = createClient();
  useEffect(function() { loadData(); loadNosSnapshots(); loadDeptSnapshots(); loadPoDeliveries(); }, [bumFilter]);

  async function loadData() {
    setLoading(true);
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('buying_data').select('*').order('item_number').range(from, from + step - 1);
      if (bumFilter) q = q.eq('bum', bumFilter);
      var r = await q;
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    if (all.length && all[0].upload_date) {
      var dates = all.map(function(r) { return r.upload_date; }).filter(Boolean);
      dates.sort();
      setLastUpdate(dates[dates.length - 1]);
    }
    setData(mergeDeptElevenTwelve(all)); setLoading(false);
  }

  async function loadNosSnapshots() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('nos_coverage_snapshots').select('*').order('snapshot_date', { ascending: true }).range(from, from + step - 1);
      if (bumFilter) q = q.eq('bum', bumFilter);
      var r = await q;
      if (r.error) { console.error('NOS snapshots load error:', r.error.message); break; }
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setNosSnapshots(all);
  }

  // NEW v9: laad dept-level NOS snapshots, alleen relevant als bumFilter actief is
  async function loadDeptSnapshots() {
    if (!bumFilter) {
      setDeptSnapshots([]);
      return;
    }
    var all = [], from = 0, step = 1000;
    while (true) {
      var q = supabase.from('nos_coverage_snapshots_dept')
        .select('*')
        .eq('bum', bumFilter)
        .order('snapshot_date', { ascending: true })
        .range(from, from + step - 1);
      var r = await q;
      if (r.error) { console.error('NOS dept snapshots load error:', r.error.message); break; }
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setDeptSnapshots(all);
  }

  // Laad PO deliveries: alle verwachte leveringen per item
  // Bouwt een lookup map per item_number → gesorteerde lijst van { po, date, qty }
  async function loadPoDeliveries() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('po_deliveries')
        .select('po_number, item_number, date_expected, qty_expected')
        .order('date_expected', { ascending: true })
        .range(from, from + step - 1);
      if (r.error) { console.error('PO deliveries load error:', r.error.message); break; }
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    var map = {};
    all.forEach(function(p) {
      if (!map[p.item_number]) map[p.item_number] = [];
      map[p.item_number].push({
        po: p.po_number,
        date: p.date_expected,
        qty: parseFloat(p.qty_expected) || 0,
      });
    });
    // Lijst per item is al gesorteerd op datum door de query
    setPoByItem(map);
  }

  // Latest snapshot date
  var latestNosDate = useMemo(function() {
    if (!nosSnapshots.length) return null;
    return nosSnapshots.reduce(function(max, s) { return s.snapshot_date > max ? s.snapshot_date : max; }, nosSnapshots[0].snapshot_date);
  }, [nosSnapshots]);
  var todaysNosSnapshots = useMemo(function() {
    return nosSnapshots.filter(function(s) { return s.snapshot_date === latestNosDate; });
  }, [nosSnapshots, latestNosDate]);

  /* Compute risk per item */
  var items = useMemo(function() {
    if (!data.length) return [];

    var filtered = data;
    // FIX: filter op regio (CUR/BON) i.p.v. store_number
    // Sinds buying-pipeline v17 is store_number leeg en regio gevuld
    if (store === '1') filtered = data.filter(function(r) { return r.regio === 'CUR'; });
    else if (store === 'B') filtered = data.filter(function(r) { return r.regio === 'BON'; });

    var map = {};
    filtered.forEach(function(r) {
      var key = r.item_number;
      var isBon = r.regio === 'BON';
      var cFactor = isBon ? XCG_USD : 1;
      if (!map[key]) {
        map[key] = {
          item: r.item_number, desc: r.item_description,
          mfg: r.mfg_part_number || '',
          dept_code: r.dept_code, dept_name: r.dept_name,
          bum: r.bum || '', vendor: r.vendor_name || 'ONBEKEND',
          nos: r.nos === 'N',
          // Lead time = transit-tijd van leverancier naar magazijn.
          // Compass labelt dit als 'Min Lead Time' (Eagle Vendor Code 3).
          // 'Max Lead Time' in Compass is verkeerd gelabeld (was bedoeld als
          // doel-voorraad) en wordt hier niet gebruikt.
          min_lt: parseFloat(r.min_lead_time) || 0,
          qoh: 0, qa: 0, qoo: 0, inv_value: 0,
          // Per regio splits (gebruikt bij 'Alle' tab voor QOH/QOO uitsplitsing)
          qoh_cur: 0, qoh_bon: 0, qoo_cur: 0, qoo_bon: 0,
          sales: [0,0,0,0,0,0,0,0,0,0,0,0],
        };
      }
      var m = map[key];
      // mfg_part_number: pak eerste niet-lege waarde (kan per store verschillen, meestal niet)
      if (!m.mfg && r.mfg_part_number) m.mfg = r.mfg_part_number;
      // v12.1 fix: dept_name kan leeg zijn in sommige rijen (nieuwe AI Voorraden
      // exports vullen dept_name niet consistent per rij). Pak eerste niet-lege waarde.
      if (!m.dept_name && r.dept_name) m.dept_name = r.dept_name;
      // Lead time: nemen we het maximum (worst case) over stores binnen regio
      var rlt = parseFloat(r.min_lead_time) || 0;
      if (rlt > m.min_lt) m.min_lt = rlt;
      var qohVal = parseFloat(r.qoh) || 0;
      var qooVal = parseFloat(r.qty_on_order) || 0;
      m.qoh += qohVal;
      m.qa += parseFloat(r.qty_available) || 0;
      m.qoo += qooVal;
      m.inv_value += (parseFloat(r.inv_value_at_cost) || 0) * cFactor;
      // Per regio bijhouden
      if (r.regio === 'CUR') { m.qoh_cur += qohVal; m.qoo_cur += qooVal; }
      else if (r.regio === 'BON') { m.qoh_bon += qohVal; m.qoo_bon += qooVal; }
      for (var i = 0; i < 12; i++) {
        m.sales[i] += parseFloat(r['sales_m' + String(i + 1).padStart(2, '0')]) || 0;
      }
    });

    var list = Object.values(map);

    list.forEach(function(m) {
      // Cost per stuk: gebruik absolute waarden zodat ook items met
      // negatieve QOH (en daarmee negatieve inv_value_at_cost) een
      // correcte unit cost opleveren. Voorbeeld: qoh=-3, inv_value=-6,99
      // → cost = 6,99 / 3 = 2,33 per stuk.
      m.cost = m.qoh !== 0 ? Math.abs(m.inv_value) / Math.abs(m.qoh) : 0;
      m.salesChrono = m.sales.slice().reverse();

      var nonZero = m.sales.filter(function(s) { return s > 0; });
      m.avg_monthly = nonZero.length ? nonZero.reduce(function(a, b) { return a + b; }, 0) / nonZero.length : 0;
      m.active_months = nonZero.length;

      // Lead time fallback: 3 maanden als min_lt onbekend is
      m.lead_time = m.min_lt > 0 ? m.min_lt : 3;

      m.available = m.qoh + m.qoo;
      m.months_cover = m.avg_monthly > 0 ? m.available / m.avg_monthly : (m.available > 0 ? 99 : 0);

      if (m.avg_monthly <= 0) {
        m.risk = 'ok';
      } else if (m.months_cover < 1) {
        m.risk = 'critical';
      } else if (m.months_cover < m.lead_time) {
        m.risk = 'urgent';
      } else if (m.months_cover < m.lead_time * 1.5) {
        m.risk = 'watch';
      } else {
        m.risk = 'ok';
      }

      m.stockout_months = m.avg_monthly > 0 ? m.qoh / m.avg_monthly : 99;
      m.value_at_risk = (m.risk === 'critical' || m.risk === 'urgent') ? m.inv_value : 0;

      if (m.risk === 'critical' || m.risk === 'urgent') {
        var target = m.avg_monthly * (m.lead_time + 1);
        m.suggested_qty = Math.max(0, Math.round(target - m.available));
        m.suggested_value = m.suggested_qty * m.cost;
      } else {
        m.suggested_qty = 0;
        m.suggested_value = 0;
      }

      // PO deliveries lookup voor dit item
      var pos = poByItem[m.item] || [];
      m.po_list = pos;
      if (pos.length > 0) {
        m.next_eta = pos[0].date;
        m.next_qty = pos[0].qty;
      } else {
        m.next_eta = null;
        m.next_qty = 0;
      }
    });

    list = list.filter(function(m) { return m.avg_monthly > 0; });

    return list;
  }, [data, store, poByItem]);

  // NEW v12: bereken voor elk item de voorspelde voorraad op X weken vooruit.
  // Formule:
  //   projected_qoh = qoh_nu − (avg_monthly × weken / 4.33) + som(PO's met ETA
  //     tussen NU en horizon-datum)
  // avg_monthly telt maanden zonder verkoop niet mee (al gedaan bij m.avg_monthly).
  // Kleur:
  //   rood:   projected <= 0
  //   oranje: projected > 0 en < 25% van huidige QOH
  //   groen:  overig
  var itemsWithProjection = useMemo(function() {
    var weeks = projHorizonWeeks;
    var horizonMs = Date.now() + weeks * 7 * 86400000;
    var nowMs = Date.now();
    var monthsAhead = weeks / 4.33;

    return items.map(function(m) {
      // Sum PO's met ETA in de toekomst tot horizonMs
      var inbound = 0;
      (m.po_list || []).forEach(function(p) {
        var etaMs = new Date(p.date).getTime();
        if (isNaN(etaMs)) return;
        if (etaMs >= nowMs && etaMs <= horizonMs) {
          inbound += (parseFloat(p.qty) || 0);
        }
      });

      var expected_sales = (m.avg_monthly || 0) * monthsAhead;
      var projected = m.qoh - expected_sales + inbound;

      // Kleur bepalen
      var projColor;
      if (projected <= 0) projColor = 'red';
      else if (m.qoh > 0 && projected < m.qoh * 0.25) projColor = 'orange';
      else projColor = 'green';

      return Object.assign({}, m, {
        projected_stock: Math.round(projected),
        projected_inbound: Math.round(inbound),
        projected_color: projColor,
      });
    });
  }, [items, projHorizonWeeks]);

  var depts = useMemo(function() {
    var s = {};
    items.forEach(function(m) {
      // Alleen overschrijven als we nog geen naam hebben; voorkomt dat een leeg
      // dept_name een goede overschrijft.
      if (!s[m.dept_code] && m.dept_name) s[m.dept_code] = m.dept_name;
      else if (!(m.dept_code in s)) s[m.dept_code] = m.dept_name || '';
    });
    return Object.entries(s).sort(function(a, b) { return (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0); });
  }, [items]);
  var vendors = useMemo(function() { var s = {}; items.forEach(function(m) { if (m.vendor) s[m.vendor] = true; }); return Object.keys(s).sort(); }, [items]);

  var filteredBase = useMemo(function() {
    var src = itemsWithProjection;
    if (nosFilter === 'yes') src = src.filter(function(m) { return m.nos; });
    else if (nosFilter === 'no') src = src.filter(function(m) { return !m.nos; });
    if (qohFilter === 'positive') src = src.filter(function(m) { return m.qoh > 0; });
    if (dept !== 'all') src = src.filter(function(m) { return m.dept_code === dept; });
    if (vendor !== 'all') src = src.filter(function(m) { return m.vendor === vendor; });
    return src;
  }, [itemsWithProjection, nosFilter, qohFilter, dept, vendor]);

  var displayed = useMemo(function() {
    var list = filteredBase || [];

    if (filter === 'critical') list = list.filter(function(m) { return m.risk === 'critical'; });
    else if (filter === 'urgent') list = list.filter(function(m) { return m.risk === 'critical' || m.risk === 'urgent'; });
    else if (filter === 'watch') list = list.filter(function(m) { return m.risk !== 'ok'; });

    if (search) {
      var s = search.toLowerCase();
      list = list.filter(function(m) {
        return (m.item || '').toLowerCase().includes(s) ||
               (m.desc || '').toLowerCase().includes(s) ||
               (m.vendor || '').toLowerCase().includes(s);
      });
    }

    list = list.slice().sort(function(a, b) {
      var av = a[sortCol], bv = b[sortCol];
      // Null/undefined naar onderaan bij beide sorteer-richtingen
      var aNull = av === null || av === undefined;
      var bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === 'string') return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [filteredBase, filter, search, sortCol, sortDir]);

  var totals = useMemo(function() {
    var src = filteredBase || [];
    var critical = src.filter(function(m) { return m.risk === 'critical'; });
    var urgent = src.filter(function(m) { return m.risk === 'urgent'; });
    var watch = src.filter(function(m) { return m.risk === 'watch'; });
    var nosCritical = src.filter(function(m) { return m.nos && (m.risk === 'critical' || m.risk === 'urgent'); });
    var valueAtRisk = critical.concat(urgent).reduce(function(s, m) { return s + m.inv_value; }, 0);
    var suggestedValue = critical.concat(urgent).reduce(function(s, m) { return s + m.suggested_value; }, 0);
    return {
      total_items: src.length,
      critical: critical.length,
      urgent: urgent.length,
      watch: watch.length,
      total_risk: critical.length + urgent.length,
      nos_at_risk: nosCritical.length,
      value_at_risk: valueAtRisk,
      suggested_value: suggestedValue,
    };
  }, [filteredBase]);

  var deptRisk = useMemo(function() {
    var map = {};
    (filteredBase || []).forEach(function(m) {
      var dc = m.dept_code;
      if (!map[dc]) map[dc] = { code: dc, name: m.dept_name, bum: m.bum, total: 0, critical: 0, urgent: 0, watch: 0, ok: 0, nos_risk: 0, value_at_risk: 0 };
      map[dc].total++;
      map[dc][m.risk]++;
      if (m.nos && (m.risk === 'critical' || m.risk === 'urgent')) map[dc].nos_risk++;
      if (m.risk === 'critical' || m.risk === 'urgent') map[dc].value_at_risk += m.inv_value;
    });
    var arr = Object.values(map);
    // Sort op basis van deptSortCol/deptSortDir
    arr.sort(function(a, b) {
      var av, bv;
      if (deptSortCol === 'code') {
        // Numeriek sorteren op dept-code (bv. 20, 21, 22)
        av = parseInt(a.code) || 0; bv = parseInt(b.code) || 0;
      } else if (deptSortCol === 'name') {
        av = String(a.name || ''); bv = String(b.name || '');
        return deptSortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      } else if (deptSortCol === 'risk') {
        // Combinatie kritiek + urgent
        av = a.critical + a.urgent; bv = b.critical + b.urgent;
      } else {
        av = a[deptSortCol] || 0; bv = b[deptSortCol] || 0;
      }
      return deptSortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [filteredBase, deptSortCol, deptSortDir]);

  // NEW v9: toggle voor dept-tabel sort
  function toggleDeptSort(col) {
    if (deptSortCol === col) {
      setDeptSortDir(function(d) { return d === 'asc' ? 'desc' : 'asc'; });
    } else {
      setDeptSortCol(col);
      // Default richting: code/name oplopend (asc), risk/value/nos aflopend (desc)
      setDeptSortDir(col === 'code' || col === 'name' ? 'asc' : 'desc');
    }
  }
  var deptArrow = function(col) { return deptSortCol === col ? (deptSortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  // NEW v10: Vendor purchase suggestion list
  // Aggregeer alle items met suggested_qty > 0 per vendor.
  // Filter vendors met totaal_value >= vendorThreshold.
  var vendorList = useMemo(function() {
    var map = {};
    (filteredBase || []).forEach(function(m) {
      if (!m.suggested_qty || m.suggested_qty <= 0) return;
      var v = m.vendor || 'ONBEKEND';
      if (!map[v]) {
        map[v] = { vendor: v, items: [], total_qty: 0, total_value: 0 };
      }
      map[v].items.push(m);
      map[v].total_qty += m.suggested_qty;
      map[v].total_value += m.suggested_value;
    });
    var arr = Object.values(map).filter(function(v) { return v.total_value >= vendorThreshold; });
    // Sort
    arr.sort(function(a, b) {
      var av, bv;
      if (vendorSortCol === 'vendor') {
        av = String(a.vendor); bv = String(b.vendor);
        return vendorSortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      if (vendorSortCol === 'count') { av = a.items.length; bv = b.items.length; }
      else if (vendorSortCol === 'qty') { av = a.total_qty; bv = b.total_qty; }
      else { av = a.total_value; bv = b.total_value; }
      return vendorSortDir === 'asc' ? av - bv : bv - av;
    });
    // Sorteer items binnen elke vendor op suggested_value aflopend
    arr.forEach(function(v) {
      v.items.sort(function(a, b) { return (b.suggested_value || 0) - (a.suggested_value || 0); });
    });
    return arr;
  }, [filteredBase, vendorThreshold, vendorSortCol, vendorSortDir]);

  function toggleVendorSort(col) {
    if (vendorSortCol === col) {
      setVendorSortDir(function(d) { return d === 'asc' ? 'desc' : 'asc'; });
    } else {
      setVendorSortCol(col);
      setVendorSortDir(col === 'vendor' ? 'asc' : 'desc');
    }
  }
  var vendorArrow = function(col) { return vendorSortCol === col ? (vendorSortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  function toggleVendorExpand(vendor) {
    setExpandedVendors(function(prev) {
      var next = Object.assign({}, prev);
      if (next[vendor]) delete next[vendor];
      else next[vendor] = true;
      return next;
    });
  }

  function toggleSort(col) { if (sortCol === col) setSortDir(function(d) { return d === 'desc' ? 'asc' : 'desc'; }); else { setSortCol(col); setSortDir(col === 'months_cover' || col === 'stockout_months' ? 'asc' : 'desc'); } }
  var arrow = function(col) { return sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''; };

  var title = bumFilter ? 'Stock Risk Alert — ' + bumFilter : 'Stock Risk Alert — Totaaloverzicht';
  var subtitle = bumFilter
    ? 'Items at risk voor ' + bumFilter + ' — welke producten gaan op raken vóór nieuwe levering?'
    : 'Alle BUMs — welke producten gaan op raken vóór nieuwe levering?';
  var updateLabel = lastUpdate ? (function() { var p = lastUpdate.split('-'); var MN2 = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']; return 'Data t/m ' + parseInt(p[2]) + ' ' + MN2[parseInt(p[1])-1] + ' ' + p[0]; })() : '';

  if (loading) return <LoadingLogo text={'Stock Risk laden' + (bumFilter ? ' (' + bumFilter + ')' : '') + '...'} />;
  if (!data.length) return <div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  return (
    <div className="max-w-[1700px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>{title}</h1>
          <p className="text-[13px] text-[#6b5240]">{subtitle}{updateLabel ? ' — ' + updateLabel : ''}</p>
        </div>
        {bumFilter && <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{bumFilter}</div>}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Store</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={store === 'all'} onClick={function() { setStore('all'); }} />
            <Pill label="Curaçao" active={store === '1'} onClick={function() { setStore('1'); }} />
            <Pill label="Bonaire" active={store === 'B'} onClick={function() { setStore('B'); }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Afdeling</span>
          <select value={dept} onChange={function(e) { setDept(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle Afdelingen</option>
            {depts.map(function(d) { return <option key={d[0]} value={d[0]}>{d[0] + ' — ' + d[1]}</option>; })}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-20">Vendor</span>
          <select value={vendor} onChange={function(e) { setVendor(e.target.value); }} className="bg-white border border-[#e5ddd4] text-[13px] px-3 py-1.5 rounded-lg min-w-[250px]">
            <option value="all">Alle vendors</option>
            {vendors.map(function(v) { return <option key={v} value={v}>{v}</option>; })}
          </select>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-4">NOS</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={nosFilter === 'all'} onClick={function() { setNosFilter('all'); }} />
            <Pill label="Ja" active={nosFilter === 'yes'} onClick={function() { setNosFilter('yes'); }} />
            <Pill label="Nee" active={nosFilter === 'no'} onClick={function() { setNosFilter('no'); }} />
          </div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-4">QOH</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={qohFilter === 'all'} onClick={function() { setQohFilter('all'); }} />
            <Pill label="> 0" active={qohFilter === 'positive'} onClick={function() { setQohFilter('positive'); }} />
          </div>
          <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Zoek item..." className="px-3 py-1.5 border border-[#e5ddd4] rounded-lg text-[13px] w-[180px] ml-auto" />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        {[
          { label: 'Kritiek', value: fmt(totals.critical), sub: '< 1 maand dekking', color: totals.critical > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Urgent', value: fmt(totals.urgent), sub: '< max lead time dekking', color: totals.urgent > 0 ? '#f97316' : '#16a34a' },
          { label: 'Aandacht', value: fmt(totals.watch), sub: '< 1.5× max lead time', color: totals.watch > 0 ? '#d97706' : '#16a34a' },
          { label: 'NOS at Risk', value: fmt(totals.nos_at_risk), sub: 'kritiek + urgent', color: totals.nos_at_risk > 0 ? '#dc2626' : '#16a34a' },
          { label: 'Inkoopwaarde Nodig', value: fmtC(totals.suggested_value), sub: 'geschatte bestelling', color: '#1B3A5C' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: k.color }}></div>
              <p className="text-[10px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[22px] font-semibold font-mono mt-1" style={{ color: k.color }}>{k.value}</p>
              <p className="text-[10px] text-[#a08a74] mt-0.5">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* ═══ NEW: NOS overview charts ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <NosStackedBar snapshotsToday={todaysNosSnapshots} store={store} bumFilter={bumFilter} items={items} />
        <NosTrendChart allSnapshots={nosSnapshots} deptSnapshots={deptSnapshots} store={store} bumFilter={bumFilter} />
      </div>

      {/* Department risk + Vendor purchase suggestion side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Department risk overview */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-1">Risico per Afdeling</h3>
          <p className="text-[12px] text-[#6b5240] mb-3">Klik op kolomnaam om te sorteren — klik op een afdeling om door te zoomen</p>
          <div className="flex items-center gap-4 text-[10px] mb-3 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#16a34a' }}></span> OK</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#d97706' }}></span> Aandacht</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#f97316' }}></span> Urgent</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dc2626' }}></span> Kritiek</span>
          </div>
          {/* Sort header row */}
          <div className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#6b5240] border-b border-[#e5ddd4] pb-1 mb-2 px-1">
            <button onClick={function() { toggleDeptSort('code'); }} className="w-[140px] text-right hover:text-[#E84E1B] cursor-pointer">
              {'Afdeling' + deptArrow('code')}
            </button>
            <button onClick={function() { toggleDeptSort('risk'); }} className="flex-1 text-center hover:text-[#E84E1B] cursor-pointer">
              {'Risico-verdeling' + deptArrow('risk')}
            </button>
            <button onClick={function() { toggleDeptSort('critical'); }} className="w-[90px] text-right hover:text-[#E84E1B] cursor-pointer">
              {'Kritiek / Urgent' + deptArrow('critical')}
            </button>
          </div>
          <div className="space-y-2">
            {deptRisk.map(function(d) {
              var pOk = d.total ? ((d.ok + d.watch) / d.total * 100) : 0;
              var pWatch = d.total ? (d.watch / d.total * 100) : 0;
              var pUrg = d.total ? (d.urgent / d.total * 100) : 0;
              var pCrit = d.total ? (d.critical / d.total * 100) : 0;
              return (
                <div key={d.code} className="flex items-center gap-2 cursor-pointer hover:bg-[#faf5f0] py-1 px-1 rounded" onClick={function() { setDept(d.code); setFilter('urgent'); }}>
                  <div className="w-[140px] text-right text-[10px] text-[#1a0a04] truncate flex-shrink-0">
                    <span className="font-mono text-[#6b5240] mr-1">{d.code}</span>{d.name ? d.name.replace(/^\d+\s*/, '') : ''}
                  </div>
                  <div className="flex-1 flex h-[18px] rounded-sm overflow-hidden bg-[#f0ebe5]">
                    {pOk > 0 && <div style={{ width: (pOk - pWatch) + '%', backgroundColor: '#16a34a' }}></div>}
                    {pWatch > 0 && <div style={{ width: pWatch + '%', backgroundColor: '#d97706' }}></div>}
                    {pUrg > 0 && <div style={{ width: pUrg + '%', backgroundColor: '#f97316' }}></div>}
                    {pCrit > 0 && <div style={{ width: pCrit + '%', backgroundColor: '#dc2626' }}></div>}
                  </div>
                  <div className="w-[90px] text-[10px] font-mono text-[#6b5240] text-right flex-shrink-0">
                    {d.critical > 0 && <span style={{ color: '#dc2626' }}>{d.critical + 'K '}</span>}
                    {d.urgent > 0 && <span style={{ color: '#f97316' }}>{d.urgent + 'U '}</span>}
                    {d.critical === 0 && d.urgent === 0 && <span className="text-[#16a34a]">OK</span>}
                    {d.nos_risk > 0 && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold ml-1">{d.nos_risk + ' NOS'}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* NEW v10: Inkoopvoorstel per Leverancier */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-1">Inkoopvoorstel per Leverancier</h3>
          <p className="text-[12px] text-[#6b5240] mb-3">Leveranciers met cumulatieve bestelwaarde boven de drempel — klik + voor details</p>
          {/* Threshold control */}
          <div className="flex items-center gap-3 mb-3 text-[11px]">
            <label className="text-[#6b5240] font-semibold uppercase tracking-wide">Drempel (XCG):</label>
            <input
              type="number"
              step="1000"
              min="0"
              value={vendorThreshold}
              onChange={function(e) { setVendorThreshold(parseInt(e.target.value) || 0); }}
              className="w-[100px] px-2 py-1 border border-[#e5ddd4] rounded-md text-right font-mono text-[12px] outline-none focus:border-[#E84E1B]"
            />
            <div className="flex gap-1">
              {[10000, 25000, 50000, 100000].map(function(v) {
                var active = vendorThreshold === v;
                return (
                  <button key={v} onClick={function() { setVendorThreshold(v); }}
                    className={'px-2 py-1 rounded-md border text-[10px] font-semibold transition-colors ' +
                      (active ? 'bg-[#1B3A5C] text-white border-[#1B3A5C]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#1B3A5C]')}>
                    {(v / 1000) + 'k'}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Sort header */}
          <div className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#6b5240] border-b border-[#e5ddd4] pb-1 mb-2 px-1">
            <div className="w-[18px]"></div>
            <button onClick={function() { toggleVendorSort('vendor'); }} className="flex-1 text-left hover:text-[#E84E1B] cursor-pointer">
              {'Leverancier' + vendorArrow('vendor')}
            </button>
            <button onClick={function() { toggleVendorSort('count'); }} className="w-[50px] text-right hover:text-[#E84E1B] cursor-pointer">
              {'Items' + vendorArrow('count')}
            </button>
            <button onClick={function() { toggleVendorSort('qty'); }} className="w-[55px] text-right hover:text-[#E84E1B] cursor-pointer">
              {'Qty' + vendorArrow('qty')}
            </button>
            <button onClick={function() { toggleVendorSort('value'); }} className="w-[100px] text-right hover:text-[#E84E1B] cursor-pointer">
              {'Waarde' + vendorArrow('value')}
            </button>
          </div>
          <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '380px' }}>
            {vendorList.length === 0 && (
              <p className="text-[12px] text-[#6b5240] italic py-4 text-center">Geen leveranciers boven drempel van {fmtC(vendorThreshold)}.</p>
            )}
            {vendorList.map(function(v) {
              var isExp = !!expandedVendors[v.vendor];
              return (
                <div key={v.vendor}>
                  <div className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-[#faf5f0] cursor-pointer"
                       onClick={function() { toggleVendorExpand(v.vendor); }}>
                    <div className="w-[18px] text-center font-mono text-[#E84E1B] font-bold text-[14px] leading-none flex-shrink-0">
                      {isExp ? '−' : '+'}
                    </div>
                    <div className="flex-1 text-[11px] text-[#1a0a04] font-semibold truncate" title={v.vendor}>
                      {v.vendor}
                    </div>
                    <div className="w-[50px] text-right text-[11px] font-mono text-[#6b5240]">
                      {v.items.length}
                    </div>
                    <div className="w-[55px] text-right text-[11px] font-mono text-[#6b5240]">
                      {fmt(v.total_qty)}
                    </div>
                    <div className="w-[100px] text-right text-[12px] font-mono font-semibold" style={{ color: '#E84E1B' }}>
                      {fmtC(v.total_value)}
                    </div>
                  </div>
                  {isExp && (
                    <div className="ml-6 mb-2 mt-1 bg-[#faf7f4] rounded-md p-2 space-y-1">
                      <div className="flex items-center gap-2 text-[9px] uppercase tracking-wide text-[#6b5240] font-bold border-b border-[#e5ddd4] pb-1">
                        <div className="w-[90px]">Item</div>
                        <div className="w-[80px]">MFG#</div>
                        <div className="flex-1">Omschrijving</div>
                        <div className="w-[45px] text-right">Qty</div>
                        <div className="w-[80px] text-right">Waarde</div>
                      </div>
                      {v.items.map(function(it) {
                        return (
                          <div key={it.item} className="flex items-center gap-2 text-[10px] py-0.5">
                            <div className="w-[90px] font-mono text-[#1B3A5C] truncate" title={it.item}>{it.item}</div>
                            <div className="w-[80px] font-mono text-[#6b5240] truncate" title={it.mfg || '—'}>{it.mfg || '—'}</div>
                            <div className="flex-1 truncate" title={it.desc}>{it.desc}</div>
                            <div className="w-[45px] text-right font-mono font-semibold" style={{ color: '#E84E1B' }}>{fmt(it.suggested_qty)}</div>
                            <div className="w-[80px] text-right font-mono">{fmtC(it.suggested_value)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {vendorList.length > 0 && (
            <div className="border-t border-[#e5ddd4] mt-2 pt-2 flex items-center gap-2 text-[11px] font-bold px-1">
              <div className="w-[18px]"></div>
              <div className="flex-1 text-[#1a0a04]">TOTAAL ({vendorList.length} leveranciers)</div>
              <div className="w-[50px] text-right font-mono text-[#6b5240]">{fmt(vendorList.reduce(function(s, v) { return s + v.items.length; }, 0))}</div>
              <div className="w-[55px] text-right font-mono text-[#6b5240]">{fmt(vendorList.reduce(function(s, v) { return s + v.total_qty; }, 0))}</div>
              <div className="w-[100px] text-right font-mono" style={{ color: '#E84E1B' }}>{fmtC(vendorList.reduce(function(s, v) { return s + v.total_value; }, 0))}</div>
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs + export */}
      <div className="flex items-center justify-between mb-5 border-b-2 border-[#e5ddd4]">
        <div className="flex gap-1">
          {[
            ['critical', 'Kritiek (' + totals.critical + ')'],
            ['urgent', 'Kritiek + Urgent (' + (totals.critical + totals.urgent) + ')'],
            ['watch', 'Alle risico (' + (totals.critical + totals.urgent + totals.watch) + ')'],
            ['all', 'Alle items (' + totals.total_items + ')'],
          ].map(function(item) {
            return <button key={item[0]} onClick={function() { setFilter(item[0]); }} className={'px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] transition-colors ' + (filter === item[0] ? 'text-[#E84E1B] border-[#E84E1B]' : 'text-[#6b5240] border-transparent hover:text-[#1a0a04]')}>{item[1]}</button>;
          })}
        </div>
        <ExcelExportButton
          filename={(function() { var d = new Date(); var pad = function(n){return n<10?'0'+n:''+n;}; return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '_stock_risk_' + (bumFilter || 'alle') + '_' + (store === '1' ? 'Curacao' : store === 'B' ? 'Bonaire' : 'Totaal'); })()}
          reportTitle={'Stock Risk Alert — ' + (bumFilter ? bumFilter + ' — ' : '') + (store === '1' ? 'Curaçao' : store === 'B' ? 'Bonaire' : 'Totaal')}
          sheets={function() {
            return [
              {
                name: 'Risico per Afdeling',
                rows: deptRisk.map(function(d) {
                  return {
                    'Dept': d.code,
                    'Departement': d.name,
                    'BUM': d.bum || '',
                    'Totaal items': d.total,
                    'Kritiek': d.critical,
                    'Urgent': d.urgent,
                    'Aandacht': d.watch,
                    'OK': d.ok,
                    'NOS at risk': d.nos_risk,
                    'Waarde at risk (XCG)': Math.round(d.value_at_risk),
                  };
                }),
              },
              {
                name: 'Items',
                rows: displayed.map(function(m) {
                  return {
                    'Dept': m.dept_code,
                    'MFG#': m.mfg || '',
                    'Item': m.item,
                    'Omschrijving': m.desc,
                    'BUM': m.bum,
                    'Vendor': m.vendor,
                    'NOS': m.nos ? 'Ja' : 'Nee',
                    'Status': m.risk === 'critical' ? 'Kritiek' : m.risk === 'urgent' ? 'Urgent' : m.risk === 'watch' ? 'Aandacht' : 'OK',
                    'QOH totaal': Math.round(m.qoh),
                    'QOH CUR': Math.round(m.qoh_cur),
                    'QOH BON': Math.round(m.qoh_bon),
                    'QOO totaal': Math.round(m.qoo),
                    'QOO CUR': Math.round(m.qoo_cur),
                    'QOO BON': Math.round(m.qoo_bon),
                    'Volgende ETA': m.next_eta || '',
                    'Volgende aantal': m.next_qty || '',
                    ['Voorraad +' + projHorizonWeeks + 'w']: Math.round(m.projected_stock),
                    'Aantal openstaande PO\'s': (m.po_list || []).length,
                    'Beschikbaar': Math.round(m.available),
                    'Voorraad in mnd': m.months_cover >= 99 ? 'oneindig' : Math.round(m.months_cover * 10) / 10,
                    'Lead time (mnd)': m.lead_time,
                    'Gem/mnd verkoop': Math.round(m.avg_monthly),
                    'Actieve maanden': m.active_months,
                    'Voorraadwaarde (XCG)': Math.round(m.inv_value),
                    'Bestel qty (advies)': Math.round(m.suggested_qty || 0),
                    'Bestel waarde (XCG)': Math.round(m.suggested_value || 0),
                  };
                }),
              },
            ];
          }}
        />
      </div>

      {/* Results count + rows selector */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-[#6b5240]">{'Toont ' + Math.min(tableRows, displayed.length) + ' van ' + displayed.length + ' items'}</p>
        <select value={tableRows} onChange={function(e) { setTableRows(parseInt(e.target.value)); }} className="px-2 py-1 border border-[#e5ddd4] rounded-lg text-[12px]">
          {[50, 100, 250, 500].map(function(n) { return <option key={n} value={n}>{n} rijen</option>; })}
        </select>
      </div>

      {/* NEW v12: Stock Predictor slider */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm px-5 py-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-[13px] font-bold text-[#1a0a04] m-0">Voorraad-voorspeller</h3>
            <p className="text-[11px] text-[#6b5240] m-0">Sleep om de tijdshorizon te kiezen — kolom "Voorraad +{projHorizonWeeks}w" in de tabel toont de voorspelde voorraad</p>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-bold" style={{ color: '#E84E1B' }}>+{projHorizonWeeks}w</div>
            <div className="text-[10px] text-[#6b5240]">≈ {(projHorizonWeeks / 4.33).toFixed(1)} maanden</div>
          </div>
        </div>
        <input
          type="range"
          min="0"
          max="13"
          step="1"
          value={projHorizonWeeks}
          onChange={function(e) { setProjHorizonWeeks(parseInt(e.target.value)); }}
          className="w-full accent-[#E84E1B]"
          style={{ height: '6px' }}
        />
        <div className="flex justify-between text-[9px] text-[#a08a74] mt-1">
          <span>Nu</span>
          <span>1 mnd</span>
          <span>2 mnd</span>
          <span>3 mnd</span>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm overflow-hidden mb-8">
        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          <table className="w-full border-collapse text-[11px]" style={{ minWidth: '1500px' }}>
            <thead className="sticky top-0 z-30">
              <tr className="bg-[#1B3A5C]">
                <th colSpan={5} className="text-left text-white text-[9px] font-bold uppercase py-2 px-2 border-r border-[#2a4f75]">Item</th>
                <th colSpan={store === 'all' ? 9 : 7} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Voorraad & Dekking</th>
                <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase py-2 border-r border-[#2a4f75]">Verkoop</th>
                <th colSpan={3} className="text-center text-white text-[9px] font-bold uppercase py-2">Actie</th>
              </tr>
              <tr className="bg-[#f0ebe5]">
                {(function() {
                  // Bij "Alle" tab: QOH en QOO splitsen in CUR/BON, anders één kolom
                  var splitView = store === 'all';
                  var cols = [
                    ['Dept', 'dept_code', 'text-left min-w-[50px]'],
                    ['MFG#', 'mfg', 'text-left min-w-[100px]'],
                    ['', 'item', 'text-left min-w-[80px]'],
                    ['Omschrijving', 'desc', 'text-left min-w-[180px]'],
                    ['Status', 'risk', 'text-center border-r border-[#e5ddd4]'],
                  ];
                  if (splitView) {
                    cols.push(['QOH CUR', 'qoh_cur', 'text-right']);
                    cols.push(['QOH BON', 'qoh_bon', 'text-right']);
                    cols.push(['QOO CUR', 'qoo_cur', 'text-right']);
                    cols.push(['QOO BON', 'qoo_bon', 'text-right']);
                  } else {
                    cols.push(['QOH', 'qoh', 'text-right']);
                    cols.push(['QOO', 'qoo', 'text-right']);
                  }
                  cols.push(['Volgende ETA', 'next_eta', 'text-right']);
                  cols.push(['Aantal', 'next_qty', 'text-right']);
                  cols.push(['Voorraad +' + projHorizonWeeks + 'w', 'projected_stock', 'text-right']);
                  cols.push(['Dekking', 'months_cover', 'text-right']);
                  cols.push(['vs LT', '', 'text-center border-r border-[#e5ddd4]']);
                  cols.push(['Gem/mnd', 'avg_monthly', 'text-right']);
                  cols.push(['Actief', 'active_months', 'text-right']);
                  cols.push(['Trend', '', 'text-center border-r border-[#e5ddd4]']);
                  cols.push(['Lead Time', 'lead_time', 'text-right']);
                  cols.push(['Bestel qty', 'suggested_qty', 'text-right']);
                  cols.push(['Waarde', 'suggested_value', 'text-right']);
                  return cols.map(function(h) {
                    var clickable = h[1] ? ' cursor-pointer hover:text-[#E84E1B]' : '';
                    return <th key={h[0] + h[1]} className={'p-1.5 text-[9px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4] whitespace-nowrap ' + h[2] + clickable} onClick={h[1] ? function() { toggleSort(h[1]); } : undefined}>{(h[0] || 'Item') + arrow(h[1])}</th>;
                  });
                })()}
              </tr>
            </thead>
            <tbody>
              {(function() {
                var tQoh = 0, tQoo = 0, tQty = 0, tVal = 0;
                var tQohCur = 0, tQohBon = 0, tQooCur = 0, tQooBon = 0;
                displayed.forEach(function(m) {
                  tQoh += m.qoh; tQoo += m.qoo; tQty += m.suggested_qty; tVal += m.suggested_value;
                  tQohCur += m.qoh_cur; tQohBon += m.qoh_bon; tQooCur += m.qoo_cur; tQooBon += m.qoo_bon;
                });
                var splitView = store === 'all';
                return (
                  <tr className="bg-[#faf7f4] sticky z-20" style={{ top: '60px' }}>
                    <td colSpan={5} className="p-2 text-[12px] font-bold border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]">{'TOTAAL (' + displayed.length + ' items)'}</td>
                    {splitView ? (
                      <Fragment>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQohCur))}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQohBon))}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQooCur))}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQooBon))}</td>
                      </Fragment>
                    ) : (
                      <Fragment>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQoh))}</td>
                        <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]">{fmt(Math.round(tQoo))}</td>
                      </Fragment>
                    )}
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3] border-r border-[#e5ddd4]"></td>
                    <td className="p-2 border-b-2 border-[#c5bfb3]"></td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#E84E1B' }}>{fmt(Math.round(tQty))}</td>
                    <td className="p-2 text-right font-mono text-[12px] font-bold border-b-2 border-[#c5bfb3]" style={{ color: '#E84E1B' }}>{fmtC(tVal)}</td>
                  </tr>
                );
              })()}
              {displayed.length === 0 && (
                <tr><td colSpan={store === 'all' ? 20 : 18} className="p-8 text-center text-[#6b5240]">Geen items gevonden voor dit filter</td></tr>
              )}
              {displayed.slice(0, tableRows).map(function(m, i) {
                var bg = i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]';
                var coverColor = m.months_cover < 1 ? '#dc2626' : m.months_cover < m.lead_time ? '#f97316' : m.months_cover < m.lead_time * 1.5 ? '#d97706' : '#16a34a';
                return (
                  <tr key={m.item} className={bg + ' hover:bg-[#faf5f0]'}>
                    <td className="p-1.5 text-[10px] font-mono text-[#6b5240] border-b border-[#f0ebe5]">{m.dept_code}</td>
                    <td className="p-1.5 text-[10px] font-mono text-[#6b5240] border-b border-[#f0ebe5]" title={m.mfg ? 'MFG Part #: ' + m.mfg : 'Geen MFG#'}>{m.mfg || '—'}</td>
                    <td className="p-1.5 text-[11px] font-mono text-[#6b5240] border-b border-[#f0ebe5]">{m.item}</td>
                    <td className="p-1.5 text-[11px] border-b border-[#f0ebe5] truncate max-w-[200px]" title={m.desc}>
                      {m.desc}
                      {m.nos && <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">NOS</span>}
                    </td>
                    <td className="p-1.5 border-b border-[#f0ebe5] text-center border-r border-[#e5ddd4]"><RiskBadge level={m.risk} /></td>
                    {store === 'all' ? (
                      <Fragment>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoh_cur === 0 ? '#a08a74' : '#1B3A5C' }}>{m.qoh_cur === 0 ? '-' : fmt(Math.round(m.qoh_cur))}</td>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoh_bon === 0 ? '#a08a74' : '#1B3A5C' }}>{m.qoh_bon === 0 ? '-' : fmt(Math.round(m.qoh_bon))}</td>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoo_cur > 0 ? '#1B3A5C' : '#a08a74' }}
                            title={m.po_list && m.po_list.length > 0
                              ? 'Verwachte leveringen (totaal voor item):\n' + m.po_list.map(function(p) {
                                  var d = new Date(p.date);
                                  return 'PO ' + p.po + ' — ' + (d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear()) + ' — ' + p.qty + ' stuks';
                                }).join('\n')
                              : 'Geen verwachte leveringen geregistreerd'}>{m.qoo_cur > 0 ? fmt(Math.round(m.qoo_cur)) : '-'}</td>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoo_bon > 0 ? '#1B3A5C' : '#a08a74' }}
                            title={m.po_list && m.po_list.length > 0
                              ? 'Verwachte leveringen (totaal voor item):\n' + m.po_list.map(function(p) {
                                  var d = new Date(p.date);
                                  return 'PO ' + p.po + ' — ' + (d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear()) + ' — ' + p.qty + ' stuks';
                                }).join('\n')
                              : 'Geen verwachte leveringen geregistreerd'}>{m.qoo_bon > 0 ? fmt(Math.round(m.qoo_bon)) : '-'}</td>
                      </Fragment>
                    ) : (
                      <Fragment>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]">{fmt(Math.round(m.qoh))}</td>
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: m.qoo > 0 ? '#1B3A5C' : '#a08a74' }}
                            title={m.po_list && m.po_list.length > 0
                              ? 'Verwachte leveringen:\n' + m.po_list.map(function(p) {
                                  var d = new Date(p.date);
                                  return 'PO ' + p.po + ' — ' + (d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear()) + ' — ' + p.qty + ' stuks';
                                }).join('\n')
                              : 'Geen verwachte leveringen geregistreerd'}>{m.qoo > 0 ? fmt(Math.round(m.qoo)) : '-'}</td>
                      </Fragment>
                    )}
                    {(function() {
                      // Volgende ETA + aantal kolommen
                      if (!m.next_eta) {
                        return [
                          <td key="eta" className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#a08a74]">-</td>,
                          <td key="qty" className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#a08a74]">-</td>,
                        ];
                      }
                      var d = new Date(m.next_eta);
                      // Vergelijk in UTC: "vandaag" als UTC midnight, anders shift in tijdzone
                      // veroorzaakt false-positives (datum lijkt 1 dag eerder/later)
                      var now = new Date();
                      var todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
                      var isPast = d.getTime() < todayUtc;
                      // UTC date components: anders shift Curaçao (UTC-4) de datum 1 dag vroeger
                      var dateStr = d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
                      var fullDateStr = d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
                      var tooltipExtra = m.po_list.length > 1 ? '  (' + m.po_list.length + ' leveringen verwacht — hover over QOO voor alle)' : '';
                      return [
                        <td key="eta" className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]"
                            style={{ color: isPast ? '#dc2626' : '#1B3A5C', fontWeight: isPast ? 'bold' : 'normal' }}
                            title={'Verwacht: ' + fullDateStr + (isPast ? '  — datum ligt in het verleden, ETA mogelijk verouderd' : '') + tooltipExtra}>
                          {dateStr}
                        </td>,
                        <td key="qty" className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5]" style={{ color: '#1B3A5C' }}>
                          {fmt(Math.round(m.next_qty))}
                        </td>
                      ];
                    })()}
                    {(function() {
                      var pColor = m.projected_color === 'red' ? '#dc2626'
                        : m.projected_color === 'orange' ? '#d97706'
                        : '#16a34a';
                      var pBg = m.projected_color === 'red' ? '#fee2e2'
                        : m.projected_color === 'orange' ? '#fef3c7'
                        : '#dcfce7';
                      var tooltip = 'Voorspelling over ' + projHorizonWeeks + ' weken:\n' +
                        '  QOH nu: ' + fmt(Math.round(m.qoh)) + '\n' +
                        '  − verkoop (' + (m.avg_monthly ? m.avg_monthly.toFixed(1) : '0') + '/mnd × ' + (projHorizonWeeks / 4.33).toFixed(1) + ' mnd): ' + fmt(Math.round((m.avg_monthly || 0) * projHorizonWeeks / 4.33)) + '\n' +
                        '  + PO inbound (ETA in de toekomst): ' + fmt(m.projected_inbound || 0) + '\n' +
                        '  = projected: ' + fmt(m.projected_stock);
                      return (
                        <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold"
                            style={{ color: pColor, backgroundColor: pBg }}
                            title={tooltip}>
                          {fmt(m.projected_stock)}
                        </td>
                      );
                    })()}
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold" style={{ color: coverColor }}>{m.months_cover >= 99 ? '∞' : m.months_cover.toFixed(1) + 'm'}</td>
                    <td className="p-1.5 border-b border-[#f0ebe5] border-r border-[#e5ddd4]"><CoverBar months={m.months_cover} maxLT={m.lead_time} /></td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-semibold">{fmt(Math.round(m.avg_monthly))}</td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5] text-[#6b5240]">{m.active_months + '/12'}</td>
                    <td className="p-1.5 border-b border-[#f0ebe5] border-r border-[#e5ddd4]"><Spark sales={m.salesChrono} /></td>
                    <td className="p-1.5 text-right font-mono text-[10px] border-b border-[#f0ebe5]">{m.lead_time > 0 ? m.lead_time + 'm' : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: m.suggested_qty > 0 ? '#E84E1B' : '#16a34a' }}>{m.suggested_qty > 0 ? fmt(m.suggested_qty) : '-'}</td>
                    <td className="p-1.5 text-right font-mono text-[11px] border-b border-[#f0ebe5] font-bold" style={{ color: m.suggested_value > 0 ? '#E84E1B' : '#1a0a04' }}>{m.suggested_value > 0 ? fmtC(m.suggested_value) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 shadow-sm mb-5">
        <div className="flex flex-wrap gap-5 text-[10px] text-[#6b5240]">
          <span><b>Dekking</b> = (QOH + QOO) ÷ gem. maandverkoop</span>
          <span><b>Max Lead Time</b> = maximale levertijd leverancier</span>
          <span><b>Verticale lijn</b> in dekkingsbalk = max lead time drempel</span>
          <span><RiskBadge level="critical" /> &lt;1 mnd dekking</span>
          <span><RiskBadge level="urgent" /> dekking &lt; max lead time</span>
          <span><RiskBadge level="watch" /> dekking &lt; 1.5× max lead time</span>
          <span className="text-[8px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-bold">NOS</span> <span>Never Out of Stock items</span>
        </div>
      </div>

      {/* Uitleg over Totaal versus Curaçao + Bonaire */}
      <div className="bg-[#faf7f4] rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
        <h3 className="text-[13px] font-bold mb-2 text-[#1a0a04]">Waarom kan &quot;Totaal&quot; minder kritieke items tonen dan Curaçao alleen?</h3>
        <p className="text-[11px] text-[#6b5240] leading-relaxed mb-2">
          Een item is <b>kritiek</b> als de dekking (QOH+QOO ÷ gem. maandverkoop) minder dan 1 maand is.
          Bij <b>Totaal</b> worden QOH en QOO van Curaçao én Bonaire bij elkaar opgeteld vóór de classificatie.
          Een item dat in Curaçao kritiek is maar op Bonaire wel voorraad heeft, kan op Totaal-niveau dus &quot;OK&quot; lijken.
        </p>
        <div className="bg-white border border-[#e5ddd4] rounded-lg p-3 text-[11px] text-[#1a0a04] font-mono mb-2">
          <div className="font-bold mb-1">Voorbeeld:</div>
          <div>Item X — gem. verkoop Curaçao: 10/mnd, Bonaire: 2/mnd</div>
          <div>Curaçao: QOH=5, QOO=0 → dekking 0,5 mnd → <span className="text-red-600 font-bold">kritiek</span></div>
          <div>Bonaire: QOH=20, QOO=0 → dekking 10 mnd → <span className="text-green-600 font-bold">OK</span></div>
          <div>Totaal: QOH=25, QOO=0, verkoop=12/mnd → dekking 2,1 mnd → <span className="text-green-600 font-bold">niet kritiek</span></div>
        </div>
        <p className="text-[11px] text-[#6b5240] leading-relaxed">
          De cijfers kloppen wiskundig, maar er is in de praktijk geen automatische overheveling tussen eilanden.
          Voor inkoopbeslissingen op één locatie is daarom de view <b>Curaçao</b> of <b>Bonaire</b> meestal nuttiger dan <b>Totaal</b>.
        </p>
      </div>
    </div>
  );
}