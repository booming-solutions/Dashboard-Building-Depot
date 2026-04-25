/* ============================================================
   BESTAND: page.js (v5)
   KOPIEER NAAR: src/app/auth/welcome/page.js
   (vervang het bestaande bestand)
   
   FIX t.o.v. v4:
   - useSearchParams() is nu binnen een Suspense boundary geplaatst
     (Next.js vereiste, anders faalt de build)
   ============================================================ */
'use client';

import { useState, useEffect, Suspense } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';

// ═══ MAIN PAGE COMPONENT - wraps in Suspense ═══
export default function WelcomePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <WelcomeContent />
    </Suspense>
  );
}

function LoadingFallback() {
  var pageWrapStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(145deg, #D4EAF7 0%, #B8D8EB 30%, #C5E1F2 60%, #D0E8F5 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Outfit', -apple-system, sans-serif",
    padding: '40px 20px',
  };
  return (
    <>
      <style jsx global>{"@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');"}</style>
      <div style={pageWrapStyle}>
        <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: '20px', padding: '36px', maxWidth: '440px', width: '100%' }}>
          <p style={{ textAlign: 'center', color: '#4B7A9E', fontSize: '14px', margin: 0 }}>Moment...</p>
        </div>
      </div>
    </>
  );
}

// ═══ ACTUAL CONTENT - uses useSearchParams ═══
function WelcomeContent() {
  var _pw = useState(''), password = _pw[0], setPassword = _pw[1];
  var _pw2 = useState(''), password2 = _pw2[0], setPassword2 = _pw2[1];
  var _loading = useState(false), loading = _loading[0], setLoading = _loading[1];
  var _error = useState(''), error = _error[0], setError = _error[1];
  var _showPw = useState(false), showPw = _showPw[0], setShowPw = _showPw[1];
  var _user = useState(null), user = _user[0], setUser = _user[1];
  var _checking = useState(true), checking = _checking[0], setChecking = _checking[1];
  var _done = useState(false), done = _done[0], setDone = _done[1];
  var _invalidReason = useState(''), invalidReason = _invalidReason[0], setInvalidReason = _invalidReason[1];
  var _flowMode = useState('invite'), flowMode = _flowMode[0], setFlowMode = _flowMode[1];

  var router = useRouter();
  var searchParams = useSearchParams();
  var supabase = createClient();

  useEffect(function() { checkFlow(); }, []);

  async function checkFlow() {
    var modeParam = searchParams.get('mode');
    var hash = typeof window !== 'undefined' ? window.location.hash : '';
    var hasInviteToken = hash.indexOf('access_token') >= 0 && 
                         (hash.indexOf('type=invite') >= 0 || hash.indexOf('type=recovery') >= 0);

    // Flow A: change_password mode (van login pagina)
    if (modeParam === 'change_password') {
      setFlowMode('change_password');
      var sessionCheck = await supabase.auth.getSession();
      if (!sessionCheck.data || !sessionCheck.data.session) {
        setInvalidReason('Je sessie is verlopen. Log opnieuw in.');
        setChecking(false);
        return;
      }
      var userResult = await supabase.auth.getUser();
      if (userResult.data && userResult.data.user) {
        setUser(userResult.data.user);
      } else {
        setInvalidReason('Je sessie is verlopen. Log opnieuw in.');
      }
      setChecking(false);
      return;
    }

    // Flow B: invite token in URL (legacy)
    if (hasInviteToken) {
      setFlowMode('invite');
      var existing = await supabase.auth.getSession();
      if (existing.data && existing.data.session) {
        var currentHash = window.location.hash;
        await supabase.auth.signOut();
        if (window.location.hash !== currentHash) {
          window.location.hash = currentHash;
        }
        await new Promise(function(resolve) { setTimeout(resolve, 400); });
      }
      await new Promise(function(resolve) { setTimeout(resolve, 600); });

      var inviteUserResult = await supabase.auth.getUser();
      if (inviteUserResult.data && inviteUserResult.data.user) {
        setUser(inviteUserResult.data.user);
      } else {
        setInvalidReason('Deze uitnodigingslink is ongeldig of al gebruikt. Neem contact op met je beheerder.');
      }
      setChecking(false);
      return;
    }

    // Geen mode, geen token
    var fallbackSession = await supabase.auth.getSession();
    if (fallbackSession.data && fallbackSession.data.session) {
      router.push('/dashboard');
      return;
    }

    setInvalidReason('Deze pagina is alleen bereikbaar via een uitnodiging of na inloggen met een tijdelijk wachtwoord. Ga naar de login-pagina om in te loggen.');
    setChecking(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!password || password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens zijn');
      return;
    }
    if (password !== password2) {
      setError('De wachtwoorden komen niet overeen');
      return;
    }

    setLoading(true);

    var pwResult = await supabase.auth.updateUser({ password: password });
    if (pwResult.error) {
      setError('Er ging iets mis: ' + pwResult.error.message);
      setLoading(false);
      return;
    }

    if (user && user.id) {
      await supabase.from('profiles').update({
        must_change_password: false,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
    }

    setDone(true);
    setLoading(false);

    setTimeout(function() {
      router.push('/dashboard');
    }, 2000);
  }

  // ═ Stijlen ═
  var pageWrapStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(145deg, #D4EAF7 0%, #B8D8EB 30%, #C5E1F2 60%, #D0E8F5 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Outfit', -apple-system, sans-serif",
    padding: '40px 20px 80px',
  };

  var cardStyle = {
    width: '100%',
    maxWidth: '440px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(20px)',
    borderRadius: '20px',
    padding: '36px',
    boxShadow: '0 12px 40px rgba(27,46,74,0.1), 0 2px 12px rgba(27,46,74,0.04)',
    border: '1px solid rgba(255,255,255,0.9)',
  };

  var labelStyle = {
    display: 'block',
    fontSize: '12px',
    color: '#4B7A9E',
    fontFamily: "'IBM Plex Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '8px',
    fontWeight: 500,
  };

  var inputBaseStyle = {
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
  };

  var fontImport = "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

  if (checking) {
    return (
      <>
        <style jsx global>{fontImport}</style>
        <div style={pageWrapStyle}>
          <div style={cardStyle}>
            <p style={{ textAlign: 'center', color: '#4B7A9E', fontSize: '14px', margin: 0 }}>
              Moment...
            </p>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <style jsx global>{fontImport}</style>
        <div style={pageWrapStyle}>
          <div style={cardStyle}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '18px', background: '#FEE2E2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '36px' }}>⚠️</span>
              </div>
              <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1B2E4A', marginBottom: '8px', marginTop: 0 }}>Geen toegang</h1>
              <p style={{ fontSize: '14px', color: '#4B7A9E', lineHeight: 1.5, margin: 0 }}>{invalidReason}</p>
            </div>
            <a href="/login" style={{ display: 'block', textAlign: 'center', padding: '14px', borderRadius: '12px', background: '#1B2E4A', color: '#fff', fontSize: '15px', fontWeight: 600, textDecoration: 'none' }}>
              Naar inloggen
            </a>
          </div>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <>
        <style jsx global>{fontImport}</style>
        <div style={pageWrapStyle}>
          <div style={cardStyle}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '18px', background: '#D1FAE5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '36px' }}>✅</span>
              </div>
              <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1B2E4A', marginBottom: '8px', marginTop: 0 }}>Wachtwoord ingesteld</h1>
              <p style={{ fontSize: '14px', color: '#4B7A9E', lineHeight: 1.5, margin: 0 }}>Je wordt doorgestuurd naar het dashboard...</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  var headerTitle = flowMode === 'change_password' ? 'Stel je nieuwe wachtwoord in' : 'Welkom!';
  var headerSubtitle = flowMode === 'change_password' 
    ? 'Bij je eerste login moet je het tijdelijke wachtwoord vervangen door een eigen wachtwoord.'
    : 'Stel een wachtwoord in om toegang te krijgen tot je dashboard.';

  return (
    <>
      <style jsx global>{fontImport}</style>
      <div style={pageWrapStyle}>

        <div style={{ width: '100px', height: '100px', borderRadius: '24px', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(27,46,74,0.12), 0 2px 8px rgba(27,46,74,0.06)', marginBottom: '16px' }}>
          <img src="/logo.png" alt="Booming Solutions" style={{ width: '76px', height: '76px', objectFit: 'contain' }} />
        </div>

        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1B2E4A', letterSpacing: '-0.02em', marginBottom: '4px', marginTop: '0' }}>
          Booming Solutions
        </h1>
        <p style={{ fontSize: '13px', color: '#4B7A9E', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '36px', marginTop: '0' }}>
          CFO Dashboard Platform
        </p>

        <div style={cardStyle}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1B2E4A', marginBottom: '6px', marginTop: 0 }}>
            {headerTitle}
          </h2>
          <p style={{ fontSize: '14px', color: '#4B7A9E', marginBottom: '20px', lineHeight: 1.5, marginTop: 0 }}>
            {headerSubtitle}
          </p>

          <div style={{ padding: '14px 16px', borderRadius: '12px', background: '#F8FBFD', border: '2px solid #D4EAF7', marginBottom: '24px' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#4B7A9E', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
              Account
            </p>
            <p style={{ margin: 0, fontSize: '15px', color: '#1B2E4A', fontWeight: 600 }}>
              {user.email}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Nieuw wachtwoord</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={function(e) { setPassword(e.target.value); }}
                  placeholder="Minimaal 8 tekens"
                  required
                  minLength={8}
                  style={Object.assign({}, inputBaseStyle, { padding: '14px 48px 14px 16px' })}
                  onFocus={function(e) { e.target.style.borderColor = '#4BA3D4'; e.target.style.boxShadow = '0 0 0 3px rgba(75,163,212,0.12)'; }}
                  onBlur={function(e) { e.target.style.borderColor = '#D4EAF7'; e.target.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={function() { setShowPw(!showPw); }}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '18px', padding: '4px' }}
                >
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Herhaal wachtwoord</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={password2}
                onChange={function(e) { setPassword2(e.target.value); }}
                placeholder="Herhaal je wachtwoord"
                required
                minLength={8}
                style={inputBaseStyle}
                onFocus={function(e) { e.target.style.borderColor = '#4BA3D4'; e.target.style.boxShadow = '0 0 0 3px rgba(75,163,212,0.12)'; }}
                onBlur={function(e) { e.target.style.borderColor = '#D4EAF7'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div style={{ padding: '12px 14px', borderRadius: '10px', background: '#F8FBFD', border: '1px solid #D4EAF7', marginBottom: '20px' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#4B7A9E', lineHeight: 1.5 }}>
                💡 Gebruik een sterk wachtwoord met minimaal 8 tekens. Combineer letters, cijfers en symbolen voor extra veiligheid.
              </p>
            </div>

            {error && (
              <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#DC2626', fontSize: '13px', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: '2px solid #1B2E4A',
                background: loading ? '#94A3B8' : '#ffffff',
                color: loading ? '#ffffff' : '#1B2E4A',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: "'Outfit', sans-serif",
                letterSpacing: '0.02em',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {loading ? 'Wachtwoord instellen...' : 'Wachtwoord instellen & doorgaan'}
            </button>
          </form>
        </div>

        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#152238',
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
