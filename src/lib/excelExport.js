/* ============================================================
   BESTAND: excelExport.js
   KOPIEER NAAR: src/lib/excelExport.js
   (maak src/lib/ aan als die nog niet bestaat)
   VERSIE: v3.28.13

   Centrale helper voor Excel-export. Gebruikt door alle dashboards
   die naar XLSX exporteren. Eén plek voor opmaak en consistentie.

   Gebruik:
     import { exportToExcel } from '@/lib/excelExport';

     await exportToExcel({
       filename: '20260430_voorraadgezondheid_PASCAL_Curacao',
       reportTitle: 'Gezondheid Voorraden - PASCAL - Curaçao',
       sheets: [
         {
           name: 'Per Afdeling',
           rows: [ {Dept:'01', Naam:'STEEL', ...}, ... ],
         },
         {
           name: 'Per Item',
           rows: [ ... ],
         },
       ],
     });

   Opmaak per sheet:
   - Header rij donkerblauw (#1B3A5C), witte vette tekst
   - Kolombreedtes auto op basis van inhoud (max 50 chars)
   - Header rij bevroren (freeze pane row 1)
   - Footer: 1 blanco rij + export datum/tijd + link naar boomingsolutions.ai
   ============================================================ */

var SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

async function loadXlsxLib() {
  if (typeof window === 'undefined') throw new Error('Excel export werkt alleen in de browser');
  if (window.XLSX) return window.XLSX;
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.onload = function() { resolve(window.XLSX); };
    s.onerror = function() { reject(new Error('Kon XLSX library niet laden')); };
    document.head.appendChild(s);
  });
}

function formatTimestamp(d) {
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function calcColumnWidths(rows, headers) {
  // Kolombreedte = max(header lengte, max inhoud lengte) met cap op 50
  var widths = headers.map(function(h) { return String(h || '').length; });
  rows.forEach(function(row) {
    headers.forEach(function(h, i) {
      var v = row[h];
      var len = v == null ? 0 : String(v).length;
      if (len > widths[i]) widths[i] = len;
    });
  });
  return widths.map(function(w) { return { wch: Math.min(Math.max(w + 2, 8), 50) }; });
}

function applyHeaderStyle(ws, headerRow, numCols) {
  // Header opmaak: donkerblauw bg, witte vette tekst, gecentreerd
  // (NB: SheetJS community versie ondersteunt cellStyles alleen als de file
  // wordt geschreven met bookSST / cellStyles. We schrijven ze toch want
  // de meeste Excel-viewers respecteren deze attributen.)
  var XLSX = window.XLSX;
  for (var c = 0; c < numCols; c++) {
    var cellRef = XLSX.utils.encode_cell({ r: headerRow, c: c });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = {
      fill: { fgColor: { rgb: '1B3A5C' }, patternType: 'solid' },
      font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
      alignment: { horizontal: 'left', vertical: 'center' },
      border: {
        bottom: { style: 'thin', color: { rgb: 'FFFFFF' } },
      },
    };
  }
}

function applyFooterStyle(ws, footerStartRow, numCols) {
  var XLSX = window.XLSX;
  for (var r = footerStartRow; r < footerStartRow + 3; r++) {
    for (var c = 0; c < numCols; c++) {
      var cellRef = XLSX.utils.encode_cell({ r: r, c: c });
      if (!ws[cellRef]) continue;
      ws[cellRef].s = {
        font: { color: { rgb: '6b5240' }, italic: true, sz: 9 },
      };
    }
  }
  // Link cel
  var linkRef = XLSX.utils.encode_cell({ r: footerStartRow + 1, c: 0 });
  if (ws[linkRef]) {
    ws[linkRef].l = { Target: 'https://www.boomingsolutions.ai', Tooltip: 'Open dashboard' };
    ws[linkRef].s = {
      font: { color: { rgb: 'E84E1B' }, underline: true, sz: 9 },
    };
  }
}

export async function exportToExcel(opts) {
  var XLSX = await loadXlsxLib();

  var sheets = opts.sheets || [];
  if (sheets.length === 0) throw new Error('Geen sheets opgegeven');

  var wb = XLSX.utils.book_new();
  var now = new Date();
  var stamp = formatTimestamp(now);
  var reportTitle = opts.reportTitle || 'Booming Solutions Export';

  sheets.forEach(function(sheet) {
    var rows = sheet.rows || [];
    var headers = sheet.headers;
    if (!headers || !headers.length) {
      headers = rows.length ? Object.keys(rows[0]) : [];
    }
    if (!headers.length) {
      headers = ['(geen data)'];
    }

    // Build AOA: header + data + footer
    var aoa = [];
    aoa.push(headers); // row 0 = header
    rows.forEach(function(row) {
      aoa.push(headers.map(function(h) {
        var v = row[h];
        return v == null ? '' : v;
      }));
    });
    // Footer: 1 lege rij, dan export-info + link
    var footerStart = aoa.length + 1;
    aoa.push([]);
    aoa.push(['www.boomingsolutions.ai']);
    aoa.push(['Geëxporteerd: ' + stamp + '  ·  ' + reportTitle]);

    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // Kolombreedtes
    ws['!cols'] = calcColumnWidths(rows, headers);

    // Freeze header row (row 1 = index 1, dus ySplit = 1)
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activePane: 'bottomLeft' }];

    // Apply styles
    applyHeaderStyle(ws, 0, headers.length);
    applyFooterStyle(ws, footerStart, headers.length);

    // Voeg toe aan workbook (sheet name max 31 chars en zonder \ / ? * [ ])
    var sheetName = String(sheet.name || 'Sheet').replace(/[\\\/\?\*\[\]]/g, '_').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // Filename
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var datePrefix = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  var baseName = opts.filename || (datePrefix + '_export');
  if (!/\.xlsx$/i.test(baseName)) baseName += '.xlsx';

  // Schrijf met cellStyles enabled
  XLSX.writeFile(wb, baseName, { cellStyles: true });
}

export default exportToExcel;
