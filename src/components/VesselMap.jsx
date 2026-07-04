/* ============================================================
   BESTAND: VesselMap.jsx
   KOPIEER NAAR: src/components/VesselMap.jsx   (overschrijft)

   Wereldkaart met scheepsposities (Leaflet + OSM), GEEN npm nodig.
   Containers op hetzelfde schip (zelfde IMO) of dezelfde haven worden
   samengevoegd tot één marker met een teller. In de popup blader je
   met < / > door de containers.

   Props:
     vessels : [{ id, po_number, vendor_name, container_no, eta, name,
                  carrier, imo, live, place, lat, lng }]
     focusId : container-id waar de kaart op inzoomt (optioneel)
     height  : hoogte in px (default 420)
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
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
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

function memberCard(v) {
  const posNote = v.live === false ? `Laatst bekend: ${esc(v.place || '—')}` : 'Live scheepspositie';
  return `<div style="font:13px system-ui,Arial;min-width:190px">`
    + `<b>${esc(v.name || v.place || 'Schip')}</b><br/>`
    + `PO ${esc(v.po_number || '—')}<br/>${esc(v.vendor_name || '')}<br/>`
    + (v.carrier ? `Rederij ${esc(v.carrier)}<br/>` : '')
    + `Container ${esc(v.container_no || '—')}<br/>ETA ${esc(v.eta || '—')}<br/>`
    + `<span style="color:#6b7280">${posNote}</span></div>`;
}

function makePopupEl(members) {
  const el = document.createElement('div');
  let idx = 0;
  const render = (i) => {
    idx = ((i % members.length) + members.length) % members.length;
    const nav = members.length > 1
      ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px">`
        + `<button data-prev style="border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;padding:1px 9px;font-size:14px">&lt;</button>`
        + `<span style="font:600 12px system-ui;color:#1B3A5C">Container ${idx + 1} van ${members.length}</span>`
        + `<button data-next style="border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;padding:1px 9px;font-size:14px">&gt;</button>`
        + `</div>`
      : '';
    el.innerHTML = nav + memberCard(members[idx]);
    const p = el.querySelector('[data-prev]');
    const n = el.querySelector('[data-next]');
    if (p) p.addEventListener('click', (e) => { e.stopPropagation(); render(idx - 1); });
    if (n) n.addEventListener('click', (e) => { e.stopPropagation(); render(idx + 1); });
  };
  render(0);
  el.__render = render;
  el.__indexOf = (containerId) => members.findIndex((m) => m.id === containerId);
  return el;
}

export default function VesselMap({ vessels = [], focusId = null, height = 420 }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const store = useRef({ byId: {}, layers: [] });

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { worldCopyJump: true, scrollWheelZoom: true }).setView([20, 0], 2);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; OpenStreetMap' }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      store.current.layers.forEach((m) => map.removeLayer(m));
      store.current = { byId: {}, layers: [] };

      // Groepeer per schip (IMO) of, zonder live schip, per haven-positie
      const groups = {};
      vessels.forEach((v) => {
        if (v.lat == null || v.lng == null || isNaN(v.lat) || isNaN(v.lng)) return;
        const key = (v.live !== false && v.imo) ? ('imo:' + v.imo)
          : ('pos:' + Number(v.lat).toFixed(3) + ',' + Number(v.lng).toFixed(3));
        if (!groups[key]) groups[key] = { lat: v.lat, lng: v.lng, live: v.live, members: [] };
        groups[key].members.push(v);
      });

      const pts = [];
      Object.values(groups).forEach((g) => {
        const n = g.members.length;
        const glyph = g.live === false ? '📍' : '🚢';
        const html = `<div class="vf-marker">${glyph}${n > 1 ? `<span class="vf-badge">${n}</span>` : ''}</div>`;
        const icon = L.divIcon({ html, className: 'vf-div', iconSize: [30, 30], iconAnchor: [15, 15] });
        const m = L.marker([g.lat, g.lng], { icon }).addTo(map);
        const el = makePopupEl(g.members);
        m.bindPopup(el, { minWidth: 210 });
        store.current.layers.push(m);
        g.members.forEach((mem) => { store.current.byId[mem.id] = { marker: m, el }; });
        pts.push([g.lat, g.lng]);
      });

      if (focusId && store.current.byId[focusId]) {
        const { marker, el } = store.current.byId[focusId];
        map.setView(marker.getLatLng(), 5);
        const i = el.__indexOf(focusId); if (i >= 0) el.__render(i);
        marker.openPopup();
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
      <style>{`.vf-div{background:none;border:none}.vf-marker{position:relative;width:30px;height:30px;font-size:20px;line-height:30px;text-align:center;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}.vf-badge{position:absolute;top:-4px;right:-7px;background:#1B3A5C;color:#fff;font:700 11px system-ui;line-height:16px;min-width:16px;height:16px;border-radius:8px;padding:0 3px;text-align:center;border:1px solid #fff}`}</style>
    </div>
  );
}
