// =============================================================================
// Marketing › Website foto-status scraper  (v2)
// Plaats als:  src/app/api/marketing/scan-website/route.js
//
// Modi:
//   /api/marketing/scan-website?dept_id=10404681&dry=1  -> test 1 categorie, niets schrijven
//   /api/marketing/scan-website?dept_index=0            -> scan 1 department (op index), schrijft incrementeel
//   /api/marketing/scan-website?snapshot=1              -> schrijf week-snapshot uit huidige data
//   /api/marketing/scan-website                         -> volledige run (alle departments) + snapshot  [cron]
//
// De pagina ("Scan nu") loopt dept_index 0..N en sluit af met snapshot=1
// (korte requests, live voortgang). De wekelijkse cron gebruikt de volledige run.
// =============================================================================

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro (Fluid Compute)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EZAD = {
  base:         process.env.EZAD_API_BASE     || 'https://api.ezadlive.com',
  businessSlug: process.env.EZAD_BUSINESS_SLUG,
  auth:         process.env.EZAD_AUTH,
  storeId:      process.env.EZAD_STORE_ID,
  origin:       process.env.EZAD_ORIGIN       || 'https://building-depot.com',
  referer:      process.env.EZAD_REFERER      || 'https://building-depot.com/',
};

const REGION = 'CUR';

// Top-level web-department-IDs (Building Depot Curaçao).
const DEPARTMENTS = [
  10404578, // appliances
  10404365, // building
  10404525, // flooring
  10404924, // furniture
  10404518, // hardware
  10404877, // household
  10404567, // kitchen
  10404679, // living
  10404464, // paint
  10404542, // sanitary ware
];

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_DEPT = 200;
const SORT = 'manufacturer-no';

const productUrl = (slug) => (slug ? `https://building-depot.com/product/${slug}` : null);

function ezadHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'business-slug': EZAD.businessSlug,
    'ez-auth': EZAD.auth,
    'store-id': String(EZAD.storeId),
    origin: EZAD.origin,
    referer: EZAD.referer,
  };
}

async function fetchDeptPage(deptId, page) {
  const url =
    `${EZAD.base}/products?search=%27%27&dept_id=${deptId}` +
    `&page=${page}&sort=${SORT}&limit=${PAGE_LIMIT}`;
  const res = await fetch(url, { headers: ezadHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`EZ-AD ${res.status} (dept ${deptId}, page ${page})`);
  return res.json();
}

function parseDeptCode(deptName) {
  if (!deptName) return null;
  const m = String(deptName).match(/^\s*(\d{1,3})\b/);
  return m ? m[1].padStart(2, '0') : null;
}

function mapProduct(p) {
  return {
    sku: p.sku,
    region: REGION,
    title: p.title ?? null,
    dept_id_web: p.dept_id ?? null,
    dept_code: parseDeptCode(p.dept_name),
    dept_name: p.dept_name ?? null,
    has_image: !!p.has_image,
    image_url: p.image_url ?? null,
    slug: p.slug ?? null,
    product_url: productUrl(p.slug),
    brand_name: p.brand_name || null,
    num_inventory:
      typeof p.num_inventory === 'number'
        ? p.num_inventory
        : Number.parseInt(p.num_inventory, 10) || null,
    price: p.price != null && p.price !== '' ? Number(p.price) : null,
    last_checked: new Date().toISOString(),
  };
}

// Haal alle producten van 1 department op (geen schrijfactie), dedupe op sku.
async function collectDept(deptId) {
  let page = 1;
  let lastPage = 1;
  const seen = new Map();
  while (page <= MAX_PAGES_PER_DEPT) {
    const json = await fetchDeptPage(deptId, page);
    const rows = json?.data?.data || [];
    lastPage = json?.data?.last_page || page;
    for (const p of rows) {
      if (p?.sku) seen.set(String(p.sku), mapProduct(p));
    }
    if (rows.length === 0 || page >= lastPage) break;
    page++;
  }
  return Array.from(seen.values());
}

async function upsertRows(supabase, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('website_photo_status')
      .upsert(rows.slice(i, i + 500), { onConflict: 'sku,region' });
    if (error) throw new Error(error.message);
  }
}

// Schrijf een week-snapshot uit de huidige aggregatie.
async function writeSnapshot(supabase) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from('website_photo_summary').select('*').eq('region', REGION);
  const rows = (data || []).map((r) => ({
    snapshot_date: today,
    region: REGION,
    dept_code: r.dept_code,
    dept_name: r.dept_name,
    total_skus: r.total_skus,
    with_photo: r.with_photo,
    without_photo: r.without_photo,
  }));
  if (rows.length) {
    const { error } = await supabase
      .from('website_photo_history')
      .upsert(rows, { onConflict: 'snapshot_date,region,dept_code' });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dry = searchParams.get('dry') === '1';
  const testDept = searchParams.get('dept_id');
  const deptIndexParam = searchParams.get('dept_index');
  const snapshotOnly = searchParams.get('snapshot') === '1';

  if (!EZAD.businessSlug || !EZAD.auth || !EZAD.storeId) {
    return Response.json({ error: 'Ontbrekende env-vars: EZAD_BUSINESS_SLUG, EZAD_AUTH, EZAD_STORE_ID' }, { status: 500 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Ontbrekende Supabase env-vars (URL of SERVICE_ROLE_KEY)' }, { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // --- Alleen snapshot ---
    if (snapshotOnly) {
      const n = await writeSnapshot(supabase);
      return Response.json({ snapshot: true, rows: n });
    }

    // --- Test 1 categorie ---
    if (testDept) {
      const rows = await collectDept(Number(testDept));
      const withImg = rows.filter((r) => r.has_image).length;
      if (!dry) await upsertRows(supabase, rows);
      return Response.json({
        dept_id: Number(testDept),
        unique_skus: rows.length,
        with_photo: withImg,
        without_photo: rows.length - withImg,
        written: dry ? 0 : rows.length,
        dry,
        sample: rows.slice(0, 3),
      });
    }

    // --- 1 department op index (client-gestuurde voortgang) ---
    if (deptIndexParam != null) {
      const idx = Number(deptIndexParam);
      const deptId = DEPARTMENTS[idx];
      if (deptId == null) return Response.json({ error: 'index buiten bereik' }, { status: 400 });
      const rows = await collectDept(deptId);
      await upsertRows(supabase, rows);
      const next = idx + 1 < DEPARTMENTS.length ? idx + 1 : null;
      return Response.json({
        index: idx,
        dept_id: deptId,
        products: rows.length,
        total_depts: DEPARTMENTS.length,
        next_index: next,
      });
    }

    // --- Volledige run (cron) ---
    let total = 0;
    const perDept = [];
    for (const deptId of DEPARTMENTS) {
      try {
        const rows = await collectDept(deptId);
        await upsertRows(supabase, rows);
        total += rows.length;
        perDept.push({ deptId, products: rows.length });
      } catch (e) {
        perDept.push({ deptId, error: String(e?.message || e) });
      }
    }
    const snap = await writeSnapshot(supabase);
    return Response.json({ region: REGION, total_upserted: total, snapshot_rows: snap, perDept });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
