/* ============================================================
   BESTAND: VesselMap.jsx
   KOPIEER NAAR: src/components/VesselMap.jsx   (NIEUW)

   Herbruikbare wereldkaart met scheepsposities (Leaflet + OSM).
   Leaflet wordt van een CDN geladen — GEEN npm-install nodig.

   Props:
     vessels  : [{ id, po_number, vendor_name, container_no, eta, name, lat, lng }]
     focusId  : id van het schip waar de kaart op inzoomt (optioneel)
     height   : hoogte in px (default 420)
   ============================================================ */
'use client';

import { useEffect, useRef } from 'react';

let leafletPromise = null;
function loadLeaflet() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('Leaflet laden mislukt'));
    document.body.appendChild(s);
  });
  return leafletPromise;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default function VesselMap({ vessels = [], focusId = null, height = 420 }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { worldCopyJump: true, scrollWheelZoom: true }).setView([20, 0], 2);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 12, attribution: '&copy; OpenStreetMap',
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      Object.values(markersRef.current).forEach((m) => map.removeLayer(m));
      markersRef.current = {};
      const pts = [];
      vessels.forEach((v) => {
        if (v.lat == null || v.lng == null || isNaN(v.lat) || isNaN(v.lng)) return;
        const glyph = v.live === false ? '📍' : '🚢';
        const icon = L.divIcon({ html: glyph, className: 'vf-ship', iconSize: [26, 26], iconAnchor: [13, 13] });
        const m = L.marker([v.lat, v.lng], { icon }).addTo(map);
        const posNote = v.live === false ? `Laatst bekend: ${esc(v.place || '—')}` : 'Live scheepspositie';
        m.bindPopup(
          `<div style="font:13px system-ui,Arial"><b>${esc(v.name || v.place || 'Schip')}</b><br/>`
          + `PO ${esc(v.po_number || '—')}<br/>${esc(v.vendor_name || '')}<br/>`
          + (v.carrier ? `Rederij ${esc(v.carrier)}<br/>` : '')
          + `Container ${esc(v.container_no || '—')}<br/>ETA ${esc(v.eta || '—')}<br/>`
          + `<span style="color:#6b7280">${posNote}</span></div>`
        );
        markersRef.current[v.id] = m;
        pts.push([v.lat, v.lng]);
      });
      if (focusId && markersRef.current[focusId]) {
        const m = markersRef.current[focusId];
        map.setView(m.getLatLng(), 5);
        m.openPopup();
      } else if (pts.length) {
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 6 });
      }
      setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 150);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [vessels, focusId]);

  useEffect(() => () => {
    if (mapRef.current) { try { mapRef.current.remove(); } catch (e) {} mapRef.current = null; }
  }, []);

  return (
    <div>
      <div ref={ref} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }} />
      <style>{`.vf-ship{font-size:20px;line-height:26px;text-align:center;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}`}</style>
    </div>
  );
}
