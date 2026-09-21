-- ============================================================
-- Booming — BDMM-facturen: één kolom erbij op de bestaande
-- batchtabel, zodat Keukendepot en BDMM samen in Historie en
-- Boekingscheck staan. Uitvoeren in de Supabase SQL Editor.
-- ============================================================

-- STAP 1: soort per batch (bestaande batches zijn Keukendepot)
alter table public.eagle_prepay_batches
  add column if not exists soort text not null default 'keukendepot';

-- STAP 2: index voor filteren op soort
create index if not exists eagle_prepay_batches_soort_idx
  on public.eagle_prepay_batches (soort, created_at desc);

-- STAP 3: controle
select soort, count(*) from public.eagle_prepay_batches group by soort;
