/* ============================================================
   BESTAND: page_salary_import.js
   KOPIEER NAAR: src/app/dashboard/admin/salary-import/page.js
   VERSIE: v1

   DOEL: Upload C4 Loonjournaalpost + C16 Werknemerslijst CSV's
   uit Celery. Toont uitleg-tekst met de exacte Celery-filters
   die gebruikt moeten worden.
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function SalaryImportPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploadingC4, setUploadingC4] = useState(false);
  const [uploadingC16, setUploadingC16] = useState(false);
  const [resultC4, setResultC4] = useState(null);
  const [resultC16, setResultC16] = useState(null);
  const [c16SnapshotDate, setC16SnapshotDate] = useState('');
  const [recentImports, setRecentImports] = useState({ c4: [], c16: [] });

  useEffect(() => {
    // Default snapshot date = laatste dag vorige maand
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    setC16SnapshotDate(lastDay.toISOString().substring(0, 10));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (!p || p.role !== 'admin') { router.push('/dashboard'); return; }
      setIsAdmin(true);
      setLoading(false);
      loadRecentImports();
    })();
  }, []);

  async function loadRecentImports() {
    const { data: c4 } = await supabase
      .from('payroll_journal')
      .select('period_year, period_month, source_file, imported_at')
      .order('imported_at', { ascending: false })
      .limit(50);
    const c4Grouped = {};
    (c4 || []).forEach(r => {
      const key = `${r.period_year}-${String(r.period_month).padStart(2,'0')}`;
      if (!c4Grouped[key]) c4Grouped[key] = { period: key, source: r.source_file, imported: r.imported_at, count: 0 };
      c4Grouped[key].count++;
    });
    const { data: c16 } = await supabase
      .from('employee_snapshots')
      .select('snapshot_date, source_file, imported_at')
      .order('imported_at', { ascending: false })
      .limit(50);
    const c16Grouped = {};
    (c16 || []).forEach(r => {
      const key = r.snapshot_date;
      if (!c16Grouped[key]) c16Grouped[key] = { snapshot_date: key, source: r.source_file, imported: r.imported_at, count: 0 };
      c16Grouped[key].count++;
    });
    setRecentImports({
      c4: Object.values(c4Grouped).sort((a,b) => b.period.localeCompare(a.period)),
      c16: Object.values(c16Grouped).sort((a,b) => b.snapshot_date.localeCompare(a.snapshot_date)),
    });
  }

  async function handleUpload(file, type) {
    const formData = new FormData();
    formData.append('file', file);
    if (type === 'c16' && c16SnapshotDate) {
      formData.append('snapshot_date', c16SnapshotDate);
    }
    const setUploading = type === 'c4' ? setUploadingC4 : setUploadingC16;
    const setResult = type === 'c4' ? setResultC4 : setResultC16;
    setUploading(true);
    setResult(null);
    try {
      const res = await fetch('/api/import/celery', { method: 'POST', body: formData });
      const data = await res.json();
      setResult({ ok: res.ok, ...data });
      if (res.ok) loadRecentImports();
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <div style={{padding:40, textAlign:'center', color:'#9c978c'}}>Laden...</div>;
  }
  if (!isAdmin) return null;

  return (
    <div style={{maxWidth:1200, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <h1 style={{fontSize:22, fontWeight:700, margin:'0 0 8px'}}>Salaris-data import (Celery)</h1>
      <p style={{fontSize:13, color:'#9c978c', margin:'0 0 24px'}}>Upload C4 Loonjournaalpost (geld per maand) en C16 Werknemerslijst (medewerker-snapshots) uit Celery.</p>

      {/* C4 Block */}
      <div style={{background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <h2 style={{fontSize:15, fontWeight:600, margin:'0 0 8px'}}>📊 C4 — Loonjournaalpost</h2>
        <p style={{fontSize:12.5, color:'#6b6960', margin:'0 0 12px', lineHeight:1.55}}>
          Loonkosten per afdeling per maand. <strong>Eén bestand per maand.</strong>
        </p>
        <div style={{background:'#fff3cd', border:'1px solid #856404', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#856404', marginBottom:14, lineHeight:1.6}}>
          <strong>Celery export-filters (belangrijk!):</strong>
          <ul style={{margin:'4px 0 0 18px', padding:0}}>
            <li>Betaalschema's: <strong>Maandloners</strong></li>
            <li>Loonperiodes: de <strong>gewenste maand</strong></li>
            <li>Groepeer op: <strong>Afdeling</strong></li>
            <li>Afdelingen: <strong>alle (23) geselecteerd</strong></li>
            <li>Totaliseer op: <strong>looncodes</strong></li>
          </ul>
        </div>
        <input
          type="file"
          accept=".csv"
          onChange={e => e.target.files[0] && handleUpload(e.target.files[0], 'c4')}
          disabled={uploadingC4}
          style={{fontSize:13, padding:'8px 0'}}
        />
        {uploadingC4 && <div style={{marginTop:10, fontSize:12, color:'#0056a3'}}>⏳ Verwerken...</div>}
        {resultC4 && <ResultBlock result={resultC4} type="C4" />}
      </div>

      {/* C16 Block */}
      <div style={{background:'#fff', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <h2 style={{fontSize:15, fontWeight:600, margin:'0 0 8px'}}>👥 C16 — Werknemerslijst</h2>
        <p style={{fontSize:12.5, color:'#6b6960', margin:'0 0 12px', lineHeight:1.55}}>
          Snapshot van alle medewerkers met contractdetails. <strong>Eén bestand per maand</strong> (snapshot peildatum).
        </p>
        <div style={{background:'#fff3cd', border:'1px solid #856404', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#856404', marginBottom:14, lineHeight:1.6}}>
          <strong>Celery export-filters:</strong>
          <ul style={{margin:'4px 0 0 18px', padding:0}}>
            <li>Export: <strong>Werknemerslijst</strong> (alle 72 kolommen)</li>
            <li>Format: <strong>CSV</strong></li>
            <li>Alle medewerkers (actief + inactief) inclusief uit-dienst-datum</li>
          </ul>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11, color:'#9c978c', fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px', display:'block', marginBottom:4}}>
            Peildatum (snapshot date)
          </label>
          <input
            type="date"
            value={c16SnapshotDate}
            onChange={e => setC16SnapshotDate(e.target.value)}
            style={{padding:'6px 10px', border:'1px solid rgba(0,0,0,0.14)', borderRadius:6, fontSize:13, fontFamily:'inherit'}}
          />
          <span style={{fontSize:11, color:'#9c978c', marginLeft:8}}>(default: einde vorige maand)</span>
        </div>
        <input
          type="file"
          accept=".csv"
          onChange={e => e.target.files[0] && handleUpload(e.target.files[0], 'c16')}
          disabled={uploadingC16}
          style={{fontSize:13, padding:'8px 0'}}
        />
        {uploadingC16 && <div style={{marginTop:10, fontSize:12, color:'#0056a3'}}>⏳ Verwerken...</div>}
        {resultC16 && <ResultBlock result={resultC16} type="C16" />}
      </div>

      {/* Recente imports */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:14}}>
        <div style={{background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <h3 style={{fontSize:13, fontWeight:600, margin:'0 0 10px'}}>C4 imports</h3>
          {recentImports.c4.length === 0 ? (
            <p style={{fontSize:12, color:'#9c978c'}}>Nog geen C4 imports.</p>
          ) : (
            <table style={{width:'100%', fontSize:11.5, borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{textAlign:'left', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Periode</th>
                <th style={{textAlign:'right', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Rijen</th>
                <th style={{textAlign:'right', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Geüpload</th>
              </tr></thead>
              <tbody>
                {recentImports.c4.slice(0, 14).map((r, i) => (
                  <tr key={i}>
                    <td style={{padding:'3px 0', fontFamily:"'JetBrains Mono',monospace"}}>{r.period}</td>
                    <td style={{padding:'3px 0', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#6b6960'}}>{r.count}</td>
                    <td style={{padding:'3px 0', textAlign:'right', color:'#9c978c'}}>{new Date(r.imported).toLocaleDateString('nl-NL')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{background:'#fff', borderRadius:14, padding:20, boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
          <h3 style={{fontSize:13, fontWeight:600, margin:'0 0 10px'}}>C16 imports</h3>
          {recentImports.c16.length === 0 ? (
            <p style={{fontSize:12, color:'#9c978c'}}>Nog geen C16 imports.</p>
          ) : (
            <table style={{width:'100%', fontSize:11.5, borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{textAlign:'left', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Peildatum</th>
                <th style={{textAlign:'right', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Medewerkers</th>
                <th style={{textAlign:'right', padding:'4px 0', fontSize:10, color:'#9c978c'}}>Geüpload</th>
              </tr></thead>
              <tbody>
                {recentImports.c16.slice(0, 14).map((r, i) => (
                  <tr key={i}>
                    <td style={{padding:'3px 0', fontFamily:"'JetBrains Mono',monospace"}}>{r.snapshot_date}</td>
                    <td style={{padding:'3px 0', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#6b6960'}}>{r.count}</td>
                    <td style={{padding:'3px 0', textAlign:'right', color:'#9c978c'}}>{new Date(r.imported).toLocaleDateString('nl-NL')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultBlock({result, type}) {
  if (!result) return null;
  const ok = result.ok;
  const bg = ok ? '#d1e7dd' : '#f8d7da';
  const color = ok ? '#0f5132' : '#842029';
  return (
    <div style={{marginTop:12, padding:'10px 14px', background:bg, border:`1px solid ${color}`, borderRadius:8, fontSize:12.5, color, lineHeight:1.6}}>
      {ok ? (
        <>
          <strong>✓ {type} succesvol geïmporteerd</strong><br/>
          {result.type === 'c4' && <>Periode: <strong>{result.period}</strong> · </>}
          {result.type === 'c16' && <>Peildatum: <strong>{result.snapshot_date}</strong> · </>}
          Records: <strong>{result.inserted}</strong> ingelezen, {result.skipped} overgeslagen
        </>
      ) : (
        <>
          <strong>✗ Fout</strong><br/>
          {result.error}
          {result.details && <div style={{marginTop:4, fontSize:11}}>{result.details}</div>}
        </>
      )}
    </div>
  );
}
