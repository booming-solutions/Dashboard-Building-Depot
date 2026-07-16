/* ============================================================
   BESTAND: sandbox_ap_dib_check_page_v3.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/dib-check/page.js
   (overschrijft v2, hernoemen naar page.js)

   v3 WIJZIGINGEN:
   - Vergelijking gescoped op de actieve entiteit (.eq('entity', entity)).
     Voor de Curaçao DIB-controle staat de banner dus op BDT.

   DOEL: Do it Best (DIB) open-items controle.
   Stap 1 (handmatig): in de DIB-portal exporteer je de Invoice
     Summary CSV én de PDF (alle open items geselecteerd).
   Stap 2 (deze pagina): upload beide bestanden. De pagina
     vergelijkt de DIB open items met de AP open items en splitst
     de PDF, zodat je per NIET-geboekte factuur een losse PDF krijgt.
   Stap 3 (clerk): beoordeelt de ontbrekende facturen en mailt ze
     door naar de ingest-mailbox.

   v2 WIJZIGINGEN:
   - MEERDERE CSV- en PDF-bestanden tegelijk te uploaden. De DIB-portal
     downloadt max. 50 facturen per PDF; selecteer nu simpelweg alle
     gedownloade delen samen. CSV-regels worden samengevoegd (dedup op
     InvoiceNumber); bij het splitsen wordt elke factuur in het juiste
     PDF-deel opgezocht.

   Alles draait in de browser — CSV en PDF verlaten je computer niet.

   AANNAMES (pas aan indien nodig):
   - Match: DIB InvoiceNumber wordt gezocht in AP invoice_number,
     reference én po_number (contains). DIB-nummers zijn 9-cijferig
     en uniek, dus vrijwel geen vals-positieven.
   - Vendor-filter AP: vendor_name ilike '%DIB%' (de ~36 DIB-vendors).
   - Entiteit: MemberNumber 7107 = Curaçao (vergeleken met AP),
     7269 = Bonaire (apart, buiten AP-scope tot die entiteit is toegevoegd).

   VEREISTE NPM-PACKAGES (eenmalig installeren):
     npm install pdfjs-dist pdf-lib papaparse jszip
   ============================================================ */
// 🧪 SANDBOX BESTAND — werkt op sandbox_ap_* tabellen, geen impact op live data.
'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { useApRole } from '../layout';
import Link from 'next/link';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

// pdf.js worker via CDN (versie-exact). Voorkomt dat webpack/Terser de
// worker-.mjs probeert te bundelen/minificeren (dat faalt op import/export).
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const MEMBER_ENTITY = { '7107': 'BDT Curaçao', '7269': 'Bonaire' };

function fmtUsd(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// Papa.parse als promise, voor 1 bestand
function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve((res.data || []).filter(r => (r.InvoiceNumber || '').trim())),
      error: (err) => reject(err),
    });
  });
}

