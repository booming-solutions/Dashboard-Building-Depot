/* ============================================================
   BESTAND: page.js  (Wereldkaart schepen)
   KOPIEER NAAR: src/app/dashboard/logistics/vessel-map/page.js   (NIEUW)

   Toont alle PO's met een live scheepspositie (via VesselFinder).
   Zoeken op SKU, PO, leverancier of containernummer.
   Gebruikt src/components/VesselMap.jsx.
   ============================================================ */
'use client';

import { useEffect, useMemo, useState } from 'react';
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
  const [skuPOs, setSkuPOs] = useState(null); // Set van po_numbers die matchen op SKU

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('order_flow')
        .select('id, po_number, vendor_name, container_no, eta, carrier, vessel_name, vessel_lat, vessel_lng, pol_name, pol_lat, pol_lng, pod_name, pod_lat, pod_lng, tracking_updated_at')
        .or('vessel_lat.not.is.null,pod_lat.not.is.null,pol_lat.not.is.null');
      setRows(data || []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const vessels = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!term) return true;
      const hay = `${r.po_number || ''} ${r.vendor_name || ''} ${r.container_no || ''}`.toLowerCase();
      if (hay.includes(term)) return true;
      if (skuPOs && skuPOs.has(r.po_number)) return true;
      return false;
    }).map((r) => {
      const p = mapPos(r);
      return {
        id: r.id, po_number: r.po_number, vendor_name: r.vendor_name, container_no: r.container_no,
        eta: fmtDate(r.eta), name: r.vessel_name, carrier: r.carrier,
        live: p ? p.live : true, place: p ? p.place : null,
        lat: p ? p.lat : null, lng: p ? p.lng : null,
      };
    }).filter((v) => v.lat != null);
  }, [rows, q, skuPOs]);

  return (
    <div style={{ padding: 24, maxWidth: 1360, margin: '0 auto', fontFamily: 'system-ui,Arial,sans-serif' }}>
      <h1 style={{ color: '#1B3A5C', margin: '0 0 4px', fontSize: 24 }}>Schepen wereldwijd</h1>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 14px' }}>
        Alle PO&apos;s met een live positie via VesselFinder. Zoek op SKU, PO, leverancier of containernummer.
      </p>
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Zoek op SKU, PO, leverancier of container…"
        style={{ width: '100%', maxWidth: 560, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 10 }}
      />
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>
        {loading ? 'Laden…' : `${vessels.length} schip(en) getoond${q.trim() ? ' (gefilterd)' : ''}`}
      </div>
      <VesselMap vessels={vessels} height={580} />
      {!loading && rows.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 13, marginTop: 12 }}>
          Nog geen schepen met een live positie. Haal in Order Flow een ETA op via VesselFinder — zodra er posities binnenkomen, verschijnen de schepen hier.
        </div>
      )}
    </div>
  );
}