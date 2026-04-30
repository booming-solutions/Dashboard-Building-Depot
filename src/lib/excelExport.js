/* ============================================================
   BESTAND: excelExport.js
   KOPIEER NAAR: src/lib/excelExport.js
   VERSIE: v3.28.14

   Wijzigingen t.o.v. v3.28.13:
   - Overgestapt van SheetJS (xlsx) naar exceljs voor BETROUWBARE styling
     (SheetJS community ignoreerde header-kleur en tekstkleur)
   - Donkerblauwe header (#1B3A5C) met witte vette tekst werkt nu wel
   - Footer behoudt datum + klikbare link naar boomingsolutions.ai

   Gebruik:
     import { exportToExcel } from '@/lib/excelExport';
     await exportToExcel({
       filename: '...',
       reportTitle: '...',
       sheets: [{ name: 'X', rows: [{...}] }],
     });
   ============================================================ */

var EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
var FILESAVER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';

async function loadScript(src, globalName) {
  if (typeof window === 'undefined') throw new Error('Excel export werkt alleen in de browser');
  if (window[globalName]) return window[globalName];
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function() { resolve(window[globalName]); };
    s.onerror = function() { reject(new Error('Kon script ' + src + ' niet laden')); };
    document.head.appendChild(s);
  });
}

async function loadLibs() {
  var ExcelJS = await loadScript(EXCELJS_URL, 'ExcelJS');
  var saveAs = await loadScript(FILESAVER_URL, 'saveAs');
  return { ExcelJS: ExcelJS, saveAs: saveAs };
}

function formatTimestamp(d) {
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function calcColumnWidth(header, rows) {
  var w = String(header || '').length;
  rows.forEach(function(row) {
    var v = row[header];
    var len = v == null ? 0 : String(v).length;
    if (len > w) w = len;
  });
  return Math.min(Math.max(w + 2, 10), 50);
}

export async function exportToExcel(opts) {
  var libs = await loadLibs();
  var ExcelJS = libs.ExcelJS;
  var saveAs = libs.saveAs;

  var sheets = opts.sheets || [];
  if (sheets.length === 0) throw new Error('Geen sheets opgegeven');

  var now = new Date();
  var stamp = formatTimestamp(now);
  var reportTitle = opts.reportTitle || 'Booming Solutions Export';

  var workbook = new ExcelJS.Workbook();
  workbook.creator = 'Booming Solutions';
  workbook.created = now;

  sheets.forEach(function(sheet) {
    var rows = sheet.rows || [];
    var headers = sheet.headers;
    if (!headers || !headers.length) {
      headers = rows.length ? Object.keys(rows[0]) : ['(geen data)'];
    }

    var sheetName = String(sheet.name || 'Sheet').replace(/[\\\/\?\*\[\]]/g, '_').slice(0, 31);
    var ws = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }], // freeze header rij
    });

    // Kolommen definiëren
    ws.columns = headers.map(function(h) {
      return {
        header: h,
        key: h,
        width: calcColumnWidth(h, rows),
      };
    });

    // Header opmaak: donkerblauw bg, witte vette tekst
    var headerRow = ws.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell(function(cell) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1B3A5C' },
      };
      cell.font = {
        color: { argb: 'FFFFFFFF' },
        bold: true,
        size: 11,
      };
      cell.alignment = {
        horizontal: 'left',
        vertical: 'middle',
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
      };
    });

    // Data rijen
    rows.forEach(function(row) {
      ws.addRow(row);
    });

    // Footer: lege rij, link, export info
    ws.addRow([]);
    var linkRow = ws.addRow(['www.boomingsolutions.ai']);
    var linkCell = linkRow.getCell(1);
    linkCell.value = {
      text: 'www.boomingsolutions.ai',
      hyperlink: 'https://www.boomingsolutions.ai',
    };
    linkCell.font = {
      color: { argb: 'FFE84E1B' },
      underline: true,
      italic: true,
      size: 9,
    };
    var infoRow = ws.addRow(['Geëxporteerd: ' + stamp + '  ·  ' + reportTitle]);
    infoRow.getCell(1).font = {
      color: { argb: 'FF6B5240' },
      italic: true,
      size: 9,
    };
  });

  // Filename
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var datePrefix = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  var baseName = opts.filename || (datePrefix + '_export');
  if (!/\.xlsx$/i.test(baseName)) baseName += '.xlsx';

  var buf = await workbook.xlsx.writeBuffer();
  var blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, baseName);
}

export default exportToExcel;
