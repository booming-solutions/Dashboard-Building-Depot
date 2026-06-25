// =============================================================================
// Marketing › Website foto-status scraper  (v1)
// Plaats als:  src/app/api/marketing/scan-website/route.js
//
// Wat het doet:
//   - Loopt de top-level web-departments van Building Depot Curaçao af
//   - Haalt per department alle producten op via de EZ-AD storefront-API
//     (exact dezelfde request als de browser, inclusief scope-headers)
//   - Leest `has_image` rechtstreeks uit de API (betrouwbaar, geen giswerk)
//   - Parseert de Compass-dept-code uit `dept_name` ("41 BARBEQUE-COOLERS" -> "41")
//   - Schrijft alles naar Supabase-tabel `website_photo_status` (upsert op sku+region)
//
// Aanroepen:
//   /api/marketing/scan-website?dept_id=10404681&dry=1   -> test één categorie, niets schrijven
//   /api/marketing/scan-website?dept_id=10404681          -> test één categorie, wél schrijven
//   /api/marketing/scan-website                           -> volledige run (alle departments)
//   /api/marketing/scan-website?from=0&count=5            -> chunk: departments 0..4 (voor cron/batching)
// =============================================================================

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro

// ---- Supabase (service role: omzeilt RLS voor server-side writes) ------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---- EZ-AD storefront scope (Building Depot Curaçao) ------------------------
// Publieke storefront-sleutels (browser stuurt ze met ACAO:*), in env voor netheid.
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
// De parent-department geeft alle producten van z'n sub-departments terug.
// (Klopt de telling in de testrun niet, dan schakelen we over op sub-dept-IDs.)
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

const PAGE_LIMIT = 100;          // producten per pagina
const MAX_PAGES_PER_DEPT = 200;  // veiligheidsrem
const SORT = 'manufacturer-no';

// Product-URL-patroon — TODO: bevestigen door op de site één product te openen
// en de URL te checken. Pas zo nodig aan.
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

// "41 BARBEQUE-COOLERS" -> "41"  (leading zeros zoals afgesproken)
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const testDept = searchParams.get('dept_id');           // één categorie testen
  const dryRun = searchParams.get('dry') === '1';         // niets schrijven
  const from = Number.parseInt(searchParams.get('from') || '0', 10);
  const count = searchParams.get('count')
    ? Number.parseInt(searchParams.get('count'), 10)
    : null;

  if (!EZAD.businessSlug || !EZAD.auth || !EZAD.storeId) {
    return Response.json(
      { error: 'Ontbrekende env-vars: EZAD_BUSINESS_SLUG, EZAD_AUTH, EZAD_STORE_ID' },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: 'Ontbrekende Supabase env-vars (URL of SERVICE_ROLE_KEY)' },
      { status: 500 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const deptList = testDept
    ? [Number(testDept)]
    : DEPARTMENTS.slice(from, count ? from + count : undefined);

  const seen = new Map(); // sku -> row  (dedupe over departments heen)
  const perDept = [];

  for (const deptId of deptList) {
    let page = 1;
    let deptCount = 0;
    let lastPage = 1;
    try {
      while (page <= MAX_PAGES_PER_DEPT) {
        const json = await fetchDeptPage(deptId, page);
        const rows = json?.data?.data || [];
        lastPage = json?.data?.last_page || page;
        for (const p of rows) {
          if (!p?.sku) continue;
          seen.set(String(p.sku), mapProduct(p));
          deptCount++;
        }
        if (rows.length === 0 || page >= lastPage) break;
        page++;
      }
      perDept.push({ deptId, products: deptCount, pages: page });
    } catch (e) {
      perDept.push({ deptId, error: String(e?.message || e), pageReached: page });
    }
  }

  const rows = Array.from(seen.values());

  let written = 0;
  if (!dryRun && rows.length) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('website_photo_status')
        .upsert(slice, { onConflict: 'sku,region' });
      if (error) {
        return Response.json({ error: error.message, written, perDept }, { status: 500 });
      }
      written += slice.length;
    }
  }

  const withImg = rows.filter((r) => r.has_image).length;
  return Response.json({
    region: REGION,
    departments_scanned: deptList.length,
    unique_skus: rows.length,
    with_photo: withImg,
    without_photo: rows.length - withImg,
    coverage_pct: rows.length ? Math.round((withImg / rows.length) * 1000) / 10 : null,
    written: dryRun ? 0 : written,
    dry_run: dryRun,
    perDept,
    sample: rows.slice(0, 3), // handig om de mapping te controleren
  });
}
