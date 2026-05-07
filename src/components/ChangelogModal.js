/* ============================================================
   BESTAND: ChangelogModal.js
   KOPIEER NAAR: src/components/ChangelogModal.js
   
   Modal die changelog items toont, gegroepeerd per week.
   Wordt geopend door op het versienummer in de footer te klikken.
   ============================================================ */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

var MN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

function fmtWeek(weekStart) {
  // weekStart is YYYY-MM-DD (maandag)
  var d = new Date(weekStart + 'T00:00:00');
  var d2 = new Date(d);
  d2.setDate(d2.getDate() + 6); // zondag
  return 'Week van ' + d.getDate() + ' ' + MN[d.getMonth()] + ' t/m ' + d2.getDate() + ' ' + MN[d2.getMonth()] + ' ' + d2.getFullYear();
}

function categoryStyle(cat) {
  if (cat === 'feature') return { bg: '#dbeafe', text: '#1e40af', label: 'Nieuw' };
  if (cat === 'fix') return { bg: '#fef3c7', text: '#92400e', label: 'Aanpassing' };
  return { bg: '#dcfce7', text: '#166534', label: 'Verbetering' };
}

export default function ChangelogModal({ open, onClose }) {
  var _s = useState;
  var _items = _s([]), items = _items[0], setItems = _items[1];
  var _l = _s(true), loading = _l[0], setLoading = _l[1];

  useEffect(function() {
    if (!open) return;
    var supabase = createClient();
    setLoading(true);
    supabase
      .from('changelog')
      .select('*')
      .order('week_start', { ascending: false })
      .order('created_at', { ascending: true })
      .then(function(r) {
        setItems(r.data || []);
        setLoading(false);
      });
  }, [open]);

  if (!open) return null;

  // Group items by week_start
  var grouped = {};
  items.forEach(function(it) {
    if (!grouped[it.week_start]) grouped[it.week_start] = [];
    grouped[it.week_start].push(it);
  });
  var weeks = Object.keys(grouped).sort().reverse();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={function(e) { e.stopPropagation(); }}
        style={{
          backgroundColor: 'white', borderRadius: '14px', maxWidth: '720px', width: '100%',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          fontFamily: "'DM Sans', -apple-system, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #e5ddd4',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900, color: '#1a0a04', margin: 0 }}>
              Wat is er nieuw?
            </h2>
            <p style={{ fontSize: '12px', color: '#6b5240', margin: '4px 0 0 0' }}>
              Overzicht van recente verbeteringen aan het dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: '24px', color: '#6b5240',
              cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
            }}
            onMouseEnter={function(e) { e.target.style.backgroundColor = '#f0ebe5'; }}
            onMouseLeave={function(e) { e.target.style.backgroundColor = 'transparent'; }}
          >×</button>
        </div>

        {/* Content */}
        <div style={{ overflow: 'auto', padding: '20px 24px', flex: 1 }}>
          {loading && <p style={{ color: '#6b5240', fontSize: '13px' }}>Laden...</p>}
          {!loading && weeks.length === 0 && (
            <p style={{ color: '#6b5240', fontSize: '13px' }}>Nog geen changelog items.</p>
          )}
          {!loading && weeks.map(function(wk) {
            return (
              <div key={wk} style={{ marginBottom: '24px' }}>
                <h3 style={{
                  fontSize: '13px', fontWeight: 700, color: '#1B3A5C',
                  textTransform: 'uppercase', letterSpacing: '0.8px',
                  marginBottom: '12px', borderBottom: '2px solid #e5ddd4', paddingBottom: '6px',
                }}>
                  {fmtWeek(wk)}
                </h3>
                {grouped[wk].map(function(it) {
                  var s = categoryStyle(it.category);
                  return (
                    <div key={it.id} style={{
                      backgroundColor: '#faf7f4', borderRadius: '10px',
                      padding: '12px 14px', marginBottom: '8px',
                      border: '1px solid #f0ebe5',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <span style={{
                          backgroundColor: s.bg, color: s.text,
                          fontSize: '10px', fontWeight: 700,
                          padding: '3px 8px', borderRadius: '6px',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          {s.label}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b5240', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
                            {it.area}
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a0a04', marginBottom: '2px' }}>
                            {it.title}
                          </div>
                          {it.description && (
                            <div style={{ fontSize: '12px', color: '#6b5240', lineHeight: '1.4' }}>
                              {it.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
