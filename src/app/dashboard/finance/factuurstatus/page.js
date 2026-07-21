/* ============================================================
   BESTAND: factuurstatus_page.js  (v2)
   KOPIEER NAAR: src/app/dashboard/finance/factuurstatus/page.js

   DOEL: intern zoekbaar rapport "is mijn factuur geboekt/betaald?".
   Voor elke ingelogde medewerker. Leest public.invoice_ledger.

   v2:
   - Zoekt ook op vendornummer (vendor_code) en toont het.
   - Entiteit-knoppen bovenaan (ALL/BDT/BDB/MMC/RCC/BDMS), default ALL.
   - Filter op factuurdatum (range) en betaaldatum (range).
   ============================================================ */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

const EMPTY = { term: '', entity: 'all', status: 'all', dateFrom: '', dateTo: '', paidFrom: '', paidTo: '' };

export default function FactuurStatusPage() {
  const supabase = createClient();
  const [f, setF] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);
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

      {/* Zoekbalk + statusfilter */}
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
        {(f.dateFrom || f.dateTo || f.paidFrom || f.paidTo || f.status !== 'all' || f.entity !== 'all' || f.term) && (
          <button onClick={() => setF(EMPTY)} className="ml-auto text-[11px] text-[#1B3A5C]/50 hover:text-[#1B3A5C] underline">
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
          <div className="text-[11px] text-[#1B3A5C]/50 mb-2">{rows.length} resultaten{rows.length === 200 ? ' (max — verfijn je zoekterm/filters)' : ''}</div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-[#1B3A5C]/70">
                <tr>
                  <th className="p-2 text-left font-semibold">Leverancier</th>
                  <th className="p-2 text-left font-semibold">Vendor#</th>
                  <th className="p-2 text-left font-semibold">Factuur</th>
                  <th className="p-2 text-left font-semibold">PO</th>
                  <th className="p-2 text-left font-semibold">Voucher</th>
                  <th className="p-2 text-left font-semibold">Entiteit</th>
                  <th className="p-2 text-left font-semibold">Datum</th>
                  <th className="p-2 text-right font-semibold">Bedrag</th>
                  <th className="p-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
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