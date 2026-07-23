/* ============================================================
   BESTAND: factuurstatus_page.js  (v7)
   KOPIEER NAAR: src/app/dashboard/finance/factuurstatus/page.js

   DOEL: intern zoekbaar rapport "is mijn factuur geboekt/betaald?".
   Leest public.invoice_ledger (read-only).

   v7:
   - BDMS verwijderd uit de entiteit-knoppen (hier worden geen
     facturen geboekt).
   - Waarschuwing over toekomstige factuurdatums verwijderd:
     een factuurdatum in de toekomst is legitiem.
   v6:
   - Databanner bovenaan: laatste update (max loaded_at) met stoplicht,
     aantal regels, laatste bronbestand.
   v5:
   - Automatische totalen (balk + tfoot), selecteerbare rijen met
     selectietotaal, valutabewaking USD (BDB) vs XCG.
   v4:
   - Status-kolom Open/Betaald; aparte kolom "Betaald op"; Excel-export.
   v3:
   - Leveranciers-dropdown; klikbare sorteerbare kolomkoppen.
   v2:
   - Zoekt op vendornummer; entiteit-knoppen; datum-ranges.
   ============================================================ */
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase';

const ENTITIES = [
  { key: 'all', label: 'Alle' },
  { key: 'BDT', label: 'Curaçao (BDT)' },
  { key: 'BDB', label: 'Bonaire (BDB)' },
  { key: 'MMC', label: 'Multimart (MMC)' },
  { key: 'RCC', label: 'Repair Centre (RCC)' },
];
const ENTITY_LABEL = { BDT: 'Curaçao', BDB: 'Bonaire', MMC: 'Multimart', RCC: 'Repair Centre', BDMS: 'BDMS' };

// Bonaire wordt in USD geadministreerd, de overige entiteiten in XCG.
const USD_ENTITIES = new Set(['BDB']);
const currencyOf = (r) => (USD_ENTITIES.has(r.entity) ? 'USD' : 'XCG');

function fmtMoney(v, cur = 'XCG') {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return cur + ' ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('nl-NL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function isOpen(r) {
  return parseFloat(r.balance) > 0 && !r.fully_paid;
}
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Versheid van de laatste dataload
function freshness(iso) {
  if (!iso) return { tone: 'gray', label: 'onbekend', dot: 'bg-gray-400' };
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 30)  return { tone: 'green', label: 'actueel',         dot: 'bg-emerald-500' };
  if (hours < 78)  return { tone: 'amber', label: 'iets verouderd',  dot: 'bg-amber-500'   };
  return { tone: 'red', label: 'verouderd — controleer de pipeline', dot: 'bg-red-500'     };
}

const COLS = [
  { key: 'vendor_name',    label: 'Leverancier', type: 'text',     align: 'left'  },
  { key: 'vendor_code',    label: 'Vendor#',     type: 'text',     align: 'left'  },
  { key: 'invoice_number', label: 'Factuur',     type: 'text',     align: 'left'  },
  { key: 'po_number',      label: 'PO',          type: 'text',     align: 'left'  },
  { key: 'voucher_number', label: 'Voucher',     type: 'text',     align: 'left'  },
  { key: 'entity',         label: 'Entiteit',    type: 'text',     align: 'left'  },
  { key: 'invoice_date',   label: 'Datum',       type: 'date',     align: 'left'  },
  { key: 'amount',         label: 'Bedrag',      type: 'num',      align: 'right' },
  { key: 'status',         label: 'Status',      type: 'status',   align: 'left'  },
  { key: 'paid_date',      label: 'Betaald op',  type: 'paiddate', align: 'left'  },
];

const defaultDir = (type) => (type === 'num' || type === 'date' || type === 'paiddate') ? 'desc' : 'asc';

function sortValue(row, col) {
  switch (col.type) {
    case 'num': {
      const n = parseFloat(row.amount);
      return { empty: isNaN(n), val: n };
    }
    case 'date': {
      const t = row.invoice_date ? Date.parse(row.invoice_date) : NaN;
      return { empty: isNaN(t), val: t };
    }
    case 'paiddate': {
      const t = row.paid_date ? Date.parse(row.paid_date) : NaN;
      return { empty: isNaN(t), val: t };
    }
    case 'status': {
      return { empty: false, val: isOpen(row) ? 0 : 1 };
    }
    default: {
      const s = (row[col.key] ?? '').toString().trim();
      return { empty: s === '', val: s };
    }
  }
}

