'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export default function DashboardOverview() {
  const [profile, setProfile] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function getProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(data);
      }
    }
    getProfile();
  }, []);

  const tiles = [
    {
      label: 'Omzet',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 38L18 26l8 8 16-20"/>
          <path d="M32 14h10v10"/>
        </svg>
      ),
    },
    {
      label: 'Voorraad',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="22" width="36" height="20" rx="2"/>
          <path d="M6 28h36"/>
          <path d="M16 6h16l6 16H10L16 6z"/>
          <path d="M20 34h8"/>
        </svg>
      ),
    },
    {
      label: 'Crediteuren',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="10" width="36" height="28" rx="3"/>
          <path d="M6 20h36"/>
          <path d="M14 30h6"/>
          <path d="M28 30h6"/>
          <circle cx="36" cy="16" r="0.5" fill="#1B3A5C"/>
        </svg>
      ),
    },
    {
      label: 'Debiteuren',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="6" width="32" height="36" rx="2"/>
          <path d="M16 16h16"/>
          <path d="M16 24h16"/>
          <path d="M16 32h10"/>
          <path d="M34 30l4 4-4 4"/>
        </svg>
      ),
    },
    {
      label: 'Maandafsluiting',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="8" width="36" height="34" rx="3"/>
          <path d="M6 18h36"/>
          <path d="M16 4v8"/>
          <path d="M32 4v8"/>
          <path d="M19 28l4 4 8-8"/>
        </svg>
      ),
    },
    {
      label: 'Conversie',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="18"/>
          <path d="M24 14v10l6 6"/>
          <path d="M14 8l-4-4"/>
          <path d="M34 8l4-4"/>
        </svg>
      ),
    },
    {
      label: 'Cashflow',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="16"/>
          <path d="M24 14v20"/>
          <path d="M18 20c0-3.3 2.7-4 6-4s6 .7 6 4-2.7 4-6 4-6 .7-6 4 2.7 4 6 4 6-.7 6-4"/>
        </svg>
      ),
    },
    {
      label: 'KPI Overzicht',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="18"/>
          <path d="M24 14v10"/>
          <circle cx="24" cy="24" r="2" fill="#1B3A5C"/>
          <path d="M24 6v4"/>
          <path d="M24 38v4"/>
          <path d="M6 24h4"/>
          <path d="M38 24h4"/>
        </svg>
      ),
    },
    {
      label: 'Budget 2026',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="12" width="36" height="28" rx="3"/>
          <path d="M6 22h36"/>
          <path d="M18 12V8"/>
          <path d="M30 12V8"/>
          <rect x="14" y="28" width="6" height="6" rx="1"/>
          <rect x="28" y="28" width="6" height="6" rx="1"/>
        </svg>
      ),
    },
    {
      label: 'Personeel',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="16" r="8"/>
          <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16"/>
          <circle cx="38" cy="14" r="5"/>
          <path d="M42 34c0-4-2.5-7-6-8"/>
        </svg>
      ),
    },
    {
      label: 'Winst & Verlies',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="34" width="8" height="10" rx="1"/>
          <rect x="14" y="26" width="8" height="18" rx="1"/>
          <rect x="24" y="18" width="8" height="26" rx="1"/>
          <rect x="34" y="10" width="8" height="34" rx="1"/>
          <path d="M8 14l10 4 10-6 10-4"/>
        </svg>
      ),
    },
    {
      label: 'Balans',
      icon: (
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#1B3A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 6v36"/>
          <path d="M8 16l16-6 16 6"/>
          <path d="M4 16l8 12h-16z" fill="none"/>
          <path d="M32 16l8 12h-16z" fill="none"/>
          <path d="M16 42h16"/>
        </svg>
      ),
    },
  ];

  return (
    <div style={{ paddingBottom: '60px' }}>
      {/* Welkom */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          color: '#1B3A5C',
          margin: '0 0 6px 0',
          fontFamily: "'Bookman Old Style', 'Georgia', serif",
        }}>
          Welkom{profile?.full_name ? `, ${profile.full_name}` : ''}
        </h1>
        <p style={{
          fontSize: '14px',
          color: '#64748B',
          margin: 0,
        }}>
          Selecteer een module om te beginnen
        </p>
      </div>

      {/* Tegels Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '20px',
      }}>
        {tiles.map((tile, index) => (
          <div
            key={index}
            style={{
              aspectRatio: '1',
              borderRadius: '20px',
              border: '4px solid #1B3A5C',
              background: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 2px 8px rgba(27,58,92,0.08)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(27,58,92,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(27,58,92,0.08)';
            }}
          >
            {/* Icoon gebied - 80% van de hoogte */}
            <div style={{
              flex: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}>
              {tile.icon}
            </div>

            {/* Tekst balk - 20% van de hoogte */}
            <div style={{
              background: 'linear-gradient(135deg, #1B3A5C 0%, #263F5F 100%)',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '20%',
            }}>
              <span style={{
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                textAlign: 'center',
                letterSpacing: '0.02em',
              }}>
                {tile.label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
