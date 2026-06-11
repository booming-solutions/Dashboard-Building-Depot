/* ============================================================
   BESTAND: sandbox_ap_page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/sandbox-ap/page.js
   (nieuwe folder: sandbox-ap/, hernoemen naar page.js)

   Sandbox dashboard — toont per tabel het aantal rijen en
   verschil met live. Plus knoppen om sandbox te resetten of
   te legen. Voor Python scripting buiten de browser is geen
   UI nodig — gebruik gewoon tabel-namen sandbox_ap_*.
   ============================================================ */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import Link from 'next/link';

const TABLES = [
  { live: 'ap_vendor_alias_groups', sandbox: 'sandbox_ap_vendor_alias_groups' },
  { live: 'ap_vendors',              sandbox: 'sandbox_ap_vendors' },
  { live: 'ap_invoices',             sandbox: 'sandbox_ap_invoices' },
  { live: 'ap_batches',              sandbox: 'sandbox_ap_batches' },
  { live: 'ap_match_candidates',     sandbox: 'sandbox_ap_match_candidates' },
  { live: 'ap_comments',             sandbox: 'sandbox_ap_comments' },
  { live: 'ap_audit_log',            sandbox: 'sandbox_ap_audit_log' },
];

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('nl-NL').format(n);
}

export default function SandboxApDashboard() {
  const supabase = createClient();
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = {};
      for (const t of TABLES) {
        const { count: live } = await supabase.from(t.live).select('*', { count: 'exact', head: true });
        const { count: sandbox } = await supabase.from(t.sandbox).select('*', { count: 'exact', head: true });
        out[t.sandbox] = { live: live || 0, sandbox: sandbox || 0 };
      }
      setCounts(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const totalSandboxRows = Object.values(counts).reduce((s, c) => s + c.sandbox, 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[#1B3A5C]/40 mb-2">
          <Link href="/dashboard" className="hover:text-[#1B3A5C]">Dashboard</Link>
          <span>›</span>
          <span>Sandbox AP</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          🧪 Sandbox AP
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Speeltuin voor scripts en experimenten. Volledige kopie van AP-tabellen onder <code className="px-1 bg-gray-100 rounded text-[11px] font-mono">sandbox_ap_*</code> prefix.
          Wijzigingen hier raken de live AP-data niet.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4">
          <p className="text-[13px] text-rose-900"><strong>Fout:</strong> {error}</p>
        </div>
      )}

      {/* Status */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-[16px] font-bold text-[#1B3A5C]">Tabel status</h2>
          <button onClick={loadCounts} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-gray-100 text-[#1B3A5C]/70 text-[12px] font-semibold hover:bg-gray-200 disabled:opacity-50">
            {loading ? '...' : '↻ Vernieuw'}
          </button>
        </div>

        {loading ? (
          <p className="text-[12px] text-[#1B3A5C]/40 italic">Tellen...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="p-2 text-left font-semibold text-[#1B3A5C]/70">Tabel</th>
                  <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Live</th>
                  <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Sandbox</th>
                  <th className="p-2 text-right font-semibold text-[#1B3A5C]/70">Verschil</th>
                </tr>
              </thead>
              <tbody>
                {TABLES.map(t => {
                  const c = counts[t.sandbox] || { live: 0, sandbox: 0 };
                  const diff = c.sandbox - c.live;
                  return (
                    <tr key={t.sandbox} className="border-b border-gray-100">
                      <td className="p-2">
                        <code className="font-mono text-[#1B3A5C]">{t.sandbox}</code>
                      </td>
                      <td className="p-2 text-right font-mono text-[#1B3A5C]/60">{fmtNum(c.live)}</td>
                      <td className="p-2 text-right font-mono font-semibold text-[#1B3A5C]">{fmtNum(c.sandbox)}</td>
                      <td className={`p-2 text-right font-mono ${diff === 0 ? 'text-[#1B3A5C]/40' : diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {diff === 0 ? '=' : (diff > 0 ? '+' : '') + fmtNum(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Python connectie info */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
        <h2 className="text-[16px] font-bold text-[#1B3A5C] mb-3">🐍 Python connectie</h2>
        <p className="text-[12px] text-[#1B3A5C]/60 mb-3">
          Gebruik in je Python script dezelfde Supabase URL/key als de portal, maar verwijs naar de sandbox-tabellen:
        </p>
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 text-[11px] overflow-x-auto font-mono">{`from supabase import create_client

# Zelfde credentials als portal — gebruik service_role_key voor bypass RLS
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Lees uit sandbox
res = supabase.table('sandbox_ap_invoices').select('*').limit(10).execute()
print(res.data)

# Wijzig in sandbox (verandert live data NIET)
supabase.table('sandbox_ap_invoices').update({'status': 'paid'}).eq('id', 'xxx').execute()`}</pre>
      </div>

      {/* Onderhoud */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h2 className="text-[16px] font-bold text-amber-900 mb-2">🔧 Onderhoud</h2>
        <p className="text-[12px] text-amber-800 mb-3">
          Sandbox opnieuw vullen vanuit live of compleet legen kan via Supabase SQL Editor.
          Run het SQL-bestand <code className="px-1 bg-white rounded font-mono">ap_sandbox_schema_v1.sql</code> opnieuw om sandbox te resetten naar live state.
        </p>
        <details className="text-[12px] text-amber-900 cursor-pointer">
          <summary className="font-semibold mb-2">SQL voor leeg maken</summary>
          <pre className="bg-white border border-amber-200 rounded p-2 mt-2 font-mono text-[11px] overflow-x-auto">{`TRUNCATE public.sandbox_ap_audit_log,
         public.sandbox_ap_comments,
         public.sandbox_ap_match_candidates,
         public.sandbox_ap_batches,
         public.sandbox_ap_invoices,
         public.sandbox_ap_vendors,
         public.sandbox_ap_vendor_alias_groups CASCADE;`}</pre>
        </details>
      </div>

      <div className="mt-6 text-[11px] text-[#1B3A5C]/40 text-center">
        Totaal {fmtNum(totalSandboxRows)} rijen in sandbox
      </div>
    </div>
  );
}
