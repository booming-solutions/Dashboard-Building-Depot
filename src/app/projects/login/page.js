/* ============================================================
   BESTAND: page.js
   LOCATIE: src/app/projects/login/page.js
   Eigen loginscherm voor de projectomgeving.
   Losstaand van /login (dashboarding).
   ============================================================ */
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function ProjectsLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError('E-mailadres of wachtwoord klopt niet.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active, must_change_password, apps')
      .eq('id', data.user.id)
      .single();

    if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      setError('Je account is gedeactiveerd. Neem contact op met je beheerder.');
      setLoading(false);
      return;
    }

    if (!profile || !(profile.apps || []).includes('projects')) {
      await supabase.auth.signOut();
      setError('Dit account heeft geen toegang tot de projectomgeving.');
      setLoading(false);
      return;
    }

    if (profile.must_change_password === true) {
      router.push('/auth/welcome?mode=change_password&next=/projects');
      return;
    }

    router.push('/projects');
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(160deg, #e8eff7 0%, #dce6f1 55%, #cfdcec 100%)' }}>
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="Logo" className="h-11 w-11 rounded-lg" />
          <div>
            <p className="font-bold text-[#1B3A5C] text-[15px] leading-tight">BOOMING SOLUTIONS</p>
            <p className="text-[12px] text-[#1B3A5C]/60">Projectmanagement</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#c5d4e6] shadow-sm p-6">
          <h1 className="text-lg font-bold text-[#1B3A5C]">Inloggen</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Voor projectteams, klanten en leveranciers. Werk je met de dashboards?
            <a href="/login" className="text-[#1B3A5C] font-semibold underline ml-1">Ga naar dashboarding</a>.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div>
              <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">E-mailadres</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:border-[#1B3A5C]"
                placeholder="naam@bedrijf.com" autoComplete="username" />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#1B3A5C] mb-1">Wachtwoord</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 pr-16 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:border-[#1B3A5C]"
                  autoComplete="current-password" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#1B3A5C]/60">
                  {showPass ? 'verberg' : 'toon'}
                </button>
              </div>
            </div>

            {error && <div className="bg-red-50 border border-red-100 text-red-700 text-[12.5px] rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-[#1B3A5C] text-white text-[14px] font-semibold disabled:opacity-50">
              {loading ? 'Bezig...' : 'Inloggen'}
            </button>
          </form>

          <p className="text-[11.5px] text-gray-400 mt-4">
            Nog geen account? Accounts worden aangemaakt door de beheerder van Building Depot.
          </p>
        </div>

        <p className="text-[11px] text-[#1B3A5C]/40 text-center mt-5 font-mono">© 2026 Booming Solutions</p>
      </div>
    </div>
  );
}
