-- CalasOrga V15.47 — stockage Supabase privé
-- À exécuter une seule fois dans Supabase > SQL Editor.

create table if not exists public.calasorga_state (
  id text primary key,
  version bigint not null check (version >= 1),
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.calasorga_state enable row level security;

-- Aucune lecture/écriture depuis le navigateur Supabase.
revoke all on table public.calasorga_state from anon, authenticated;

-- Le backend Vercel utilise uniquement la clé secrète/service_role.
grant select, insert, update, delete on table public.calasorga_state to service_role;

comment on table public.calasorga_state is 'État privé Planning Bridge / CalasOrga. Accès backend uniquement.';
