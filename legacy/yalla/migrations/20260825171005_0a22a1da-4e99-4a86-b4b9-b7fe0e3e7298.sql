create table public.rec_import_worker_config (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.rec_import_worker_config to service_role;

alter table public.rec_import_worker_config enable row level security;