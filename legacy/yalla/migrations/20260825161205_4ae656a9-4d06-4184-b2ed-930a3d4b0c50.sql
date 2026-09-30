alter table public.rec_import_runs
  add column if not exists locked_until timestamptz,
  add column if not exists paused_reason text;

create table if not exists public.rec_import_job_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rec_import_runs(id) on delete cascade,
  step_no int not null,
  step_key text not null,
  label text not null,
  handler text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  next_attempt_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_key)
);
create index if not exists idx_rec_import_job_steps_run on public.rec_import_job_steps(run_id, step_no);
create index if not exists idx_rec_import_job_steps_pending on public.rec_import_job_steps(status, next_attempt_at) where status in ('pending','failed');

grant select, insert, update on public.rec_import_job_steps to authenticated;
grant all on public.rec_import_job_steps to service_role;

alter table public.rec_import_job_steps enable row level security;

create policy "rec staff read import steps" on public.rec_import_job_steps
  for select to authenticated using (rec_can_read());
create policy "rec staff insert import steps" on public.rec_import_job_steps
  for insert to authenticated with check (rec_can_write());
create policy "rec staff update import steps" on public.rec_import_job_steps
  for update to authenticated using (rec_can_write()) with check (rec_can_write());

create or replace function public.rec_import_step_touch()
returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists trg_rec_import_job_steps_touch on public.rec_import_job_steps;
create trigger trg_rec_import_job_steps_touch
  before update on public.rec_import_job_steps
  for each row execute function public.rec_import_step_touch();

alter table public.rec_candidates
  add column if not exists enrichment_verified_at timestamptz;

create table if not exists public.rec_enrichment_audit (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  candidate_id uuid references public.rec_candidates(id) on delete cascade,
  action text not null check (action in ('insert','update')),
  changes jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  actor_label text,
  source text not null default 'app',
  run_id uuid references public.rec_import_runs(id) on delete set null,
  step_key text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rec_enrichment_audit_candidate on public.rec_enrichment_audit(candidate_id, created_at desc);
create index if not exists idx_rec_enrichment_audit_run on public.rec_enrichment_audit(run_id) where run_id is not null;

grant select on public.rec_enrichment_audit to authenticated;
grant all on public.rec_enrichment_audit to service_role;

alter table public.rec_enrichment_audit enable row level security;

create policy "rec staff read enrichment audit" on public.rec_enrichment_audit
  for select to authenticated using (rec_can_read());

create or replace function public.rec_enrichment_audit_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
  v_candidate uuid;
  v_actor uuid := auth.uid();
  v_source text := nullif(current_setting('rec.import_source', true), '');
begin
  if TG_OP not in ('INSERT','UPDATE') then
    return null;
  end if;

  -- Service-role writers (import worker, governed seeds) record their own
  -- audit rows with run/step linkage; skip the generic row to avoid doubles
  -- unless an explicit source context was set for the transaction.
  if v_actor is null and v_source is null then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val)), '{}'::jsonb)
      into v_changes
      from (
        select n.key, o.value as old_val, n.value as new_val
          from jsonb_each(to_jsonb(NEW)) n
          join jsonb_each(to_jsonb(OLD)) o using (key)
         where n.value is distinct from o.value
           and n.key <> 'updated_at'
      ) d;
    if v_changes = '{}'::jsonb then
      return NEW;
    end if;
  else
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_changes
      from jsonb_each(to_jsonb(NEW))
     where key not in ('id','created_at','updated_at') and value is not null;
  end if;

  v_candidate := case TG_TABLE_NAME when 'rec_candidates' then NEW.id else NEW.candidate_id end;

  insert into public.rec_enrichment_audit
    (table_name, record_id, candidate_id, action, changes, actor_user_id, actor_label, source, run_id, step_key)
  values
    (TG_TABLE_NAME, NEW.id, v_candidate, lower(TG_OP), v_changes, v_actor,
     nullif(current_setting('rec.actor_label', true), ''),
     coalesce(v_source, 'app'),
     nullif(current_setting('rec.import_run_id', true), '')::uuid,
     nullif(current_setting('rec.import_step_key', true), ''));
  return NEW;
end $$;

drop trigger if exists trg_rec_enrichment_audit on public.rec_candidates;
create trigger trg_rec_enrichment_audit
  after insert or update on public.rec_candidates
  for each row execute function public.rec_enrichment_audit_trg();

drop trigger if exists trg_rec_enrichment_audit on public.rec_applications;
create trigger trg_rec_enrichment_audit
  after insert or update on public.rec_applications
  for each row execute function public.rec_enrichment_audit_trg();

