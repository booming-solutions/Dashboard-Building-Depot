/* ============================================================
   BESTAND: page.js
   KOPIEER NAAR: src/app/login/page.js
   (vervang het bestaande login page.js bestand)
   
   WIJZIGING t.o.v. je huidige login:
   - Na succesvolle login: check must_change_password op het profiel
   - Als true: door naar /auth/welcome (wachtwoord wijzigen verplicht)
   - Als false: normaal door naar /dashboard
   ============================================================ */
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login');
  const [message, setMessage] = useState('');
  const [showPass, setShowPass] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (mode === 'login') {
      const signInResult = await supabase.auth.signInWithPassword({ email, password });
      if (signInResult.error) {
        setError(signInResult.error.message);
        setLoading(false);
        return;
      }

      // ═══ NIEUW: Check must_change_password ═══
      const user = signInResult.data && signInResult.data.user;
      if (user) {
        const profileResult = await supabase
          .from('profiles')
          .select('must_change_password, is_active')
          .eq('id', user.id)
          .single();

        // Check of account actief is
        if (profileResult.data && profileResult.data.is_active === false) {
          await supabase.auth.signOut();
          setError('Je account is gedeactiveerd. Neem contact op met je beheerder.');
          setLoading(false);
          return;
        }

        // Check of wachtwoord gewijzigd moet worden
        if (profileResult.data && profileResult.data.must_change_password === true) {
          router.push('/auth/welcome?mode=change_password');
          return;
        }
      }

      // Normale login: door naar dashboard
      router.push('/dashboard');
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setMessage('Check je e-mail om je account te bevestigen.');
      }
      setLoading(false);
    }
  }

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      `}</style>

      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #D4EAF7 0%, #B8D8EB 30%, #C5E1F2 60%, #D0E8F5 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Outfit', sans-serif",
        padding: '40px 20px 80px',
      }}>

        <div style={{
          width: '100px',
          height: '100px',
          borderRadius: '24px',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(27,46,74,0.12), 0 2px 8px rgba(27,46,74,0.06)',
          marginBottom: '16px',
        }}>
          <img
            src="/logo.png"
            alt="Booming Solutions"
            style={{ width: '76px', height: '76px', objectFit: 'contain' }}
          />
        </div>

        <h1 style={{
          fontSize: '28px',
          fontWeight: 700,
          color: '#1B2E4A',
          letterSpacing: '-0.02em',
          marginBottom: '4px',
          marginTop: '0',
        }}>
          Booming Solutions
        </h1>
        <p style={{
          fontSize: '13px',
          color: '#4B7A9E',
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: '36px',
          marginTop: '0',
        }}>
          CFO Dashboard Platform
        </p>

        <div style={{
          width: '100%',
          maxWidth: '400px',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px)',
          borderRadius: '20px',
          padding: '36px',
          boxShadow: '0 12px 40px rgba(27,46,74,0.1), 0 2px 12px rgba(27,46,74,0.04)',
          border: '1px solid rgba(255,255,255,0.9)',
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#4B7A9E',
                fontFamily: "'IBM Plex Mono', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '8px',
                fontWeight: 500,
              }}>
                E-mailadres
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@buildingdepot.cw"
                required
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  border: '2px solid #D4EAF7',
                  background: '#F8FBFD',
                  color: '#1B2E4A',
                  fontSize: '15px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: "'Outfit', sans-serif",
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={(e) => { e.target.style.borderColor = '#4BA3D4'; e.target.style.boxShadow = '0 0 0 3px rgba(75,163,212,0.12)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#D4EAF7'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div style={{ marginBottom: '28px' }}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                color: '#4B7A9E',
                fontFamily: "'IBM Plex Mono', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '8px',
                fontWeight: 500,
              }}>
                Wachtwoord
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: '100%',
                    padding: '14px 48px 14px 16px',
                    borderRadius: '12px',
                    border: '2px solid #D4EAF7',
                    background: '#F8FBFD',
                    color: '#1B2E4A',
                    fontSize: '15px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: "'Outfit', sans-serif",
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#4BA3D4'; e.target.style.boxShadow = '0 0 0 3px rgba(75,163,212,0.12)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#D4EAF7'; e.target.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94A3B8',
                    fontSize: '18px',
                    padding: '4px',
                  }}
                >
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: '#DC2626',
                fontSize: '13px',
                marginBottom: '16px',
              }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(16,185,129,0.08)',
                border: '1px solid rgba(16,185,129,0.2)',
                color: '#059669',
                fontSize: '13px',
                marginBottom: '16px',
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: loading
                  ? '#94A3B8'
                  : 'linear-gradient(135deg, #1B2E4A 0%, #263F5F 100%)',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 16px rgba(27,46,74,0.25)',
                fontFamily: "'Outfit', sans-serif",
                letterSpacing: '0.02em',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
            >
              {loading ? 'Even geduld...' : mode === 'login' ? 'Inloggen' : 'Account aanmaken'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#4BA3D4',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              {mode === 'login' ? 'Nog geen account? Registreren' : 'Al een account? Inloggen'}
            </button>
          </div>
        </div>

        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(135deg, #152238 0%, #1B2E4A 100%)',
          borderTop: '1px solid rgba(75,163,212,0.15)',
          padding: '12px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          <span style={{ fontSize: '12px', color: '#64748B', letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono', monospace" }}>
            VERGRENDELD
          </span>
          <span style={{ fontSize: '11px', color: '#475569', margin: '0 12px' }}>·</span>
          <span style={{ fontSize: '11px', color: '#475569', fontFamily: "'IBM Plex Mono', monospace" }}>
            © 2026 Booming Solutions
          </span>
        </div>
      </div>
    </>
  );
}
