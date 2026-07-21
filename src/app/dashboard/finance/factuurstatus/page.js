/* ============================================================
   BESTAND: factuurstatus_page.js
   KOPIEER NAAR: src/app/dashboard/finance/factuurstatus/page.js
   (nieuwe map: factuurstatus/, hernoemen naar page.js)

   DOEL: intern zoekbaar rapport "is mijn factuur geboekt/betaald?".
   Voor elke ingelogde medewerker. Leest public.invoice_ledger.
   Zoek op vendor / PO / factuurnummer / voucher. Toont per factuur:
   entiteit, bedrag (XCG), open of betaald, betaaldatum.

   Data komt uit het dagelijkse Compass-export (ledger). Los van de
   AP-werkstroom. Server-side zoeken (ledger is groot), max 200 hits.
   ============================================================ */
'use client';

import { useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';

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

export default function FactuurStatusPage() {
  const supabase = createClient();
  const [term, setTerm] = useState('');
  const [entity, setEntity] = useState('all');
  const [status, setStatus] = useState('all'); // all | open | betaald
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);
  const debounce = useRef(null);

  const runSearch = useCallback(async (q, ent, st) => {
    const query = (q || '').trim();
    if (query.length < 2) { setRows([]); setSearched(false); return; }
    setLoading(true); setError(null);
    try {
      let sb = supabase
        .from('invoice_ledger')
        .select('entity, vendor_name, invoice_number, voucher_number, po_number, invoice_date, amount, balance, fully_paid, paid_date')
        .order('invoice_date', { ascending: false })
        .limit(200);

      // vrij zoeken over vendor / factuur / po / voucher
      const safe = query.replace(/[%,()]/g, ' ');
      sb = sb.or(
        `vendor_name.ilike.%${safe}%,invoice_number.ilike.%${safe}%,po_number.ilike.%${safe}%,voucher_number.ilike.%${safe}%`
      );
      if (ent !== 'all') sb = sb.eq('entity', ent);
      if (st === 'open') sb = sb.gt('balance', 0);
      if (st === 'betaald') sb = sb.eq('fully_paid', true);

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

  const onTerm = (v) => {
    setTerm(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(v, entity, status), 350);
  };
  const onFilter = (nextEnt, nextSt) => {
    setEntity(nextEnt); setStatus(nextSt);
    runSearch(term, nextEnt, nextSt);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Factuurstatus</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-4">
        Zoek op leverancier, PO-nummer, factuurnummer of voucher om te zien of een factuur geboekt is en of die al betaald is.
      </p>

      {/* Zoekbalk */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text" value={term} onChange={e => onTerm(e.target.value)} autoFocus
          placeholder="Zoek leverancier, PO, factuurnummer of voucher..."
          className="flex-1 min-w-[280px] px-4 py-2.5 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:border-[#1B3A5C]"
        />
        <select value={entity} onChange={e => onFilter(e.target.value, status)}
          className="px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] bg-white">
          <option value="all">Alle entiteiten</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={e => onFilter(entity, e.target.value)}
          className="px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] bg-white">
          <option value="all">Alle statussen</option>
          <option value="open">Alleen open</option>
          <option value="betaald">Alleen betaald</option>
        </select>
      </div>

      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Zoeken...</div>
      ) : !searched ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Typ minimaal 2 tekens om te zoeken.</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40 italic">
          Geen facturen gevonden. Staat het hier niet, dan is de factuur (nog) niet geboekt.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-[#1B3A5C]/50 mb-2">{rows.length} resultaten{rows.length === 200 ? ' (max — verfijn je zoekterm)' : ''}</div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 text-[#1B3A5C]/70">
                <tr>
                  <th className="p-2 text-left font-semibold">Leverancier</th>
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
