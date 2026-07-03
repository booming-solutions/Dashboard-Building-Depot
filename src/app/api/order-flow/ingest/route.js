/* ============================================================
   BESTAND: route.js  (Order Flow — PO ingest)
   KOPIEER NAAR: src/app/api/order-flow/ingest/route.js   (NIEUW/vervangt)

   Ontvangt de dagelijkse Compass-rapporten (via de e-mail-worker naar
   data@boomingsolutions.ai) en zet ze in de juiste tabel. De route
   HERKENT ZELF welk rapport het is aan de kolomnamen:
     - bevat 'Item Number'  -> SKU-regels  -> order_flow_ingest_items
     - anders (PO-header)   -> order_flow  -> order_flow_ingest

   Beveiligd met WORKER_SECRET.
   Body (JSON): { file_base64: "<xlsx base64>" }  of  { rows: [ {..} ] }

   Env-vars (Vercel): WORKER_SECRET, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
   npm: xlsx  (npm install xlsx)
   ============================================================ */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req) {
  const s = process.env.WORKER_SECRET;
  if (!s) return false;
  return req.headers.get('x-worker-secret') === s || req.headers.get('authorization') === `Bearer ${s}`;
}

function toISO(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(/,/g, '')));
const pick = (o, ...keys) => { for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; } return null; };

function mapHeader(o) {
  return {
    po_number: String(pick(o, 'PO Header', 'PO Number', 'po_number') || '').trim(),
    vendor_code: pick(o, 'Vendor Code'),
    vendor_name: pick(o, 'Vendor Name'),
    dept: pick(o, 'Group items', 'Merchandise Type'),
    order_store: pick(o, 'Store Number', 'St'),
    po_created_date: toISO(pick(o, 'Creation Date', 'Date Created')),
    eta: toISO(pick(o, 'Date Expected')),
    po_status: pick(o, 'P.O. Status', 'PO Status'),
    buyer_id: pick(o, 'Buyers ID'),
    total_cost: num(pick(o, 'Total Cost Dollars', 'Total Cost')),
  };
}

function mapItem(o) {
  return {
    po_number: String(pick(o, 'PO Header', 'po_number') || '').trim(),
    item_number: String(pick(o, 'Item Number', 'item_number') || '').trim(),
    item_description: pick(o, 'Item Description'),
    dept_code: pick(o, 'Department Code'),
    dept_name: pick(o, 'Department Name'),
    qoo: num(pick(o, 'Purchase Quantity On Order')),
    avg_cost: num(pick(o, 'Average Cost')),
    order_value: num(pick(o, 'Order Inventory')),
    date_expected: toISO(pick(o, 'Date Expected')),
    po_status: pick(o, 'P.O. Status', 'PO Status'),
  };
}

export async function POST(req) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let raw = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.rows)) {
      raw = body.rows;
    } else if (body?.file_base64) {
      const wb = XLSX.read(Buffer.from(body.file_base64, 'base64'), { type: 'buffer', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      raw = XLSX.utils.sheet_to_json(ws, { defval: null });
    } else {
      return NextResponse.json({ error: 'geen rows of file_base64 in body' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: 'parse-fout: ' + e.message }, { status: 400 });
  }

  if (!raw.length) return NextResponse.json({ error: 'leeg bestand' }, { status: 422 });

  // Herken het rapporttype aan de kolomnamen van de eerste rij
  const keys = Object.keys(raw[0] || {});
  const isItems = keys.includes('Item Number') || keys.includes('item_number');

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  if (isItems) {
    const rows = raw.map(mapItem).filter((r) => r.po_number && r.item_number);
    if (!rows.length) return NextResponse.json({ error: 'geen geldige SKU-regels' }, { status: 422 });
    const { data, error } = await admin.rpc('order_flow_ingest_items', { p: rows });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, type: 'items', received: rows.length, upserted: data });
  } else {
    const rows = raw.map(mapHeader).filter((r) => r.po_number);
    if (!rows.length) return NextResponse.json({ error: 'geen geldige PO-regels' }, { status: 422 });
    const { data, error } = await admin.rpc('order_flow_ingest', { p: rows });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, type: 'header', received: rows.length, upserted: data });
  }
}
