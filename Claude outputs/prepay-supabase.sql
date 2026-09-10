-- ============================================================
-- Eagle Bridge — vooruitbetalingen Keukendepot
-- Tabellen voor batches, regels en voortgang.
-- Uitvoeren in de Supabase SQL Editor, stap voor stap.
-- ============================================================

-- STAP 1: batches
create table if not exists public.eagle_prepay_batches (
  id              uuid primary key default gen_random_uuid(),
  batch_id        text not null unique,
  token           text not null,
  entiteit        text not null,
  entiteit_naam   text,
  store           text not null,                 -- '1' (Curaçao) of 'B' (Bonaire)
  voucher_date    text not null,                 -- mm/dd/jj zoals in Eagle
  boekdatum       date,
  bestand         text,
  koers_norm      numeric,
  aantal_regels   integer not null default 0,
  aantal_handmatig integer not null default 0,
  totaal_xcg      numeric not null default 0,
  payload         jsonb not null,                -- het volledige .eaglebatch
  status          text not null default 'klaar', -- klaar | bezig | afgerond | gestopt
  laatste_bericht text,
  eagle_store     text,
  eagle_user      text,
  machine         text,
  bridge_versie   text,
  geboekt         integer not null default 0,
  overgeslagen    integer not null default 0,
  fout            integer not null default 0,
  created_by      text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now()
);

-- STAP 2: regels
create table if not exists public.eagle_prepay_rows (
  id              bigserial primary key,
  batch_uuid      uuid not null references public.eagle_prepay_batches(id) on delete cascade,
  rij             integer not null,
  dedupe_key      text,
  vendor          text,
  vendor_ref_no   text,
  invoice_amount  numeric,
  voucher_ref     text,
  status          text not null default 'wachten', -- wachten | bezig | geboekt | overgeslagen | gestopt | geboekt_handmatig
  stap            text,                             -- laatste stap (bijv. 'vendor', 'Add F4', 'distributie')
  voucher         text,
  reden           text,
  updated_at      timestamptz not null default now(),
  unique (batch_uuid, rij)
);

-- STAP 3: gebeurtenissen (elke logregel van de Bridge)
create table if not exists public.eagle_prepay_events (
  id              bigserial primary key,
  batch_uuid      uuid not null references public.eagle_prepay_batches(id) on delete cascade,
  rij             integer,
  tijd            timestamptz not null default now(),
  niveau          text not null default 'INFO',
  bericht         text not null
);

create index if not exists eagle_prepay_events_batch_idx on public.eagle_prepay_events (batch_uuid, id);
create index if not exists eagle_prepay_rows_batch_idx   on public.eagle_prepay_rows (batch_uuid, rij);
create index if not exists eagle_prepay_batches_created_idx on public.eagle_prepay_batches (created_at desc);

-- STAP 4: beveiliging — ingelogde dashboardgebruikers mogen lezen,
-- schrijven gebeurt uitsluitend via de API (service role).
alter table public.eagle_prepay_batches enable row level security;
alter table public.eagle_prepay_rows    enable row level security;
alter table public.eagle_prepay_events  enable row level security;

drop policy if exists "prepay batches lezen" on public.eagle_prepay_batches;
create policy "prepay batches lezen" on public.eagle_prepay_batches
  for select to authenticated using (true);

drop policy if exists "prepay rows lezen" on public.eagle_prepay_rows;
create policy "prepay rows lezen" on public.eagle_prepay_rows
  for select to authenticated using (true);

drop policy if exists "prepay events lezen" on public.eagle_prepay_events;
create policy "prepay events lezen" on public.eagle_prepay_events
  for select to authenticated using (true);

-- STAP 5: controle
select 'batches' as tabel, count(*) from public.eagle_prepay_batches
union all select 'rows', count(*) from public.eagle_prepay_rows
union all select 'events', count(*) from public.eagle_prepay_events;