drop trigger if exists trg_rec_enrichment_audit on public.rec_candidate_experience;
create trigger trg_rec_enrichment_audit
  after insert or update on public.rec_candidate_experience
  for each row execute function public.rec_enrichment_audit_trg();

drop trigger if exists trg_rec_enrichment_audit on public.rec_candidate_qualifications;
create trigger trg_rec_enrichment_audit
  after insert or update on public.rec_candidate_qualifications
  for each row execute function public.rec_enrichment_audit_trg();

drop trigger if exists trg_rec_enrichment_audit on public.rec_candidate_skills;
create trigger trg_rec_enrichment_audit
  after insert or update on public.rec_candidate_skills
  for each row execute function public.rec_enrichment_audit_trg();

create or replace view public.rec_candidate_enrichment_status
with (security_invoker = on) as
select
  c.id as candidate_id,
  c.candidate_no,
  c.full_name,
  (nullif(c.email, '') is not null) as has_email,
  (nullif(c.phone, '') is not null) as has_phone,
  (nullif(c.headline, '') is not null) as has_headline,
  (nullif(c.summary, '') is not null) as has_summary,
  (nullif(c.location, '') is not null) as has_location,
  (c.years_experience is not null) as has_experience_years,
  (nullif(c.current_employer, '') is not null) as has_current_employer,
  (select count(*)::int from public.rec_candidate_experience e where e.candidate_id = c.id) as experience_count,
  (select count(*)::int from public.rec_candidate_skills s where s.candidate_id = c.id) as skills_count,
  (select count(*)::int from public.rec_candidate_qualifications q where q.candidate_id = c.id) as qualifications_count,
  exists(select 1 from public.rec_applications a where a.candidate_id = c.id and nullif(a.cover_letter, '') is not null) as has_cover_letter,
  c.enrichment_verified_at,
  c.updated_at as profile_updated_at,
  (select max(au.created_at) from public.rec_enrichment_audit au where au.candidate_id = c.id) as last_enriched_at,
  (select count(*)::int from public.rec_enrichment_audit au where au.candidate_id = c.id) as audit_events
from public.rec_candidates c;

grant select on public.rec_candidate_enrichment_status to authenticated;

create or replace function public.rec_import_resume_plan(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_run public.rec_import_runs%rowtype;
  v_steps jsonb;
  v_next text;
begin
  if not rec_can_read() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_run from public.rec_import_runs where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.step_no), '[]'::jsonb)
    into v_steps
    from public.rec_import_job_steps s
   where s.run_id = p_run_id;
  select s.step_key into v_next
    from public.rec_import_job_steps s
   where s.run_id = p_run_id
     and s.status in ('pending','failed')
     and s.attempts < s.max_attempts
   order by s.step_no
   limit 1;
  return jsonb_build_object(
    'run', to_jsonb(v_run),
    'steps', v_steps,
    'next_step_key', v_next,
    'resumable', v_next is not null and v_run.paused_reason is null,
    'counts', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'pending', count(*) filter (where status = 'pending'),
        'failed', count(*) filter (where status = 'failed'),
        'running', count(*) filter (where status = 'running'),
        'skipped', count(*) filter (where status = 'skipped'))
        from public.rec_import_job_steps where run_id = p_run_id)
  );
end $$;

create or replace function public.rec_import_retry_failed(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reset int;
begin
  if not rec_can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.rec_import_job_steps
     set status = 'pending', next_attempt_at = now(), last_error = null
   where run_id = p_run_id
     and status = 'failed'
     and attempts < max_attempts;
  get diagnostics v_reset = row_count;
  update public.rec_import_runs
     set paused_reason = null, locked_until = null,
         status = case when completed_at is null then 'running' else status end,
         updated_at = now()
   where id = p_run_id;
  return jsonb_build_object('ok', true, 'steps_reset', v_reset);
end $$;

create or replace function public.rec_enrichment_mark_verified(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if not rec_can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform set_config('rec.import_source', 'manual_verification', true);
  perform set_config('rec.actor_label', coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'Recruitment staff'), true);
  update public.rec_candidates
     set enrichment_verified_at = v_now
   where id = p_candidate_id;
  if not found then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'candidate_id', p_candidate_id, 'verified_at', v_now);
end $$;

revoke execute on function public.rec_import_resume_plan(uuid) from anon, public;
revoke execute on function public.rec_import_retry_failed(uuid) from anon, public;
revoke execute on function public.rec_enrichment_mark_verified(uuid) from anon, public;
grant execute on function public.rec_import_resume_plan(uuid) to authenticated;
grant execute on function public.rec_import_retry_failed(uuid) to authenticated;
grant execute on function public.rec_enrichment_mark_verified(uuid) to authenticated;