function compareRows(a, b, col, dir) {
  const av = sortValue(a, col);
  const bv = sortValue(b, col);
  if (av.empty && bv.empty) return 0;
  if (av.empty) return 1;
  if (bv.empty) return -1;
  let base;
  if (col.type === 'text') {
    base = av.val.localeCompare(bv.val, 'nl', { numeric: true, sensitivity: 'base' });
  } else {
    base = av.val - bv.val;
  }
  return dir === 'asc' ? base : -base;
}

function computeTotals(list) {
  const per = new Map();
  for (const r of list) {
    const cur = currencyOf(r);
    if (!per.has(cur)) per.set(cur, { cur, count: 0, total: 0, openCount: 0, openTotal: 0, paidCount: 0, paidTotal: 0 });
    const t = per.get(cur);
    const a = num(r.amount);
    t.count += 1;
    t.total += a;
    if (isOpen(r)) { t.openCount += 1; t.openTotal += a; }
    else { t.paidCount += 1; t.paidTotal += a; }
  }
  const groups = [...per.values()].sort((a, b) => a.cur.localeCompare(b.cur));
  return { groups, mixed: groups.length > 1, count: list.length };
}

const EMPTY = { term: '', entity: 'all', status: 'all', dateFrom: '', dateTo: '', paidFrom: '', paidTo: '' };

