/* ============================================================
   BESTAND: ledger_upload_page.js
   KOPIEER NAAR: src/app/dashboard/finance/ledger-upload/page.js
   (nieuwe map: ledger-upload/, hernoemen naar page.js)

   DOEL: het Compass-exportbestand (volledige snapshot, xlsx) inlezen
   en de tabel invoice_ledger vervangen. Alleen voor admins.
   Regels:
     - entiteit uit laatste 3 cijfers van Account Number:
         000=BDT, 400=RCC, 600=MMC, 700=BDB, 888=BDMS. Andere → overslaan.
     - alleen regels met invoice-datum >= 2025-01-01.
     - bedragen in XCG (geen omrekening).
     - dagelijkse volledige snapshot → eerst legen, dan herladen.

   Later vervangt een mailscheduler deze handmatige stap; dezelfde
   parselogica verhuist dan server-side.
   ============================================================ */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import * as XLSX from 'xlsx';

const ENTITY_MAP = { 0: 'BDT', 400: 'RCC', 600: 'MMC', 700: 'BDB', 888: 'BDMS' };
const MIN_DATE = '2025-01-01';
const BATCH = 500;

function toISO(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim(); if (!s) return null;
  const d = new Date(s.split(' ')[0].split('T')[0]);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function voucherStr(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? String(n) : String(v).trim();
}

export default function LedgerUploadPage() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setIsAdmin(data?.role === 'admin');
    })();
  }, [supabase]);

  const addLog = (m) => setLog(l => [...l, m]);

  const parseRows = useCallback((wb) => {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
    if (!raw.length) return { rows: [], skipped: 0, byEntity: {} };
    const head = raw[0].map(h => String(h).trim());
    const col = (name) => head.indexOf(name);
    const ix = {
      vcode: col('Vendor Code'), vname: col('Vendor Name'), date: col('Date'),
      value: col('Value'), inv: col('Invoice Number Header'), paid: col('Fully Paid'),
      bal: col('Balance'), paidDate: col('Fully Paid Date'), po: col('PO Number'),
      acct: col('Account Number'), voucher: col('Voucher Number'),
    };
    const rows = []; let skipped = 0; const byEntity = {};
    for (let i = 1; i < raw.length; i++) {
      const r = raw[i]; if (!r) { skipped++; continue; }
      const vcode = String(r[ix.vcode] ?? '').trim();
      if (!/^\d+$/.test(vcode)) { skipped++; continue; }               // Grand Summaries / leeg
      const acct = parseFloat(r[ix.acct]);
      if (isNaN(acct)) { skipped++; continue; }
      const entity = ENTITY_MAP[Math.trunc(acct) % 1000];
      if (!entity) { skipped++; continue; }                            // onbekende entiteit → overslaan
      const invDate = toISO(r[ix.date]);
      if (!invDate || invDate < MIN_DATE) { skipped++; continue; }     // filter < 2025
      rows.push({
        entity,
        vendor_code: vcode,
        vendor_name: String(r[ix.vname] ?? '').trim() || null,
        invoice_number: String(r[ix.inv] ?? '').trim() || null,
        voucher_number: voucherStr(r[ix.voucher]),
        invoice_date: invDate,
        amount: num(r[ix.value]),
        balance: num(r[ix.bal]),
        fully_paid: String(r[ix.paid] ?? '').trim().toUpperCase() === 'X',
        paid_date: toISO(r[ix.paidDate]),
        po_number: String(r[ix.po] ?? '').trim() || null,
        account_number: String(Math.trunc(acct)),
      });
      byEntity[entity] = (byEntity[entity] || 0) + 1;
    }
    return { rows, skipped, byEntity };
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setLog([]); setStats(null);
    try {
      addLog(`Inlezen: ${file.name} (${(file.size / 1e6).toFixed(1)} MB)...`);
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      addLog('Parsen en filteren...');
      const { rows, skipped, byEntity } = parseRows(wb);
      addLog(`${rows.length} regels na filter (overgeslagen: ${skipped}).`);
      addLog(`Per entiteit: ${Object.entries(byEntity).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      if (!rows.length) { addLog('Geen bruikbare regels — gestopt.'); setBusy(false); return; }

      // volledige snapshot → eerst legen
      addLog('Ledger legen...');
      const { error: delErr } = await supabase.from('invoice_ledger').delete().gte('id', 0);
      if (delErr) throw new Error('Legen faalt: ' + delErr.message);

      // in batches laden
      const stamp = new Date().toISOString();
      let done = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH).map(x => ({ ...x, source_file: file.name, loaded_at: stamp }));
        const { error } = await supabase.from('invoice_ledger').insert(chunk);
        if (error) throw new Error(`Batch ${i / BATCH + 1} faalt: ${error.message}`);
        done += chunk.length;
        if (done % 2500 === 0 || done === rows.length) addLog(`Geladen: ${done}/${rows.length}`);
      }
      const openCount = rows.filter(r => r.balance > 0 && !r.fully_paid).length;
      setStats({ total: rows.length, open: openCount, betaald: rows.length - openCount, byEntity, skipped });
      addLog('Klaar.');
    } catch (e) {
      addLog('FOUT: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }, [supabase, parseRows]);

  if (isAdmin === null) return <div className="py-16 text-center text-[13px] text-[#1B3A5C]/40">Laden...</div>;
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-amber-900 mb-2">Alleen voor admins</h2>
          <p className="text-[13px] text-amber-800">Het laden van de ledger is voorbehouden aan beheerders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">Ledger laden</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-5">
        Upload de volledige Compass-export (.xlsx). De tabel wordt vervangen door een verse snapshot,
        gefilterd op herkende entiteiten en facturen vanaf {MIN_DATE}.
      </p>

      <label className={`block rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all
        ${busy ? 'border-gray-200 bg-gray-50 pointer-events-none' : 'border-[#1B3A5C]/30 hover:border-[#1B3A5C] hover:bg-[#1B3A5C]/[0.03]'}`}>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
          disabled={busy} onChange={e => handleFile(e.target.files?.[0])} />
        <div className="text-[14px] font-semibold text-[#1B3A5C]">{busy ? 'Bezig...' : 'Kies of sleep het exportbestand hierheen'}</div>
        <div className="text-[11px] text-[#1B3A5C]/40 mt-1">.xlsx — volledige lijst</div>
      </label>

      {log.length > 0 && (
        <div className="mt-4 rounded-xl bg-[#0f172a] text-[#e2e8f0] p-4 text-[12px] font-mono space-y-0.5 max-h-72 overflow-y-auto">
          {log.map((l, i) => <div key={i} className={l.startsWith('FOUT') ? 'text-red-400' : ''}>{l}</div>)}
        </div>
      )}

      {stats && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Geladen" value={stats.total} />
          <Stat label="Open" value={stats.open} />
          <Stat label="Betaald" value={stats.betaald} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center">
      <div className="text-[22px] font-bold text-[#1B3A5C]">{new Intl.NumberFormat('nl-NL').format(value)}</div>
      <div className="text-[11px] text-[#1B3A5C]/50">{label}</div>
    </div>
  );
}
