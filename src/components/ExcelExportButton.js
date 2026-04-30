/* ============================================================
   BESTAND: ExcelExportButton.js
   KOPIEER NAAR: src/components/ExcelExportButton.js
   VERSIE: v3.28.13

   Herbruikbare knop voor Excel-export. Gebruikt door alle pagina's.

   Gebruik:
     import ExcelExportButton from '@/components/ExcelExportButton';

     <ExcelExportButton
       filename="20260430_voorraad_PASCAL_Curacao"
       reportTitle="Voorraad vs Budget — PASCAL — Curaçao"
       sheets={[
         { name: 'Per Afdeling', rows: deptRows },
         { name: 'Per Item', rows: itemRows },
       ]}
     />

   Sheets-prop kan ook een functie zijn die ze on-demand bouwt:
     <ExcelExportButton sheets={() => buildSheets()} ... />
   ============================================================ */
'use client';

import { useState } from 'react';
import { exportToExcel } from '@/lib/excelExport';

export default function ExcelExportButton({ filename, reportTitle, sheets, label, className }) {
  var _b = useState(false), busy = _b[0], setBusy = _b[1];

  async function handleClick() {
    setBusy(true);
    try {
      var resolvedSheets = typeof sheets === 'function' ? sheets() : sheets;
      await exportToExcel({
        filename: filename,
        reportTitle: reportTitle,
        sheets: resolvedSheets,
      });
    } catch (err) {
      console.error('Excel export error:', err);
      alert('Excel-export mislukt: ' + (err.message || err));
    }
    setBusy(false);
  }

  var btnLabel = busy ? 'Bezig...' : (label || '⬇ Excel export');
  var cls = className || ('px-4 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ' +
    (busy ? 'bg-[#e5ddd4] text-[#a08a74] border-[#e5ddd4] cursor-wait'
          : 'bg-white text-[#E84E1B] border-[#E84E1B] hover:bg-[#faf5f0]'));

  return (
    <button onClick={handleClick} disabled={busy} className={cls}>
      {btnLabel}
    </button>
  );
}