export default function DibCheckPage() {
  const { effectiveRole, entity, entityMeta } = useApRole();
  const supabase = createClient();
  const canUse = ['admin', 'cfo', 'ap_clerk'].includes(effectiveRole);

  const [csvRows, setCsvRows] = useState(null);   // samengevoegde DIB CSV-regels
  const [csvNames, setCsvNames] = useState([]);   // namen van geüploade CSV's
  const [pdfFiles, setPdfFiles] = useState([]);   // meerdere DIB-PDF's (File[])
  const [result, setResult] = useState(null);     // vergelijkingsresultaat
  const [splits, setSplits] = useState(null);     // { files:{inv:{blob,url}}, notFound:[] }
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState(null);

  // ---- CSV('s) inlezen (meerdere toegestaan) ----
  const onCsv = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setError(null); setResult(null); setSplits(null);
    try {
      const parsed = await Promise.all(files.map(parseCsv));
      const merged = parsed.flat();
      if (merged.length === 0) {
        setError('Geen InvoiceNumber-kolom gevonden. Is dit de "Invoice Summary" export?');
        return;
      }
      // dedup op InvoiceNumber (eerste blijft)
      const seen = new Set();
      const unique = [];
      for (const r of merged) {
        const key = String(r.InvoiceNumber).trim();
        if (seen.has(key)) continue;
        seen.add(key); unique.push(r);
      }
      setCsvRows(unique);
      setCsvNames(files.map(f => f.name));
    } catch (e) {
      setError('CSV lezen mislukt: ' + (e.message || String(e)));
    }
  }, []);

  // ---- PDF('s) selecteren (meerdere toegestaan) ----
  const onPdf = useCallback((fileList) => {
    setPdfFiles(Array.from(fileList || []));
    setSplits(null);
  }, []);

  // ---- Vergelijken met AP open items ----
  const runCompare = useCallback(async () => {
    if (!csvRows) return;
    setBusy(true); setError(null); setPhase('AP open items ophalen...');
    try {
      const { data: ap, error: apErr } = await supabase
        .from('sandbox_ap_invoices')
        .select('invoice_number, reference, po_number, vendor_name, status')
        .eq('entity', entity)
        .ilike('vendor_name', '%DIB%')
        .not('status', 'in', '(paid,disappeared_from_export,reconciled,auto_matched)');
      if (apErr) throw apErr;

      const apBlobs = (ap || []).map(r =>
        `${r.invoice_number || ''}|${r.reference || ''}|${r.po_number || ''}`.toUpperCase());

      const inAp = (dibNo) => {
        const n = String(dibNo).trim().toUpperCase();
        return apBlobs.some(b => b.includes(n));
      };

      const curacao = [], bonaire = [], missing = [];
      for (const row of csvRows) {
        const member = String(row.MemberNumber || '').trim();
        const entity = MEMBER_ENTITY[member] || `Onbekend (${member})`;
        const rec = {
          invoice: String(row.InvoiceNumber).trim(),
          po: (row.PurchaseOrder || '').trim(),
          vendor: (row.VendorName || '').trim(),
          amount: row.AmountDueUSD,
          member, entity,
        };
        if (member === '7269') { bonaire.push(rec); continue; }
        curacao.push(rec);
        if (!inAp(rec.invoice)) missing.push(rec);
      }
      setResult({ total: csvRows.length, apCount: (ap || []).length, curacao, bonaire, missing });
      setPhase('');
    } catch (e) {
      setError('Vergelijken mislukt: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }, [csvRows, supabase]);

  // ---- PDF('s) splitsen voor de ontbrekende facturen ----
  const runSplit = useCallback(async () => {
    if (!pdfFiles.length || !result?.missing?.length) return;
    setBusy(true); setError(null);
    try {
      // Bouw over ALLE PDF-delen heen: factuurnummer → { docIndex, pages }
      const srcDocs = [];
      const groups = {};
      for (let fi = 0; fi < pdfFiles.length; fi++) {
        setPhase(`PDF ${fi + 1}/${pdfFiles.length} inlezen...`);
        const buf = await pdfFiles[fi].arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        const pageInv = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          const text = tc.items.map(it => it.str).join(' ');
          const m = text.match(/Invoice\s*#:\s*(\d{6,})/i);
          pageInv.push(m ? m[1] : null);
        }
        // vervolgpagina's erven het vorige factuurnummer
        for (let i = 1; i < pageInv.length; i++) if (!pageInv[i]) pageInv[i] = pageInv[i - 1];

        const srcDoc = await PDFDocument.load(buf.slice(0));
        const idx = srcDocs.push(srcDoc) - 1;
        pageInv.forEach((inv, pi) => {
          if (!inv) return;
          if (!groups[inv]) groups[inv] = { docIndex: idx, pages: [] };
          if (groups[inv].docIndex === idx) groups[inv].pages.push(pi);
        });
      }

      setPhase('Ontbrekende facturen splitsen...');
      const out = {};
      const notFound = [];
      for (const rec of result.missing) {
        const g = groups[rec.invoice];
        if (!g || !g.pages.length) { notFound.push(rec.invoice); continue; }
        const doc = await PDFDocument.create();
        const copied = await doc.copyPages(srcDocs[g.docIndex], g.pages);
        copied.forEach(p => doc.addPage(p));
        const bytes = await doc.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        out[rec.invoice] = { blob, url: URL.createObjectURL(blob) };
      }
      setSplits({ files: out, notFound });
      setPhase('');
    } catch (e) {
      setError('PDF splitsen mislukt: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }, [pdfFiles, result]);

  // ---- Alle gesplitste PDF's als zip ----
  const downloadZip = useCallback(async () => {
    if (!splits?.files) return;
    const zip = new JSZip();
    for (const [inv, { blob }] of Object.entries(splits.files)) zip.file(`${inv}.pdf`, blob);
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url; a.download = 'dib_ontbrekend.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, [splits]);

  if (!canUse) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-[16px] font-bold text-amber-900 mb-2">Geen toegang</h2>
          <p className="text-[13px] text-amber-800">DIB-controle is voor admins, CFO en AP Clerks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-2 text-[12px] text-[#1B3A5C]/50">
        <Link href="/dashboard/finance/sandbox-ap" className="hover:underline">Accounts Payable</Link>
        {' › '}DIB Controle
      </div>
      <h1 className="text-[26px] font-bold text-[#1B3A5C] mb-1">DIB Controle</h1>
      <p className="text-[13px] text-[#1B3A5C]/60 mb-6">
        Vergelijk de Do it Best open items met de AP-portal en splits de PDF per niet-geboekte factuur.
        Meerdere CSV- en PDF-delen mogen (de portal exporteert max. 50 per PDF). Bestanden blijven lokaal.
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Stap 1: uploads (meerdere toegestaan) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <label className="flex flex-col gap-2 p-4 bg-[#f8fafc] rounded-xl border border-gray-200 cursor-pointer hover:border-[#1B3A5C]/30">
          <span className="text-[13px] font-semibold text-[#1B3A5C]">1a · DIB Invoice Summary (CSV) — meerdere mag</span>
          <span className="text-[11px] text-[#1B3A5C]/50">
            {csvNames.length
              ? `✓ ${csvNames.length} bestand(en), ${csvRows?.length || 0} unieke regels`
              : 'Export uit DIB → Export as CSV → Invoice Summary'}
          </span>
          <input type="file" accept=".csv" multiple className="hidden" onChange={(e) => onCsv(e.target.files)} />
        </label>

        <label className="flex flex-col gap-2 p-4 bg-[#f8fafc] rounded-xl border border-gray-200 cursor-pointer hover:border-[#1B3A5C]/30">
          <span className="text-[13px] font-semibold text-[#1B3A5C]">1b · DIB facturen (PDF) — meerdere mag</span>
          <span className="text-[11px] text-[#1B3A5C]/50">
            {pdfFiles.length
              ? `✓ ${pdfFiles.length} PDF-bestand(en) geselecteerd`
              : 'Selecteer open items in DIB → knop PDF (max. 50 per keer) → hier alle delen samen'}
          </span>
          <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => onPdf(e.target.files)} />
        </label>
      </div>

      {/* Stap 2: vergelijken */}
      <button
        onClick={runCompare}
        disabled={!csvRows || busy}
        className="px-4 py-2 rounded-lg bg-[#1B3A5C] text-white text-[13px] font-semibold hover:bg-[#152e4a] disabled:opacity-40 mb-6">
        {busy && phase.includes('AP') ? phase : '2 · Vergelijk met AP open items'}
      </button>

      {result && (
        <div className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="DIB open items" value={result.total} />
            <Stat label="AP open (DIB)" value={result.apCount} />
            <Stat label="Curaçao (7107)" value={result.curacao.length} />
            <Stat label="Ontbreekt in AP" value={result.missing.length} highlight />
          </div>

          {result.bonaire.length > 0 && (
            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-[12px] text-blue-800">
              {result.bonaire.length} regel(s) staan onder MemberNumber 7269 (Bonaire) — buiten de huidige
              AP-scope (BDT Curaçao). Deze worden niet als "ontbrekend" gemarkeerd. Voeg de Bonaire-entiteit
              toe om deze mee te nemen.
            </div>
          )}

          {result.missing.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-[13px] text-emerald-800">
              ✓ Alle DIB open items (Curaçao) staan al in de AP-portal. Niets te boeken.
            </div>
          ) : (
            <>
              <h2 className="text-[15px] font-bold text-[#1B3A5C] mb-2">
                {result.missing.length} factuur(en) niet in AP — te boeken
              </h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
                <table className="w-full text-[12px]">
                  <thead className="bg-gray-50 text-[#1B3A5C]/70">
                    <tr>
                      <th className="p-2 text-left font-semibold">Invoice #</th>
                      <th className="p-2 text-left font-semibold">PO (ons kenmerk)</th>
                      <th className="p-2 text-left font-semibold">Vendor (reference)</th>
                      <th className="p-2 text-left font-semibold">Entiteit</th>
                      <th className="p-2 text-right font-semibold">Amount Due USD</th>
                      <th className="p-2 text-center font-semibold">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.missing.map(rec => (
                      <tr key={rec.invoice} className="border-t border-gray-100">
                        <td className="p-2 font-mono">{rec.invoice}</td>
                        <td className="p-2">{rec.po || <span className="text-[#1B3A5C]/30">—</span>}</td>
                        <td className="p-2">{rec.vendor}</td>
                        <td className="p-2">{rec.entity}</td>
                        <td className="p-2 text-right font-mono">{fmtUsd(rec.amount)}</td>
                        <td className="p-2 text-center">
                          {splits?.files?.[rec.invoice]
                            ? <a href={splits.files[rec.invoice].url} download={`${rec.invoice}.pdf`}
                                className="text-[#1B3A5C] font-semibold hover:underline">↓ PDF</a>
                            : <span className="text-[#1B3A5C]/25">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Stap 3: PDF splitsen */}
              {!splits ? (
                <button
                  onClick={runSplit}
                  disabled={!pdfFiles.length || busy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-40">
                  {busy ? (phase || 'Bezig...') : (pdfFiles.length ? '3 · Splits PDF per ontbrekende factuur' : 'Upload eerst de DIB-PDF(s) (1b)')}
                </button>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={downloadZip}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700">
                    ↓ Download alle {Object.keys(splits.files).length} als zip
                  </button>
                  <span className="text-[12px] text-[#1B3A5C]/60">
                    {Object.keys(splits.files).length} PDF(s) klaar — of download los via de tabel.
                  </span>
                  {splits.notFound.length > 0 && (
                    <span className="text-[12px] text-amber-700">
                      ⚠️ {splits.notFound.length} factuur(en) niet in de PDF's gevonden: {splits.notFound.join(', ')}.
                      Zaten die wel in je PDF-selectie (denk aan de 50-limiet per export)?
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 p-4 text-[12px] text-[#1B3A5C]/70">
        <strong>Werkwijze:</strong> exporteer in de DIB-portal (Invoice Manager → Invoices) de Invoice
        Summary CSV en de PDF van alle open items. Omdat de PDF max. 50 facturen per keer geeft, download
        je die in delen en selecteer je hier alle delen samen. Upload, vergelijk, splits. De ontbrekende
        facturen download je (los of als zip) en mailt de clerk na beoordeling door naar de ingest-mailbox.
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
      <div className={`text-[11px] ${highlight ? 'text-amber-800/70' : 'text-[#1B3A5C]/50'}`}>{label}</div>
      <div className={`text-[22px] font-bold ${highlight ? 'text-amber-900' : 'text-[#1B3A5C]'}`}>{value}</div>
    </div>
  );
}