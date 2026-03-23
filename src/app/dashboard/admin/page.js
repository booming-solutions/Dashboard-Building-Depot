'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [logs, setLogs] = useState([]);
  const supabase = createClient();

  useEffect(() => { loadUser(); loadLogs(); }, []);

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUser(user);
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(data);
    }
  }

  async function loadLogs() {
    const { data } = await supabase.from('upload_log').select('*').order('uploaded_at', { ascending: false }).limit(10);
    setLogs(data || []);
  }

  async function parseExcel(file) {
    const XLSX = (await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm')).default || await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet);

    return json.map(row => {
      const keys = Object.keys(row);
      const find = (patterns) => keys.find(k => patterns.some(p => k.toLowerCase().includes(p))) || patterns[0];

      let dateVal = row[find(['date'])];
      if (dateVal instanceof Date) dateVal = dateVal.toISOString().split('T')[0];
      else if (typeof dateVal === 'number') {
        dateVal = new Date((dateVal - 25569) * 86400000).toISOString().split('T')[0];
      }

      return {
        bum: String(row[find(['bum'])] || ''),
        sale_date: dateVal,
        store_number: String(row[find(['store'])] || ''),
        dept_code: String(row[find(['department code', 'dept_code'])] || ''),
        dept_name: String(row[find(['department name', 'dept_name'])] || ''),
        net_sales: parseFloat(row[find(['net sales', 'net_sales'])]) || 0,
        gross_margin: parseFloat(row[keys.find(k => k.toLowerCase().includes('gross margin') && !k.toLowerCase().includes('%')) || 'Gross Margin']) || 0,
        gm_percentage: parseFloat(row[keys.find(k => (k.toLowerCase().includes('gross margin') && k.toLowerCase().includes('%')) || k.toLowerCase() === 'gm%') || 'Gross Margin %']) || 0,
      };
    }).filter(r => r.bum && r.sale_date && r.dept_code);
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus({ type: 'info', msg: 'Bestand wordt gelezen...' });
    try {
      const rows = await parseExcel(file);
      const stores = [...new Set(rows.map(r => r.store_number === '1' ? 'Curaçao' : r.store_number === 'B' ? 'Bonaire' : r.store_number))];
      setPreview({
        filename: file.name, totalRows: rows.length, rows,
        dateRange: rows.length ? `${rows[0].sale_date} t/m ${rows[rows.length - 1].sale_date}` : '',
        stores, bums: [...new Set(rows.map(r => r.bum))], sampleRows: rows.slice(0, 5),
      });
      setStatus({ type: 'success', msg: `${rows.length} rijen gevonden. Controleer de preview en klik "Importeren".` });
    } catch (err) {
      setStatus({ type: 'error', msg: 'Kon bestand niet lezen: ' + err.message });
    }
  }

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }, []);

  async function doImport() {
    if (!preview?.rows) return;
    setUploading(true);
    setStatus({ type: 'info', msg: 'Data wordt geïmporteerd...' });
    try {
      const res = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: preview.rows, filename: preview.filename, userId: user.id }),
      });
      const result = await res.json();
      if (result.success) {
        setStatus({ type: 'success', msg: `${result.rows_imported} rijen succesvol geïmporteerd!` });
        setPreview(null); loadLogs();
      } else { setStatus({ type: 'error', msg: result.error }); }
    } catch (err) { setStatus({ type: 'error', msg: 'Upload mislukt: ' + err.message }); }
    setUploading(false);
  }

  if (profile && profile.role !== 'admin') {
    return (<div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center"><p className="text-red-600 font-medium">Geen toegang.</p></div>);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-navy mb-2">Data Upload</h1>
      <p className="text-sm text-gray-400 mb-8">Upload Excel-exports uit Compass om de dashboards bij te werken</p>

      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${dragOver ? 'border-gold bg-gold/5' : 'border-gray-200 hover:border-gold/50'}`}
        onClick={() => document.getElementById('fileInput').click()}>
        <div className="text-4xl mb-4">📊</div>
        <p className="text-navy font-semibold mb-1">Sleep een Excel-bestand hierheen</p>
        <p className="text-sm text-gray-400">of klik om te selecteren (.xlsx, .xls, .csv)</p>
        <input id="fileInput" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      </div>

      {status && (
        <div className={`mt-4 rounded-xl p-4 text-sm font-medium ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : status.type === 'error' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-blue-50 text-blue-600 border border-blue-200'}`}>
          {status.msg}
        </div>
      )}

      {preview && (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-navy mb-3">Preview: {preview.filename}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Rijen</p><p className="text-xl font-bold text-navy">{preview.totalRows.toLocaleString()}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Periode</p><p className="text-sm font-semibold text-navy mt-1">{preview.dateRange}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Winkels</p><p className="text-sm font-semibold text-navy mt-1">{preview.stores.join(', ')}</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Managers</p><p className="text-sm font-semibold text-navy mt-1">{preview.bums.join(', ')}</p></div>
            </div>
          </div>
          <div className="p-5 border-b border-gray-100 overflow-x-auto">
            <p className="text-xs text-gray-400 font-medium mb-2">Eerste 5 rijen:</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left py-2 px-2 text-gray-400 font-semibold">BUM</th>
                <th className="text-left py-2 px-2 text-gray-400 font-semibold">Datum</th>
                <th className="text-left py-2 px-2 text-gray-400 font-semibold">Store</th>
                <th className="text-left py-2 px-2 text-gray-400 font-semibold">Dept</th>
                <th className="text-right py-2 px-2 text-gray-400 font-semibold">Net Sales</th>
                <th className="text-right py-2 px-2 text-gray-400 font-semibold">GM</th>
                <th className="text-right py-2 px-2 text-gray-400 font-semibold">GM%</th>
              </tr></thead>
              <tbody>{preview.sampleRows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 px-2 text-navy">{r.bum}</td>
                  <td className="py-1.5 px-2 text-gray-500">{r.sale_date}</td>
                  <td className="py-1.5 px-2 text-gray-500">{r.store_number === '1' ? 'CUR' : 'BON'}</td>
                  <td className="py-1.5 px-2 text-gray-500 truncate max-w-[150px]">{r.dept_name}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-navy">${r.net_sales.toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-navy">${r.gross_margin.toLocaleString()}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-gray-500">{r.gm_percentage.toFixed(1)}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="p-5 flex gap-3">
            <button onClick={doImport} disabled={uploading} className="bg-gold text-navy-deep px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-gold-light transition-all disabled:opacity-50">
              {uploading ? 'Importeren...' : `${preview.totalRows.toLocaleString()} rijen importeren`}
            </button>
            <button onClick={() => { setPreview(null); setStatus(null); }} className="bg-gray-100 text-gray-600 px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all">Annuleren</button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-navy mb-3">Upload geschiedenis</h3>
          <div className="space-y-2">{logs.map((log) => (
            <div key={log.id} className="bg-white rounded-xl p-4 border border-gray-100 flex items-center justify-between">
              <div><p className="text-sm font-medium text-navy">{log.filename}</p><p className="text-xs text-gray-400">{new Date(log.uploaded_at).toLocaleString('nl-NL')}</p></div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">{log.rows_imported?.toLocaleString()} rijen</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${log.status === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{log.status === 'success' ? 'OK' : 'Fout'}</span>
              </div>
            </div>
          ))}</div>
        </div>
      )}
    </div>
  );
}