export default function FactuurStatusPage() {
  const supabase = createClient();
  const [f, setF] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);
  const [vendorFilter, setVendorFilter] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [selected, setSelected] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const debounce = useRef(null);
  const selectAllRef = useRef(null);

  // Databanner: laatste load + totaal aantal regels
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMetaLoading(true);
      try {
        const [lastRes, countRes] = await Promise.all([
          supabase.from('invoice_ledger')
            .select('loaded_at, source_file')
            .order('loaded_at', { ascending: false })
            .limit(1),
          supabase.from('invoice_ledger')
            .select('id', { count: 'exact', head: true }),
        ]);
        if (cancelled) return;
        setMeta({
          loadedAt:   lastRes.data?.[0]?.loaded_at || null,
          sourceFile: lastRes.data?.[0]?.source_file || null,
          totalRows:  countRes.count ?? null,
        });
      } catch {
        if (!cancelled) setMeta(null);
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const runSearch = useCallback(async (flt) => {
    const query = (flt.term || '').trim();
    const hasFilter = query.length >= 2 || flt.entity !== 'all' || flt.status !== 'all'
      || flt.dateFrom || flt.dateTo || flt.paidFrom || flt.paidTo;
    if (!hasFilter) { setRows([]); setSearched(false); setSelected(new Set()); return; }
    setLoading(true); setError(null);
    try {
      let sb = supabase
        .from('invoice_ledger')
        .select('entity, vendor_code, vendor_name, invoice_number, voucher_number, po_number, invoice_date, amount, balance, fully_paid, paid_date')
        .order('invoice_date', { ascending: false })
        .limit(200);

      if (query.length >= 2) {
        const safe = query.replace(/[%,()]/g, ' ');
        sb = sb.or(
          `vendor_name.ilike.%${safe}%,vendor_code.ilike.%${safe}%,invoice_number.ilike.%${safe}%,po_number.ilike.%${safe}%,voucher_number.ilike.%${safe}%`
        );
      }
      if (flt.entity !== 'all') sb = sb.eq('entity', flt.entity);
      if (flt.status === 'open') sb = sb.gt('balance', 0);
      if (flt.status === 'betaald') sb = sb.eq('fully_paid', true);
      if (flt.dateFrom) sb = sb.gte('invoice_date', flt.dateFrom);
      if (flt.dateTo) sb = sb.lte('invoice_date', flt.dateTo);
      if (flt.paidFrom) sb = sb.gte('paid_date', flt.paidFrom);
      if (flt.paidTo) sb = sb.lte('paid_date', flt.paidTo);

      const { data, error } = await sb;
      if (error) throw error;
      setRows((data || []).map((r, i) => ({ ...r, _k: 'r' + i })));
      setSelected(new Set());
      setSearched(true);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(f), 300);
    return () => clearTimeout(debounce.current);
  }, [f, runSearch]);

  const set = (patch) => setF(prev => ({ ...prev, ...patch }));
  const resetAll = () => {
    setF(EMPTY); setVendorFilter(''); setSort({ key: null, dir: 'asc' }); setSelected(new Set());
  };

  const toggleSort = (col) => {
    setSort(prev => {
      if (prev.key !== col.key) return { key: col.key, dir: defaultDir(col.type) };
      const def = defaultDir(col.type);
      if (prev.dir === def) return { key: col.key, dir: def === 'asc' ? 'desc' : 'asc' };
      return { key: null, dir: 'asc' };
    });
  };

  const vendorOptions = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const code = (r.vendor_code || '').toString();
      const name = (r.vendor_name || '').toString();
      if (!code && !name) continue;
      const k = code + '||' + name;
      if (!map.has(k)) map.set(k, { k, code, name });
    }
    return [...map.values()].sort((a, b) =>
      (a.name || a.code).localeCompare(b.name || b.code, 'nl', { numeric: true, sensitivity: 'base' }));
  }, [rows]);

  useEffect(() => {
    if (vendorFilter && !vendorOptions.some(v => v.k === vendorFilter)) setVendorFilter('');
  }, [vendorOptions, vendorFilter]);

  const displayRows = useMemo(() => {
    let out = rows;
    if (vendorFilter) {
      out = out.filter(r => ((r.vendor_code || '') + '||' + (r.vendor_name || '')) === vendorFilter);
    }
    if (sort.key) {
      const col = COLS.find(c => c.key === sort.key);
      if (col) out = [...out].sort((a, b) => compareRows(a, b, col, sort.dir));
    }
    return out;
  }, [rows, vendorFilter, sort]);

  useEffect(() => {
    setSelected(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(displayRows.map(r => r._k));
      const next = new Set([...prev].filter(k => visible.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [displayRows]);

  const selectedRows = useMemo(
    () => displayRows.filter(r => selected.has(r._k)),
    [displayRows, selected]
  );

  const totals = useMemo(() => computeTotals(displayRows), [displayRows]);
  const selTotals = useMemo(() => computeTotals(selectedRows), [selectedRows]);

  const allSelected = displayRows.length > 0 && selected.size === displayRows.length;
  const someSelected = selected.size > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(displayRows.map(r => r._k)));
  };
  const toggleOne = (k) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const hasAnyFilter = f.dateFrom || f.dateTo || f.paidFrom || f.paidTo
    || f.status !== 'all' || f.entity !== 'all' || f.term || vendorFilter || sort.key || selected.size > 0;

  const fresh = freshness(meta?.loadedAt);

  const exportExcel = async () => {
    const src = selectedRows.length > 0 ? selectedRows : displayRows;
    if (!src.length || exporting) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Building Depot BI';
      wb.created = new Date();
      const ws = wb.addWorksheet('Factuurstatus');

      ws.columns = [
        { header: 'Leverancier',  key: 'vendor_name',    width: 34 },
        { header: 'Vendor#',      key: 'vendor_code',    width: 12 },
        { header: 'Factuur',      key: 'invoice_number', width: 18 },
        { header: 'PO',           key: 'po_number',      width: 10 },
        { header: 'Voucher',      key: 'voucher_number', width: 14 },
        { header: 'Entiteit',     key: 'entity',         width: 14 },
        { header: 'Factuurdatum', key: 'invoice_date',   width: 14 },
        { header: 'Valuta',       key: 'currency',       width: 9  },
        { header: 'Bedrag',       key: 'amount',         width: 16 },
        { header: 'Status',       key: 'status',         width: 10 },
        { header: 'Betaald op',   key: 'paid_date',      width: 14 },
      ];

      for (const r of src) {
        const row = ws.addRow({
          vendor_name:    r.vendor_name || '',
          vendor_code:    r.vendor_code || '',
          invoice_number: r.invoice_number || '',
          po_number:      r.po_number || '',
          voucher_number: r.voucher_number || '',
          entity:         ENTITY_LABEL[r.entity] || r.entity || '',
          invoice_date:   r.invoice_date ? new Date(r.invoice_date) : null,
          currency:       currencyOf(r),
          amount:         (r.amount === null || r.amount === undefined || isNaN(parseFloat(r.amount))) ? null : parseFloat(r.amount),
          status:         isOpen(r) ? 'Open' : 'Betaald',
          paid_date:      r.paid_date ? new Date(r.paid_date) : null,
        });
        row.getCell('invoice_date').numFmt = 'dd-mm-yyyy';
        row.getCell('paid_date').numFmt = 'dd-mm-yyyy';
        row.getCell('amount').numFmt = '#,##0.00';
      }

      const t = computeTotals(src);
      ws.addRow({});
      for (const g of t.groups) {
        const tr = ws.addRow({
          vendor_name: `Totaal ${g.cur} (${g.count} facturen)`,
          currency: g.cur,
          amount: g.total,
        });
        tr.font = { bold: true };
        tr.getCell('amount').numFmt = '#,##0.00';
        const o = ws.addRow({ vendor_name: `  waarvan open (${g.openCount})`, currency: g.cur, amount: g.openTotal });
        o.getCell('amount').numFmt = '#,##0.00';
        const p = ws.addRow({ vendor_name: `  waarvan betaald (${g.paidCount})`, currency: g.cur, amount: g.paidTotal });
        p.getCell('amount').numFmt = '#,##0.00';
      }

      // Herkomstregel: welke dataload zit hierachter
      ws.addRow({});
      const srcRow = ws.addRow({ vendor_name: `Databron laatst bijgewerkt: ${fmtDateTime(meta?.loadedAt)}` });
      srcRow.font = { italic: true, size: 9 };

      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
      header.alignment = { vertical: 'middle' };
      ws.autoFilter = { from: 'A1', to: 'K1' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      const vendorTag = vendorFilter
        ? '_' + (vendorOptions.find(v => v.k === vendorFilter)?.name || 'leverancier').replace(/[^\w]+/g, '-').slice(0, 30)
        : '';
      const selTag = selectedRows.length > 0 ? '_selectie' : '';
      a.href = url;
      a.download = `factuurstatus${vendorTag}${selTag}_${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Export mislukt: ' + (e.message || String(e)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Factuurstatus</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-3">
        Zoek op leverancier, vendornummer, PO, factuurnummer of voucher om te zien of een factuur geboekt is en of die al betaald is.
      </p>

      {/* Databanner: wanneer is de data voor het laatst bijgewerkt */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        {metaLoading ? (
          <span className="text-[12px] text-[#1B3A5C]/40">Databron controleren...</span>
        ) : !meta?.loadedAt ? (
          <span className="text-[12px] text-red-700">
            Kon de laatste dataload niet bepalen — controleer of de pipeline draait.
          </span>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${fresh.dot}`} />
              <span className="text-[12px] text-[#1B3A5C]">
                <span className="font-semibold">Laatst bijgewerkt:</span> {fmtDateTime(meta.loadedAt)}
              </span>
            </span>
            <span className={`text-[11px] font-semibold ${
              fresh.tone === 'green' ? 'text-emerald-700'
              : fresh.tone === 'amber' ? 'text-amber-700'
              : fresh.tone === 'red' ? 'text-red-700' : 'text-[#1B3A5C]/50'}`}>
              {fresh.label}
            </span>
            {meta.totalRows !== null && (
              <span className="text-[11px] text-[#1B3A5C]/50">
                {new Intl.NumberFormat('nl-NL').format(meta.totalRows)} regels in de ledger
              </span>
            )}
            {meta.sourceFile && (
              <span className="text-[11px] text-[#1B3A5C]/40 font-mono truncate max-w-[280px]" title={meta.sourceFile}>
                {meta.sourceFile}
              </span>
            )}
          </>
        )}
      </div>

      {/* Entiteit-knoppen */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ENTITIES.map(e => (
          <button key={e.key} onClick={() => set({ entity: e.key })}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              f.entity === e.key ? 'bg-[#1B3A5C] text-white' : 'bg-gray-100 text-[#1B3A5C]/70 hover:bg-gray-200'}`}>
            {e.label}
          </button>
        ))}
      </div>

      {/* Zoekbalk + status- en leveranciersfilter */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text" value={f.term} onChange={e => set({ term: e.target.value })} autoFocus
          placeholder="Zoek leverancier, vendornr, PO, factuurnr of voucher..."
          className="flex-1 min-w-[260px] px-4 py-2.5 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:border-[#1B3A5C]"
        />
        <select value={f.status} onChange={e => set({ status: e.target.value })}
          className="px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] bg-white">
          <option value="all">Alle statussen</option>
          <option value="open">Alleen open</option>
          <option value="betaald">Alleen betaald</option>
        </select>
        <select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}
          disabled={vendorOptions.length === 0}
          title={vendorOptions.length === 0 ? 'Zoek eerst; de dropdown vult zich met de gevonden leveranciers' : 'Filter op leverancier'}
          className="px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] bg-white max-w-[240px] disabled:opacity-50">
          <option value="">Alle leveranciers</option>
          {vendorOptions.map(v => (
            <option key={v.k} value={v.k}>{(v.name || '—')}{v.code ? ` (${v.code})` : ''}</option>
          ))}
        </select>
      </div>

      {/* Datum-ranges */}
      <div className="flex flex-wrap items-center gap-4 mb-4 bg-[#f8fafc] rounded-xl px-4 py-2.5 border border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#1B3A5C]/60 font-semibold">Factuurdatum</span>
          <input type="date" value={f.dateFrom} onChange={e => set({ dateFrom: e.target.value })}
            className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
          <span className="text-[11px] text-[#1B3A5C]/40">t/m</span>
          <input type="date" value={f.dateTo} onChange={e => set({ dateTo: e.target.value })}
            className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#1B3A5C]/60 font-semibold">Betaaldatum</span>
          <input type="date" value={f.paidFrom} onChange={e => set({ paidFrom: e.target.value })}
            className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
          <span className="text-[11px] text-[#1B3A5C]/40">t/m</span>
          <input type="date" value={f.paidTo} onChange={e => set({ paidTo: e.target.value })}
            className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] bg-white" />
        </div>
        {hasAnyFilter && (
          <button onClick={resetAll} className="ml-auto text-[11px] text-[#1B3A5C]/50 hover:text-[#1B3A5C] underline">
            Wis filters
          </button>
        )}
      </div>

      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Zoeken...</div>
      ) : !searched ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Typ minimaal 2 tekens of kies een filter om te zoeken.</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40 italic">
          Geen facturen gevonden. Staat het hier niet, dan is de factuur (nog) niet geboekt.
        </div>
      ) : (
        <>
          {/* Totalenbalk */}
          <div className="mb-3 rounded-xl border border-gray-200 bg-[#f8fafc] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#1B3A5C]/45 font-semibold">Facturen</div>
                <div className="text-[15px] font-bold text-[#1B3A5C]">{totals.count}</div>
              </div>
              {totals.groups.map(g => (
                <div key={g.cur} className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-[#1B3A5C]/45 font-semibold">
                      Totaal{totals.mixed ? ` ${g.cur}` : ''}
                    </div>
                    <div className="text-[15px] font-bold text-[#1B3A5C]">{fmtMoney(g.total, g.cur)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-amber-700/70 font-semibold">Open ({g.openCount})</div>
                    <div className="text-[14px] font-semibold text-amber-700">{fmtMoney(g.openTotal, g.cur)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-emerald-700/70 font-semibold">Betaald ({g.paidCount})</div>
                    <div className="text-[14px] font-semibold text-emerald-700">{fmtMoney(g.paidTotal, g.cur)}</div>
                  </div>
                </div>
              ))}
              <button onClick={exportExcel} disabled={exporting || displayRows.length === 0}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                {exporting
                  ? 'Exporteren...'
                  : `Exporteer naar Excel (${selectedRows.length > 0 ? selectedRows.length : displayRows.length})`}
              </button>
            </div>

            {totals.mixed && (
              <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                Let op: je resultaten bevatten zowel USD (Bonaire) als XCG. Bedragen zijn daarom per valuta getotaliseerd, niet opgeteld.
                Kies een entiteit hierboven voor één totaal.
              </div>
            )}

            {selectedRows.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-gray-200 pt-2">
                <span className="text-[11px] font-semibold text-[#1B3A5C]">
                  Selectie: {selectedRows.length} {selectedRows.length === 1 ? 'factuur' : 'facturen'}
                </span>
                {selTotals.groups.map(g => (
                  <span key={g.cur} className="text-[12px] text-[#1B3A5C]">
                    <span className="font-bold">{fmtMoney(g.total, g.cur)}</span>
                    <span className="text-[#1B3A5C]/50">
                      {' '}(open {fmtMoney(g.openTotal, g.cur)} · betaald {fmtMoney(g.paidTotal, g.cur)})
                    </span>
                  </span>
                ))}
                <button onClick={() => setSelected(new Set())}
                  className="ml-auto text-[11px] text-[#1B3A5C]/50 hover:text-[#1B3A5C] underline">
                  Selectie wissen
                </button>
              </div>
            )}
          </div>

          <div className="text-[11px] text-[#1B3A5C]/50 mb-2">
            {vendorFilter
              ? `${displayRows.length} van ${rows.length} resultaten (gefilterd op leverancier)`
              : `${rows.length} resultaten`}
            {rows.length === 200 ? ' · max 200 — verfijn je zoekterm/filters' : ''}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-[#1B3A5C]/70">
                <tr>
                  <th className="p-2 w-8 text-center">
                    <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll}
                      title="Alles selecteren" className="cursor-pointer accent-[#1B3A5C]" />
                  </th>
                  {COLS.map(col => (
                    <th key={col.key} onClick={() => toggleSort(col)}
                      className={`p-2 font-semibold cursor-pointer select-none hover:text-[#1B3A5C] transition-colors ${
                        col.align === 'right' ? 'text-right' : 'text-left'}`}>
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                        {col.label}
                        <span className="text-[8px] leading-none text-[#1B3A5C]/40">
                          {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={COLS.length + 1} className="p-6 text-center text-[12px] text-[#1B3A5C]/40 italic">
                      Geen facturen voor deze leverancier binnen de huidige resultaten.
                    </td>
                  </tr>
                ) : displayRows.map((r) => {
                  const open = isOpen(r);
                  const sel = selected.has(r._k);
                  return (
                    <tr key={r._k}
                      className={`border-t border-gray-100 ${sel ? 'bg-[#1B3A5C]/[0.04]' : 'hover:bg-gray-50/60'}`}>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(r._k)}
                          className="cursor-pointer accent-[#1B3A5C]" />
                      </td>
                      <td className="p-2">{r.vendor_name || '—'}</td>
                      <td className="p-2 font-mono text-[#1B3A5C]/60">{r.vendor_code || '—'}</td>
                      <td className="p-2 font-mono">{r.invoice_number || '—'}</td>
                      <td className="p-2 font-mono">{r.po_number || '—'}</td>
                      <td className="p-2 font-mono text-[#1B3A5C]/60">{r.voucher_number || '—'}</td>
                      <td className="p-2">{ENTITY_LABEL[r.entity] || r.entity}</td>
                      <td className="p-2 whitespace-nowrap text-[#1B3A5C]/70">{fmtDate(r.invoice_date)}</td>
                      <td className="p-2 text-right whitespace-nowrap">{fmtMoney(r.amount, currencyOf(r))}</td>
                      <td className="p-2 whitespace-nowrap">
                        {open ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">Open</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">Betaald</span>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap text-[#1B3A5C]/70">{r.paid_date ? fmtDate(r.paid_date) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  {totals.groups.map(g => (
                    <tr key={g.cur}>
                      <td colSpan={8} className="p-2 text-right font-semibold text-[#1B3A5C]/70">
                        Totaal{totals.mixed ? ` ${g.cur}` : ''} ({g.count})
                      </td>
                      <td className="p-2 text-right font-bold text-[#1B3A5C] whitespace-nowrap">{fmtMoney(g.total, g.cur)}</td>
                      <td colSpan={2} className="p-2 text-[11px] text-[#1B3A5C]/55 whitespace-nowrap">
                        open {fmtMoney(g.openTotal, g.cur)} · betaald {fmtMoney(g.paidTotal, g.cur)}
                      </td>
                    </tr>
                  ))}
                  {selectedRows.length > 0 && selTotals.groups.map(g => (
                    <tr key={'sel-' + g.cur} className="bg-[#1B3A5C]/[0.05]">
                      <td colSpan={8} className="p-2 text-right font-semibold text-[#1B3A5C]/70">
                        Selectie{selTotals.mixed ? ` ${g.cur}` : ''} ({g.count})
                      </td>
                      <td className="p-2 text-right font-bold text-[#1B3A5C] whitespace-nowrap">{fmtMoney(g.total, g.cur)}</td>
                      <td colSpan={2} className="p-2 text-[11px] text-[#1B3A5C]/55 whitespace-nowrap">
                        open {fmtMoney(g.openTotal, g.cur)} · betaald {fmtMoney(g.paidTotal, g.cur)}
                      </td>
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>

          <p className="mt-3 text-[11px] text-[#1B3A5C]/40">
            Bron: dagelijkse Compass-export. "Betaald" betekent volledig afgeletterd; "Open" staat nog uit.
            Totalen gelden over de zichtbare rijen (max 200 per zoekopdracht). De Excel-export bevat je selectie, of anders alle zichtbare rijen.
          </p>
        </>
      )}
    </div>
  );
}