/* ============================================================
   BESTAND: page-dyflexis-actuals.js
   KOPIEER NAAR: src/app/dashboard/admin/dyflexis-actuals/page.js
   (nieuwe folder aanmaken)

   DOEL: Admin batch-upload van Dyflexis Realized CSV's
   - Selecteer meerdere CSV's tegelijk
   - Voor elk: parse week-nummer uit bestandsnaam (week_X.csv → week=X, year=2026)
   - Upload sequential naar /api/import/dyflexis-actuals
   - Resultaten per file zichtbaar
   ============================================================ */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function DyflexisActualsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [files, setFiles] = useState([]);
  const [year, setYear] = useState(2026);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState([]);
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

  function parseWeekFromName(name) {
    // Probeer "week_X.csv" of "week X" of "weekX"
    const m = name.match(/week[\s_-]*(\d+)/i);
    return m ? parseInt(m[1]) : null;
  }

  function handleFileChange(e) {
    const fileList = Array.from(e.target.files || []);
    // Sort op weeknummer als detecteerbaar, anders alfabetisch
    fileList.sort((a, b) => {
      const wa = parseWeekFromName(a.name);
      const wb = parseWeekFromName(b.name);
      if (wa !== null && wb !== null) return wa - wb;
      return a.name.localeCompare(b.name);
    });
    setFiles(fileList.map(f => ({
      file: f,
      detectedWeek: parseWeekFromName(f.name),
      manualWeek: parseWeekFromName(f.name) || '',
    })));
    setResults([]);
    setError(null);
  }

  function updateWeek(idx, val) {
    setFiles(prev => prev.map((f, i) => i === idx ? {...f, manualWeek: val} : f));
  }

  async function handleImport() {
    if (files.length === 0) { setError('Selecteer eerst CSV-bestanden'); return; }
    // Valideer dat alle weeks ingevuld zijn
    for (let i = 0; i < files.length; i++) {
      if (!files[i].manualWeek) {
        setError(`Bestand "${files[i].file.name}" heeft geen weeknummer`);
        return;
      }
    }

    setImporting(true); setError(null); setResults([]);
    setProgress({ current: 0, total: files.length });

    const newResults = [];
    for (let i = 0; i < files.length; i++) {
      const { file, manualWeek } = files[i];
      setProgress({ current: i + 1, total: files.length });
      try {
        const text = await file.text();
        const response = await fetch('/api/import/dyflexis-actuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            csv: text,
            week: parseInt(manualWeek),
            year: parseInt(year),
            sender: profile.email,
            secret: 'bs-compass-2026-secret',
          }),
        });
        const json = await response.json();
        if (response.ok) {
          newResults.push({ name: file.name, week: manualWeek, ok: true, data: json });
        } else {
          newResults.push({ name: file.name, week: manualWeek, ok: false, error: json.error || json.message });
        }
      } catch (err) {
        newResults.push({ name: file.name, week: manualWeek, ok: false, error: err.message });
      }
      setResults([...newResults]);
    }
    setImporting(false);
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

  const totalSuccess = results.filter(r => r.ok).length;
  const totalFail = results.filter(r => !r.ok).length;

  return (
    <div style={{maxWidth:1100, margin:'0 auto', padding:'20px', fontFamily:"'DM Sans',sans-serif", color:'#1a1a18'}}>
      <h1 style={{fontSize:22, fontWeight:700, margin:'0 0 6px'}}>Dyflexis Actuals Import (CSV)</h1>
      <p style={{fontSize:13, color:'#9c978c', margin:'0 0 24px'}}>Upload meerdere "Realized hours" CSV's tegelijk. Weeknummers worden auto-gedetecteerd uit bestandsnaam (bv. <code>week_1.csv</code>). Bonaire en Multimart worden genegeerd.</p>

      <div style={{background:'#fff', padding:24, borderRadius:14, boxShadow:'0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)'}}>
        <div style={{display:'flex', gap:18, alignItems:'flex-end', marginBottom:18, flexWrap:'wrap'}}>
          <div>
            <label style={{display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c', marginBottom:8}}>Jaar</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value) || 2026)}
              style={{padding:'8px 12px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:8, fontFamily:'inherit', fontSize:13, width:100}} />
          </div>
          <div style={{flex:1, minWidth:300}}>
            <label style={{display:'block', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px', color:'#9c978c', marginBottom:8}}>Selecteer CSV-bestanden (meerdere mogelijk)</label>
            <input type="file" accept=".csv" multiple onChange={handleFileChange}
              style={{display:'block', padding:'10px', border:'1.5px solid rgba(0,0,0,0.14)', borderRadius:8, fontFamily:'inherit', fontSize:13, width:'100%'}} />
          </div>
        </div>

        {files.length > 0 && (
          <div style={{marginBottom:18}}>
            <div style={{fontSize:12, fontWeight:600, color:'#6b6960', marginBottom:8}}>{files.length} bestand{files.length !== 1 ? 'en' : ''} geselecteerd:</div>
            <table style={{width:'100%', fontSize:12, borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Bestand</th>
                  <th style={{textAlign:'right', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Grootte</th>
                  <th style={{textAlign:'center', padding:'6px 10px', borderBottom:'1px solid rgba(0,0,0,0.08)', fontSize:10, color:'#9c978c'}}>Week</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}>
                    <td style={{padding:'4px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', fontFamily:"'JetBrains Mono',monospace", fontSize:11}}>{f.file.name}</td>
                    <td style={{padding:'4px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#9c978c'}}>{(f.file.size/1024).toFixed(0)} KB</td>
                    <td style={{padding:'4px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'center'}}>
                      <input type="number" min="1" max="53" value={f.manualWeek} onChange={e => updateWeek(i, e.target.value)}
                        style={{width:55, padding:'3px 6px', border:'1px solid rgba(0,0,0,0.14)', borderRadius:4, fontSize:11, textAlign:'center'}} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button onClick={handleImport} disabled={files.length === 0 || importing}
          style={{
            padding:'12px 26px', background: importing ? '#9c978c' : '#D63B1A', color:'#fff',
            border:'none', borderRadius:8, fontFamily:'inherit', fontSize:13, fontWeight:600,
            cursor: importing || files.length === 0 ? 'not-allowed' : 'pointer',
            opacity: (files.length === 0 || importing) ? 0.6 : 1,
            boxShadow:'0 2px 6px rgba(214,59,26,.25)'
          }}>
          {importing ? `Importeren ${progress.current}/${progress.total}...` : `Importeer ${files.length} CSV's`}
        </button>

        {error && (
          <div style={{marginTop:20, padding:'14px 16px', background:'#fee', border:'1.5px solid #a33225', borderRadius:8, color:'#a33225', fontSize:13}}>
            <strong>Fout:</strong> {error}
          </div>
        )}

        {results.length > 0 && (
          <div style={{marginTop:24}}>
            <div style={{fontSize:13, fontWeight:600, marginBottom:10}}>
              Resultaten: <span style={{color:'#2d6b3f'}}>{totalSuccess} ok</span>{totalFail > 0 && <span style={{color:'#a33225', marginLeft:8}}>· {totalFail} fout</span>}
            </div>
            <table style={{width:'100%', fontSize:12, borderCollapse:'collapse', background:'#fafaf6', borderRadius:8}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left', padding:'8px 10px', borderBottom:'1.5px solid rgba(0,0,0,0.14)', fontSize:10, color:'#9c978c'}}>Bestand</th>
                  <th style={{textAlign:'center', padding:'8px 10px', borderBottom:'1.5px solid rgba(0,0,0,0.14)', fontSize:10, color:'#9c978c'}}>Wk</th>
                  <th style={{textAlign:'center', padding:'8px 10px', borderBottom:'1.5px solid rgba(0,0,0,0.14)', fontSize:10, color:'#9c978c'}}>Status</th>
                  <th style={{textAlign:'right', padding:'8px 10px', borderBottom:'1.5px solid rgba(0,0,0,0.14)', fontSize:10, color:'#9c978c'}}>Records</th>
                  <th style={{textAlign:'right', padding:'8px 10px', borderBottom:'1.5px solid rgba(0,0,0,0.14)', fontSize:10, color:'#9c978c'}}>Ignored</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{padding:'5px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', fontFamily:"'JetBrains Mono',monospace", fontSize:10.5}}>{r.name}</td>
                    <td style={{padding:'5px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'center', fontFamily:"'JetBrains Mono',monospace"}}>{r.week}</td>
                    <td style={{padding:'5px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'center'}}>
                      {r.ok 
                        ? <span style={{color:'#2d6b3f', fontWeight:600}}>✓ ok</span>
                        : <span style={{color:'#a33225', fontWeight:600}} title={r.error}>✗ fout</span>
                      }
                    </td>
                    <td style={{padding:'5px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace"}}>{r.ok ? r.data.records_inserted : '-'}</td>
                    <td style={{padding:'5px 10px', borderBottom:'1px solid rgba(0,0,0,0.05)', textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#9c978c'}}>{r.ok ? r.data.records_ignored : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.some(r => !r.ok) && (
              <div style={{marginTop:14, fontSize:11.5, color:'#a33225'}}>
                {results.filter(r => !r.ok).map((r, i) => (
                  <div key={i}>• <strong>{r.name}</strong>: {r.error}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{marginTop:20, padding:'12px 16px', background:'#f5ebe0', borderRadius:8, fontSize:12, color:'#6b6960', lineHeight:1.6}}>
        <strong>Format:</strong> Dyflexis Realized hours weekrapport CSV (eerste 2 rijen = groep-headers, rij 3 = header). Per medewerker per week één rij. Bestaande actual-rijen voor dezelfde week worden vervangen. Mapping van archived/Kantoor afdelingen gebeurt automatisch via overrides.
      </div>
    </div>
  );
}
