/* ============================================================
   BESTAND: page.js  (Wereldkaart schepen)
   KOPIEER NAAR: src/app/dashboard/logistics/vessel-map/page.js   (overschrijft)

   Toont alle containers met een positie (via VesselFinder).
   - Ververst de data automatisch elke 60s (toont nieuwe posities zodra
     die in de database staan).
   - Knop "Ververs posities" haalt de varende containers meteen opnieuw
     op bij VesselFinder.
   ============================================================ */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import dynamic from 'next/dynamic';

const VesselMap = dynamic(() => import('@/components/VesselMap'), { ssr: false, loading: () => <div style={{ height: 580, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>Kaart laden…</div> });

const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${+m[3]}-${+m[2]}-${m[1]}` : new Date(d).toLocaleDateString('nl-NL');
};
const mapPos = (r) => {
  if (r.vessel_lat != null && r.vessel_lng != null) return { lat: +r.vessel_lat, lng: +r.vessel_lng, live: true, place: r.vessel_name };
  if (r.pod_lat != null && r.pod_lng != null) return { lat: +r.pod_lat, lng: +r.pod_lng, live: false, place: r.pod_name };
  if (r.pol_lat != null && r.pol_lng != null) return { lat: +r.pol_lat, lng: +r.pol_lng, live: false, place: r.pol_name };
  return null;
};

export default function VesselMapPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [skuPOs, setSkuPOs] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [msg, setMsg] = useState(null);

  const loadRows = useCallback(async () => {
    const { data } = await supabase.from('order_flow_containers')
      .select('id, container_no, eta, carrier, vessel_name, vessel_imo, vessel_lat, vessel_lng, pol_name, pol_lat, pol_lng, pod_name, pod_lat, pod_lng, tracking_updated_at, order_flow ( po_number, vendor_name )')
      .or('vessel_lat.not.is.null,pod_lat.not.is.null,pol_lat.not.is.null');
    setRows(data || []);
    setLoading(false);
    setLastUpdate(new Date());
  }, [supabase]);

  // Eerste load + automatisch elke 60s verversen vanuit de database
  useEffect(() => {
    loadRows();
    const id = setInterval(loadRows, 60000);
    return () => clearInterval(id);
  }, [loadRows]);

  // SKU-zoeken: vind po_numbers met een matchend artikelnummer/omschrijving
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSkuPOs(null); return; }
    let cancel = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('order_flow_items')
        .select('po_number')
        .or(`item_number.ilike.%${term}%,item_description.ilike.%${term}%`)
        .limit(3000);
      if (!cancel) setSkuPOs(new Set((data || []).map((x) => x.po_number)));
    }, 300);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, supabase]);

  async function refreshPositions() {
    setRefreshing(true); setMsg(null);
    try {
      const res = await fetch('/api/order-flow/track-refresh', { method: 'POST' });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Verversen mislukt'); }
      else {
        setMsg(`Bijgewerkt: ${j.updated} · nog bezig: ${j.processing} · fouten: ${j.errors}${j.containers_remaining != null ? ` · ${j.containers_remaining} containers over` : ''}`);
        await loadRows();
      }
    } catch (e) { setMsg('Netwerkfout: ' + e.message); } finally { setRefreshing(false); }
  }

  const vessels = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const po = r.order_flow?.po_number || '';
      if (!term) return true;
      const hay = `${po} ${r.order_flow?.vendor_name || ''} ${r.container_no || ''}`.toLowerCase();
      if (hay.includes(term)) return true;
      if (skuPOs && skuPOs.has(po)) return true;
      return false;
    }).map((r) => {
      const p = mapPos(r);
      return {
        id: r.id, po_number: r.order_flow?.po_number, vendor_name: r.order_flow?.vendor_name, container_no: r.container_no,
        eta: fmtDate(r.eta), name: r.vessel_name, carrier: r.carrier,
        imo: r.vessel_imo, live: p ? p.live : true, place: p ? p.place : null,
        lat: p ? p.lat : null, lng: p ? p.lng : null,
      };
    }).filter((v) => v.lat != null);
  }, [rows, q, skuPOs]);

  return (
    <div style={{ padding: 24, maxWidth: 1360, margin: '0 auto', fontFamily: 'system-ui,Arial,sans-serif' }}>
      <h1 style={{ color: '#1B3A5C', margin: '0 0 4px', fontSize: 24 }}>Schepen wereldwijd</h1>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 14px' }}>
        Alle containers met een positie via VesselFinder. De kaart ververst automatisch elke minuut.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek op SKU, PO, leverancier of container…"
          style={{ flex: '1 1 360px', minWidth: 240, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
        />
        <button onClick={refreshPositions} disabled={refreshing}
          style={{ padding: '10px 14px', border: '1px solid #1B3A5C', background: refreshing ? '#93a4b8' : '#1B3A5C', color: '#fff', borderRadius: 8, fontSize: 14, cursor: refreshing ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
          {refreshing ? 'Verversen…' : 'Ververs posities'}
        </button>
      </div>

      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>
        {loading ? 'Laden…' : `${vessels.length} schip(en) getoond${q.trim() ? ' (gefilterd)' : ''}`}
        {lastUpdate && !loading ? ` · laatst geladen ${lastUpdate.toLocaleTimeString('nl-NL')}` : ''}
        {msg ? ` · ${msg}` : ''}
      </div>

      <VesselMap vessels={vessels} height={580} />
      {!loading && rows.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 13, marginTop: 12 }}>
          Nog geen containers met een positie. Haal in Order Flow een ETA op via VesselFinder, of klik hierboven op &quot;Ververs posities&quot;.
        </div>
      )}
    </div>
  );
}
