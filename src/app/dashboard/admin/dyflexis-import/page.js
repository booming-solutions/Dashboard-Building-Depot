/* ============================================================
   BESTAND: page-dyflexis-import.js
   KOPIEER NAAR: src/app/dashboard/admin/dyflexis-import/page.js
   (nieuwe folder aanmaken: src/app/dashboard/admin/dyflexis-import/)

   DOEL: Admin-pagina om handmatig een Dyflexis PDF te uploaden
   en in Supabase te importeren via /api/import/dyflexis
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function DyflexisImportPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: p } = await supabase.from('profiles').select('role, email').eq('id', user.id).single();
      if (!p || p.role !== 'admin') {
        router.push('/dashboard');
        return;
      }
      setProfile(p);
      setLoading(false);
    })();
  }, []);

  async function handleImport() {
    if (!file) {
      setError('Selecteer eerst een PDF-bestand');
      return;
    }
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      // Lees PDF als base64
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // POST naar API
      const response = await fetch('/api/import/dyflexis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          data: base64,
          sender: profile.email,
          secret: 'bs-compass-2026-secret',
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        setError(json.error || json.message || 'Import gefaald');
      } else {
        setResult(json);
      }
    } catch (err) {
      setError('Fout: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div style={{minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, fontFamily:"'DM Sans',sans-serif"}}>
        <img src="/logo.png" alt="Booming Solutions" style={{width:64, height:64, borderRadius:14, animation:'pulse 1.5s ease-in-out infinite'}} />
        <div style={{fontSize:13, color:'#6b6960', fontWeight:500}}>Laden...</div>
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.95)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{maxWidth:900, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <h1 style={{fontSize:22, fontWeight:700, margin:'0 0 6px'}}>Dyflexis PDF Import</h1>
      <p style={{fontSize:13, color:'#9c978c', margin:'0 0 24px'}}>Upload de Roosters-PDF uit Dyflexis. De data wordt geparsed en in de urenplanning-tabel opgeslagen.</p>

      <div style={{background:'#fff', padding:24, borderRadius:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)'}}>
        <div style={{marginBottom:18}}>
          <label style={{display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c', marginBottom:8}}>Selecteer PDF</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(null); }}
            style={{display:'block', padding:'10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:8, fontFamily:'inherit', fontSize:13, width:'100%', maxWidth:500}}
          />
          {file && (
            <div style={{marginTop:8, fontSize:12, color:'#6b6960'}}>
              Geselecteerd: <strong>{file.name}</strong> ({(file.size/1024).toFixed(0)} KB)
            </div>
          )}
        </div>

        <button
          onClick={handleImport}
          disabled={!file || importing}
          style={{
            padding:'12px 26px', background: importing ? '#9c978c' : '#D63B1A', color:'#fff',
            border:'none', borderRadius:8, fontFamily:'inherit', fontSize:13, fontWeight:600,
            cursor: importing || !file ? 'not-allowed' : 'pointer',
            opacity: (!file || importing) ? 0.6 : 1,
            boxShadow:'0 2px 6px rgba(214,59,26,.25)'
          }}
        >
          {importing ? 'Importeren...' : 'Importeer PDF'}
        </button>

        {error && (
          <div style={{marginTop:20, padding:'14px 16px', background:'#fee', border:'1.5px solid #a33225', borderRadius:8, color:'#a33225', fontSize:13}}>
            <strong>Fout:</strong> {error}
          </div>
        )}

        {result && result.ok && (
          <div style={{marginTop:20, padding:'16px 18px', background:'#f0f5e8', border:'1.5px solid #2d6b3f', borderRadius:8, fontSize:13}}>
            <div style={{fontSize:15, fontWeight:600, color:'#2d6b3f', marginBottom:10}}>✓ Import succesvol</div>
            <div style={{display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 16px', fontSize:12.5}}>
              <div style={{color:'#6b6960'}}>Bestand:</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{result.filename}</div>
              <div style={{color:'#6b6960'}}>Records geparsed:</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{result.records_total}</div>
              <div style={{color:'#6b6960'}}>Geïmporteerd:</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{result.records_inserted}</div>
              <div style={{color:'#6b6960'}}>Genegeerd (Bonaire/Multimart):</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{result.records_ignored}</div>
              <div style={{color:'#6b6960'}}>Oude rijen vervangen:</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace"}}>{result.old_rows_deleted}</div>
            </div>
            {result.summary_per_bu && (
              <div style={{marginTop:16}}>
                <div style={{fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px', color:'#6b6960', marginBottom:8}}>Per BU geïmporteerd</div>
                <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
                  <thead>
                    <tr>
                      <th style={{textAlign:'left', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>BU</th>
                      <th style={{textAlign:'right', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Totaal uren</th>
                      <th style={{textAlign:'right', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Open dienst</th>
                      <th style={{textAlign:'left', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Weken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.summary_per_bu).map(([bu, data]) => (
                      <tr key={bu}>
                        <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)'}}>{bu}</td>
                        <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace"}}>{data.total.toFixed(1)}h</td>
                        <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color: data.open > 0 ? '#a33225' : '#9c978c'}}>{data.open > 0 ? data.open.toFixed(1) + 'h' : '-'}</td>
                        <td style={{padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', fontFamily:"'JetBrains Mono',monospace", fontSize:11}}>{data.weeks.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{marginTop:14, fontSize:12, color:'#6b6960'}}>
              Bekijk de data op <a href="/dashboard/hr/urenplanning" style={{color:'#D63B1A', fontWeight:600, textDecoration:'none'}}>Urenplanning</a>.
            </div>
          </div>
        )}
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Hoe te gebruiken:</strong> Download de "Roosters" PDF uit Dyflexis (per week of multi-week export). Upload hier het bestand en klik "Importeer PDF". Bestaande rijen voor dezelfde BU+week worden vervangen. Records voor Bonaire en Multimart worden genegeerd. Later wordt dit geautomatiseerd via email naar data@boomingsolutions.ai.
      </div>
    </div>
  );
}
