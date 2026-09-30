-- Security Control Plane: append-only control evidence register.
-- A control's status is only ever asserted by an inserted evidence row.
create table if not exists public.security_control_evidence (
  id uuid primary key default gen_random_uuid(),
  control_id text not null,
  status text not null check (status in ('VERIFIED','FAILED','BLOCKED','UNVERIFIED','NOT_APPLICABLE')),
  reason text,
  evidence text,
  asset_ids text[] not null default '{}',
  observed_at timestamptz not null default now(),
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

grant select on public.security_control_evidence to authenticated;
grant all on public.security_control_evidence to service_role;

alter table public.security_control_evidence enable row level security;

drop policy if exists sce_read on public.security_control_evidence;
create policy sce_read on public.security_control_evidence
  for select to authenticated
  using (public.has_staff_permission('staff.security.read'));

drop policy if exists sce_insert on public.security_control_evidence;
create policy sce_insert on public.security_control_evidence
  for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Append-only: no update, no delete policy exists, and the trigger refuses even
-- a privileged attempt so the register can never be rewritten.
create or replace function public.security_control_evidence_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'security_control_evidence is append-only';
end;
$$;

drop trigger if exists sce_no_mutation on public.security_control_evidence;
create trigger sce_no_mutation
  before update or delete on public.security_control_evidence
  for each row execute function public.security_control_evidence_append_only();

create index if not exists sce_control_observed_idx
  on public.security_control_evidence (control_id, observed_at desc);

-- Latest evidence row per control, which is what the posture engine reads.
create or replace view public.v_security_control_evidence_current
with (security_invoker = true) as
select distinct on (control_id)
  control_id, status, reason, evidence, asset_ids, observed_at
from public.security_control_evidence
order by control_id, observed_at desc;

grant select on public.v_security_control_evidence_current to authenticated;
grant select on public.v_security_control_evidence_current to service_role;