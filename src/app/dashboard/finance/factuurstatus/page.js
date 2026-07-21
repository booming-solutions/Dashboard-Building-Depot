/* ============================================================
   BESTAND: factuurstatus_page.js  (v3)
   KOPIEER NAAR: src/app/dashboard/finance/factuurstatus/page.js

   DOEL: intern zoekbaar rapport "is mijn factuur geboekt/betaald?".
   Leest public.invoice_ledger (read-only).

   v3:
   - Leveranciers-dropdown: filtert de huidige resultaten op één vendor
     (client-side, gevuld uit de geladen rijen; respecteert entiteit/datum).
   - Alle kolomkoppen klikbaar => sorteren (asc/desc, 3e klik = reset).
     Lege waarden altijd onderaan. Datum/bedrag starten aflopend,
     tekstkolommen oplopend met natuurlijke nummer-sortering.
   v2:
   - Zoekt ook op vendornummer (vendor_code) en toont het.
   - Entiteit-knoppen (ALL/BDT/BDB/MMC/RCC/BDMS), default ALL.
   - Filter op factuurdatum (range) en betaaldatum (range).
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
  { key: 'BDMS', label: 'BDMS' },
];
const ENTITY_LABEL = { BDT: 'Curaçao', BDB: 'Bonaire', MMC: 'Multimart', RCC: 'Repair Centre', BDMS: 'BDMS' };

function fmtMoney(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return 'XCG ' + new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Kolomdefinitie voor de sorteerbare tabel
const COLS = [
  { key: 'vendor_name',    label: 'Leverancier', type: 'text',   align: 'left'  },
  { key: 'vendor_code',    label: 'Vendor#',     type: 'text',   align: 'left'  },
  { key: 'invoice_number', label: 'Factuur',     type: 'text',   align: 'left'  },
  { key: 'po_number',      label: 'PO',          type: 'text',   align: 'left'  },
  { key: 'voucher_number', label: 'Voucher',     type: 'text',   align: 'left'  },
  { key: 'entity',         label: 'Entiteit',    type: 'text',   align: 'left'  },
  { key: 'invoice_date',   label: 'Datum',       type: 'date',   align: 'left'  },
  { key: 'amount',         label: 'Bedrag',      type: 'num',    align: 'right' },
  { key: 'status',         label: 'Status',      type: 'status', align: 'left'  },
];

const defaultDir = (type) => (type === 'num' || type === 'date') ? 'desc' : 'asc';

// Sorteerwaarde per kolom: { empty, val }
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
    case 'status': {
      const open = parseFloat(row.balance) > 0 && !row.fully_paid;
      return { empty: false, val: open ? 0 : 1 }; // open eerst bij oplopend
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
  if (av.empty) return 1;   // lege waarden altijd onderaan, ongeacht richting
  if (bv.empty) return -1;
  let base;
  if (col.type === 'text') {
    base = av.val.localeCompare(bv.val, 'nl', { numeric: true, sensitivity: 'base' });
  } else {
    base = av.val - bv.val;
  }
  return dir === 'asc' ? base : -base;
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
  const debounce = useRef(null);

  const runSearch = useCallback(async (flt) => {
    const query = (flt.term || '').trim();
    const hasFilter = query.length >= 2 || flt.entity !== 'all' || flt.status !== 'all'
      || flt.dateFrom || flt.dateTo || flt.paidFrom || flt.paidTo;
    if (!hasFilter) { setRows([]); setSearched(false); return; }
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
      setRows(data || []);
      setSearched(true);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // debounce op tekst, direct op de overige filters
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(f), 300);
    return () => clearTimeout(debounce.current);
  }, [f, runSearch]);

  const set = (patch) => setF(prev => ({ ...prev, ...patch }));
  const resetAll = () => { setF(EMPTY); setVendorFilter(''); setSort({ key: null, dir: 'asc' }); };

  const toggleSort = (col) => {
    setSort(prev => {
      if (prev.key !== col.key) return { key: col.key, dir: defaultDir(col.type) };
      const def = defaultDir(col.type);
      if (prev.dir === def) return { key: col.key, dir: def === 'asc' ? 'desc' : 'asc' };
      return { key: null, dir: 'asc' }; // 3e klik: terug naar serverdefault (datum aflopend)
    });
  };

  // Leveranciers voor de dropdown, afgeleid uit de geladen rijen
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

  // Reset vendorfilter als de gekozen vendor niet meer in de resultaten zit
  useEffect(() => {
    if (vendorFilter && !vendorOptions.some(v => v.k === vendorFilter)) setVendorFilter('');
  }, [vendorOptions, vendorFilter]);

  // Zichtbare rijen: eerst vendorfilter, dan sortering (beide client-side)
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

  const hasAnyFilter = f.dateFrom || f.dateTo || f.paidFrom || f.paidTo
    || f.status !== 'all' || f.entity !== 'all' || f.term || vendorFilter || sort.key;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Factuurstatus</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-4">
        Zoek op leverancier, vendornummer, PO, factuurnummer of voucher om te zien of een factuur geboekt is en of die al betaald is.
      </p>

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
                    <td colSpan={COLS.length} className="p-6 text-center text-[12px] text-[#1B3A5C]/40 italic">
                      Geen facturen voor deze leverancier binnen de huidige resultaten.
                    </td>
                  </tr>
                ) : displayRows.map((r, i) => {
                  const open = parseFloat(r.balance) > 0 && !r.fully_paid;
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="p-2">{r.vendor_name || '—'}</td>
                      <td className="p-2 font-mono text-[#1B3A5C]/60">{r.vendor_code || '—'}</td>
                      <td className="p-2 font-mono">{r.invoice_number || '—'}</td>
                      <td className="p-2 font-mono">{r.po_number || '—'}</td>
                      <td className="p-2 font-mono text-[#1B3A5C]/60">{r.voucher_number || '—'}</td>
                      <td className="p-2">{ENTITY_LABEL[r.entity] || r.entity}</td>
                      <td className="p-2 whitespace-nowrap text-[#1B3A5C]/70">{fmtDate(r.invoice_date)}</td>
                      <td className="p-2 text-right whitespace-nowrap">{fmtMoney(r.amount)}</td>
                      <td className="p-2 whitespace-nowrap">
                        {open ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">Open</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            Betaald{r.paid_date ? ` · ${fmtDate(r.paid_date)}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-[#1B3A5C]/40">
            Bron: dagelijkse Compass-export. "Betaald" betekent volledig afgeletterd; "Open" staat nog uit.
          </p>
        </>
      )}
    </div>
  );
}