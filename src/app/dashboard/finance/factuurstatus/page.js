/* ============================================================
   BESTAND: factuurstatus_page.js  (v8)
   KOPIEER NAAR: src/app/dashboard/finance/factuurstatus/page.js

   DOEL: intern zoekbaar rapport "is mijn factuur geboekt/betaald?".
   Leest public.invoice_ledger (read-only) + ledger_load_log.

   v8:
   - Databanner leest nu ledger_load_log: laatste run, aantal regels,
     +nieuw, niet-in-laatste-export, bronbestand, status.
     Valt terug op max(loaded_at) uit invoice_ledger als het log leeg is.
   - Waarschuwing als de laatste run niet op status 'ok' stond.
   v7:
   - BDMS uit de entiteit-knoppen; toekomstdatum-waarschuwing eruit.
   v6:
   - Databanner met stoplicht op basis van loaded_at.
   v5:
   - Totalen (balk + tfoot), selecteerbare rijen, valutabewaking USD/XCG.
   v4:
   - Status Open/Betaald; kolom "Betaald op"; Excel-export.
   v3:
   - Leveranciers-dropdown; sorteerbare kolomkoppen.
   v2:
   - Zoeken op vendornummer; entiteit-knoppen; datum-ranges.
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

const nl = (n) => new Intl.NumberFormat('nl-NL').format(n);

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

  // Databanner: laatste run uit ledger_load_log, met fallback op invoice_ledger
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMetaLoading(true);
      try {
        const logRes = await supabase
          .from('ledger_load_log')
          .select('run_at, source_file, rows_in_file, rows_after, rows_new, rows_stale, status, message')
          .order('run_at', { ascending: false })
          .limit(1);

        const log = logRes.data?.[0];
        if (log) {
          if (!cancelled) {
            setMeta({
              loadedAt:   log.run_at,
              sourceFile: log.source_file,
              totalRows:  log.rows_after,
              rowsInFile: log.rows_in_file,
              rowsNew:    log.rows_new,
              rowsStale:  log.rows_stale,
              status:     log.status,
              message:    log.message,
              fromLog:    true,
            });
          }
          return;
        }

        // Fallback: nog geen runlog (bv. alleen handmatige uploads gedaan)
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
          fromLog:    false,
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
          invoice_date