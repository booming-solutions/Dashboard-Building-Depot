/* ============================================================
   BESTAND: page.js (admin daily-report-test)
   KOPIEER NAAR: src/app/dashboard/admin/daily-report-test/page.js
   (NIEUWE map maken: daily-report-test)

   Admin pagina met:
   - "Verstuur testmail nu" knop (roept /api/cron/daily-report aan)
   - Resultaat-feedback (welk store, hoeveel omzet, recipients, etc.)
   - Optie om een specifieke datum mee te geven (voor backfill / testing)
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

function fmtDate(d) {
  if (!d) return '—';
  if (typeof d === 'string') {
    const parts = d.split('-');
    return parseInt(parts[2]) + ' ' + MN[parseInt(parts[1]) - 1] + ' ' + parts[0];
  }
  return d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear();
}

export default function DailyReportTestPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Default = vandaag
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const supabase = createClient();

  useEffect(() => { checkAuth(); }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsAdmin(prof?.role === 'admin');
    }
    setAuthChecked(true);
  }

  async function sendNow() {
    setSending(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/cron/daily-report?date=' + selectedDate, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Send failed with status ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError('Network error: ' + e.message);
    }
    setSending(false);
  }

  if (!authChecked) return <LoadingLogo text="Verifiëren..." />;
  if (!isAdmin) {
    return (
      <div className="max-w-[800px] mx-auto py-12 text-center">
        <p className="text-[15px] text-[#6b5240]">Deze pagina is alleen toegankelijk voor admins.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto" style={{ fontFamily: "'DM Sans',-apple-system,sans-serif", color: '#1a0a04' }}>
      <div className="mb-5">
        <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: '22px', fontWeight: 900 }}>Daily Report — Test & Handmatig</h1>
        <p className="text-[13px] text-[#6b5240]">Verstuur de dagelijkse omzet-email handmatig of test een specifieke datum</p>
      </div>

      {/* Info kaart */}
      <div className="bg-blue-50 border border-blue-200 rounded-[14px] p-4 mb-5">
        <p className="text-[12px] font-bold text-blue-900 uppercase tracking-wide mb-2">Automatische verzending</p>
        <p className="text-[13px] text-blue-800 mb-1">
          De email wordt elke avond automatisch verstuurd om <strong>19:15 lokale tijd</strong> (23:15 UTC).
        </p>
        <p className="text-[12px] text-blue-700">
          Dit gebeurt via Vercel Cron. De rapport-datum is altijd "vandaag" (de dag die net is afgesloten).
        </p>
      </div>

      {/* Trigger */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] shadow-sm p-5 mb-5">
        <h3 className="text-[15px] font-bold mb-3">Handmatig versturen</h3>
        <p className="text-[12px] text-[#6b5240] mb-4">
          Verstuur de email voor een specifieke datum. Handig om backfill te doen of om de email te testen.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#6b5240] uppercase tracking-wide mb-1">Rapport-datum</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              max={todayStr}
              className="border border-[#e5ddd4] rounded-lg px-3 py-2 text-[13px]"
            />
          </div>
          <button
            onClick={sendNow}
            disabled={sending}
            className={`px-6 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors ${
              sending ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#E84E1B] hover:bg-[#c93f0f]'
            }`}
          >
            {sending ? 'Versturen...' : '📧 Verstuur testmail nu'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3">
            <p className="text-[12px] font-bold text-red-700 mb-1">Fout opgetreden</p>
            <p className="text-[12px] text-red-700 font-mono">{error}</p>
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-3">
            <p className="text-[12px] font-bold text-green-700 mb-2">✅ Email succesvol verstuurd</p>
            <table className="w-full text-[12px]">
              <tbody>
                <tr>
                  <td className="py-1 pr-3 text-[#6b5240]">Rapport-datum</td>
                  <td className="py-1 font-mono text-[#1a0a04]">{fmtDate(result.reportDate)}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 text-[#6b5240]">Ontvangers</td>
                  <td className="py-1 font-mono text-[#1a0a04]">{(result.recipients || []).join(', ')}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 text-[#6b5240]">Resend ID</td>
                  <td className="py-1 font-mono text-[10px] text-[#6b5240]">{result.resendId}</td>
                </tr>
              </tbody>
            </table>
            {result.storesProcessed && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-[11px] font-bold text-green-700 mb-1 uppercase tracking-wide">Verwerkte stores</p>
                {result.storesProcessed.map((s, i) => (
                  <p key={i} className="text-[11px] text-green-800 font-mono">
                    {s.store} — Vandaag: {Math.round(s.todaySales).toLocaleString('nl-NL')} · MTD: {Math.round(s.mtdSales).toLocaleString('nl-NL')} · YTD: {Math.round(s.ytdSales).toLocaleString('nl-NL')}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup-info */}
      <div className="bg-[#faf7f4] rounded-[14px] border border-[#e5ddd4] p-4">
        <p className="text-[11px] font-bold text-[#6b5240] uppercase tracking-wide mb-2">Setup-informatie</p>
        <ul className="text-[12px] text-[#6b5240] space-y-1 list-disc list-inside">
          <li>Afzender: <code className="text-[11px] bg-white px-1 py-0.5 rounded">noreply@boomingsolutions.ai</code></li>
          <li>Display naam: <em>Building Depot Daily Report</em></li>
          <li>Email service: Resend (zie <a href="https://resend.com" target="_blank" rel="noopener" className="text-[#E84E1B] underline">resend.com</a>)</li>
          <li>Ontvangers worden ingesteld via Vercel env var <code className="text-[11px] bg-white px-1 py-0.5 rounded">DAILY_REPORT_RECIPIENTS</code></li>
        </ul>
      </div>
    </div>
  );
}
