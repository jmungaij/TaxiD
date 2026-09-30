
-- ============ tracks ============
insert into public.intern_tracks (programme_id, code, name, focus, sequence, performance_weights, kpis)
select p.id, v.code, v.name, v.focus, v.seq, v.weights::jsonb, v.kpis::jsonb
from public.intern_programmes p,
(values
 ('DEST_SUPPLY','Destinations Management & Mobility Supply','Destination intelligence, mobility demand mapping and supply activation',20,
  '{"learning":15,"productivity":20,"supply_development":25,"quality":15,"commercial":15,"conduct":10}',
  '[{"kpi":"Destination profiles completed","evidence_source":"intern_supply_destinations"},{"kpi":"Mobility opportunities identified","evidence_source":"intern_supply_opportunities"}]'),
 ('DRIVER_FLEET','Driver & Fleet Management','Driver acquisition, qualification, fleet supplier development and vehicle mapping',21,
  '{"learning":15,"productivity":20,"supply_development":25,"quality":15,"commercial":15,"conduct":10}',
  '[{"kpi":"Qualified driver prospects","evidence_source":"intern_supply_driver_prospects"},{"kpi":"Verified fleet capacity","evidence_source":"intern_supply_fleet_suppliers"}]')
) as v(code,name,focus,seq,weights,kpis)
where p.code = 'YMEITA'
on conflict do nothing;

-- ============ driver prospects ============
create table public.intern_supply_driver_prospects (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  full_name text not null,
  phone text not null,
  phone_norm text generated always as (regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g')) stored,
  location text,
  operating_area text,
  vehicle_category text,
  service_category text,
  availability text,
  stage text not null default 'LEAD'
    check (stage in ('LEAD','CONTACTED','INTERESTED','QUALIFIED','DOCUMENTS_REQUESTED','DOCUMENTS_SUBMITTED','VERIFIED','ONBOARDING','APPROVED','ACTIVATED','PRODUCTIVE','REJECTED')),
  documents_status text not null default 'NOT_PROVIDED' check (documents_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  driver_record_id uuid,
  review_status text not null default 'SUBMITTED' check (review_status in ('SUBMITTED','ACCEPTED','RETURNED','REJECTED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  activated_at timestamptz,
  data_quality_score numeric,
  evidence_url text,
  notes text,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.intern_supply_driver_prospects (intern_id);
create index on public.intern_supply_driver_prospects (cohort_id, stage);
create index on public.intern_supply_driver_prospects (phone_norm);

-- ============ fleet suppliers ============
create table public.intern_supply_fleet_suppliers (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  supplier_name text not null,
  owner_name text,
  contact_phone text,
  contact_phone_norm text generated always as (regexp_replace(coalesce(contact_phone,''), '[^0-9]', '', 'g')) stored,
  fleet_type text,
  location text,
  operating_area text,
  service_category text,
  vehicle_count integer not null default 0 check (vehicle_count >= 0),
  capacity_seats integer,
  availability text,
  documentation_status text not null default 'NOT_PROVIDED' check (documentation_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  insurance_status text not null default 'NOT_PROVIDED' check (insurance_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  inspection_status text not null default 'NOT_PROVIDED' check (inspection_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  driver_availability text,
  commercial_terms text,
  supplier_status text not null default 'LEAD' check (supplier_status in ('LEAD','CONTACTED','QUALIFIED','DOCUMENTS_SUBMITTED','VERIFIED','ONBOARDING','ACTIVATED','REJECTED')),
  activation_status text not null default 'NOT_ACTIVATED' check (activation_status in ('NOT_ACTIVATED','PENDING_ACTIVATION','ACTIVATED')),
  fleet_record_id uuid,
  review_status text not null default 'SUBMITTED' check (review_status in ('SUBMITTED','ACCEPTED','RETURNED','REJECTED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  data_quality_score numeric,
  evidence_url text,
  notes text,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.intern_supply_fleet_suppliers (intern_id);
create index on public.intern_supply_fleet_suppliers (cohort_id, supplier_status);

-- ============ mapped vehicles ============
create table public.intern_supply_vehicles (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  supplier_id uuid references public.intern_supply_fleet_suppliers(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  vehicle_type text not null,
  registration text,
  registration_norm text generated always as (upper(regexp_replace(coalesce(registration,''), '[^A-Za-z0-9]', '', 'g'))) stored,
  capacity integer,
  location text,
  service_category text,
  availability text,
  insurance_status text not null default 'NOT_PROVIDED' check (insurance_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  inspection_status text not null default 'NOT_PROVIDED' check (inspection_status in ('VERIFIED','PENDING','EXPIRED','NOT_PROVIDED','NOT_APPLICABLE')),
  vehicle_record_id uuid,
  review_status text not null default 'SUBMITTED' check (review_status in ('SUBMITTED','ACCEPTED','RETURNED','REJECTED')),
  verified_by uuid,
  verified_at timestamptz,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.intern_supply_vehicles (intern_id);
create index on public.intern_supply_vehicles (registration_norm);

-- ============ destination profiles ============
create table public.intern_supply_destinations (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  destination_name text not null,
  destination_type text not null,
  location text,
  customer_segments text[] not null default '{}',
  demand_status text not null default 'UNVERIFIED' check (demand_status in ('UNVERIFIED','INDICATIVE','VERIFIED')),
  demand_hypothesis text,
  demand_evidence text,
  mobility_requirements text,
  vehicle_categories text[] not null default '{}',
  driver_requirements text,
  fleet_requirements text,
  yalla_products text[] not null default '{}',
  supplier_pipeline text,
  activation_strategy text,
  operational_risks text,
  completeness numeric not null default 0 check (completeness between 0 and 100),
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','ACCEPTED','RETURNED','COMPLETE')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  evidence_url text,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.intern_supply_destinations (intern_id);
create index on public.intern_supply_destinations (cohort_id, status);

-- ============ mobility opportunities ============
create table public.intern_supply_opportunities (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  destination_id uuid references public.intern_supply_destinations(id) on delete set null,
  supplier_id uuid references public.intern_supply_fleet_suppliers(id) on delete set null,
  title text not null,
  product_line text not null,
  customer_segment text,
  requirement text,
  stage text not null default 'LEAD'
    check (stage in ('LEAD','QUALIFIED','OPPORTUNITY','CUSTOMER','BOOKING','COMPLETED_SERVICE','VERIFIED_REVENUE','LOST')),
  estimated_value_kes numeric,
  verified_revenue_kes numeric not null default 0 check (verified_revenue_kes >= 0),
  verified_source_table text,
  verified_source_id uuid,
  verified_by uuid,
  verified_at timestamptz,
  review_status text not null default 'SUBMITTED' check (review_status in ('SUBMITTED','ACCEPTED','RETURNED','REJECTED')),
  evidence_url text,
  notes text,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intern_supply_opp_revenue_evidence
    check (verified_revenue_kes = 0 or (verified_source_table is not null and verified_source_id is not null and verified_by is not null))
);
create index on public.intern_supply_opportunities (intern_id);
create index on public.intern_supply_opportunities (cohort_id, stage);

-- ============ field assignments ============
create table public.intern_supply_field_assignments (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references public.intern_profiles(id) on delete cascade,
  cohort_id uuid references public.intern_cohorts(id) on delete set null,
  assignment text not null,
  location text not null,
  scheduled_for date not null,
  objective text,
  contacts_made integer not null default 0 check (contacts_made >= 0),
  records_created integer not null default 0 check (records_created >= 0),
  outcomes text,
  follow_up text,
  evidence_url text,
  supervisor_verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  is_demo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.intern_supply_field_assignments (intern_id);

-- ============ grants ============
grant select, insert, update on public.intern_supply_driver_prospects to authenticated;
grant select, insert, update on public.intern_supply_fleet_suppliers to authenticated;
grant select, insert, update on public.intern_supply_vehicles to authenticated;
grant select, insert, update on public.intern_supply_destinations to authenticated;
grant select, insert, update on public.intern_supply_opportunities to authenticated;
grant select, insert, update on public.intern_supply_field_assignments to authenticated;
grant all on public.intern_supply_driver_prospects to service_role;
grant all on public.intern_supply_fleet_suppliers to service_role;
grant all on public.intern_supply_vehicles to service_role;
grant all on public.intern_supply_destinations to service_role;
grant all on public.intern_supply_opportunities to service_role;
grant all on public.intern_supply_field_assignments to service_role;

alter table public.intern_supply_driver_prospects enable row level security;
alter table public.intern_supply_fleet_suppliers enable row level security;
alter table public.intern_supply_vehicles enable row level security;
alter table public.intern_supply_destinations enable row level security;
alter table public.intern_supply_opportunities enable row level security;
alter table public.intern_supply_field_assignments enable row level security;

-- read: anyone entitled to see the intern (self, supervisor, mentor, authority)
create policy supply_prospects_read on public.intern_supply_driver_prospects for select to authenticated using (public.intern_can_view(intern_id));
create policy supply_suppliers_read on public.intern_supply_fleet_suppliers for select to authenticated using (public.intern_can_view(intern_id));
create policy supply_vehicles_read on public.intern_supply_vehicles for select to authenticated using (public.intern_can_view(intern_id));
create policy supply_dest_read on public.intern_supply_destinations for select to authenticated using (public.intern_can_view(intern_id));
create policy supply_opps_read on public.intern_supply_opportunities for select to authenticated using (public.intern_can_view(intern_id));
create policy supply_field_read on public.intern_supply_field_assignments for select to authenticated using (public.intern_can_view(intern_id));

-- interns may capture their own supply records
create policy supply_prospects_self_insert on public.intern_supply_driver_prospects for insert to authenticated with check (public.intern_is_self(intern_id));
create policy supply_suppliers_self_insert on public.intern_supply_fleet_suppliers for insert to authenticated with check (public.intern_is_self(intern_id));
create policy supply_vehicles_self_insert on public.intern_supply_vehicles for insert to authenticated with check (public.intern_is_self(intern_id));
create policy supply_dest_self_insert on public.intern_supply_destinations for insert to authenticated with check (public.intern_is_self(intern_id));
create policy supply_opps_self_insert on public.intern_supply_opportunities for insert to authenticated with check (public.intern_is_self(intern_id));
create policy supply_field_self_insert on public.intern_supply_field_assignments for insert to authenticated with check (public.intern_is_self(intern_id));

create policy supply_prospects_self_update on public.intern_supply_driver_prospects for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));
create policy supply_suppliers_self_update on public.intern_supply_fleet_suppliers for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));
create policy supply_vehicles_self_update on public.intern_supply_vehicles for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));
create policy supply_dest_self_update on public.intern_supply_destinations for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));
create policy supply_opps_self_update on public.intern_supply_opportunities for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));
create policy supply_field_self_update on public.intern_supply_field_assignments for update to authenticated using (public.intern_is_self(intern_id)) with check (public.intern_is_self(intern_id));

-- supervisors / programme authority manage everything they can see (but not their own intern row)
create policy supply_prospects_manage on public.intern_supply_driver_prospects for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));
create policy supply_suppliers_manage on public.intern_supply_fleet_suppliers for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));
create policy supply_vehicles_manage on public.intern_supply_vehicles for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));
create policy supply_dest_manage on public.intern_supply_destinations for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));
create policy supply_opps_manage on public.intern_supply_opportunities for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));
create policy supply_field_manage on public.intern_supply_field_assignments for all to authenticated using (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id)) with check (public.intern_can_view(intern_id) and not public.intern_is_self(intern_id));

-- ============ self-service guard: interns can never verify, activate, approve or declare revenue ============
create or replace function public.intern_supply_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_self boolean;
begin
  if new.intern_id is null then return new; end if;
  v_self := public.intern_is_self(new.intern_id);
  if not v_self or public.intern_programme_authority(auth.uid()) then
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
    return new;
  end if;

  if tg_table_name = 'intern_supply_driver_prospects' then
    if tg_op = 'INSERT' then
      new.stage := least_stage_guard(new.stage);
      new.verified_by := null; new.verified_at := null; new.activated_at := null;
      new.review_status := 'SUBMITTED'; new.reviewed_by := null; new.reviewed_at := null;
      new.documents_status := case when new.documents_status = 'VERIFIED' then 'PENDING' else new.documents_status end;
    else
      new.stage := least_stage_guard(new.stage);
      new.verified_by := old.verified_by; new.verified_at := old.verified_at; new.activated_at := old.activated_at;
      new.review_status := old.review_status; new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
      new.documents_status := case when new.documents_status = 'VERIFIED' and old.documents_status <> 'VERIFIED' then old.documents_status else new.documents_status end;
      new.data_quality_score := old.data_quality_score;
    end if;
  elsif tg_table_name = 'intern_supply_fleet_suppliers' then
    if tg_op = 'INSERT' then
      new.supplier_status := case when new.supplier_status in ('VERIFIED','ONBOARDING','ACTIVATED') then 'QUALIFIED' else new.supplier_status end;
      new.activation_status := 'NOT_ACTIVATED';
      new.documentation_status := case when new.documentation_status = 'VERIFIED' then 'PENDING' else new.documentation_status end;
      new.insurance_status := case when new.insurance_status = 'VERIFIED' then 'PENDING' else new.insurance_status end;
      new.inspection_status := case when new.inspection_status = 'VERIFIED' then 'PENDING' else new.inspection_status end;
      new.verified_by := null; new.verified_at := null; new.review_status := 'SUBMITTED';
    else
      new.supplier_status := case when new.supplier_status in ('VERIFIED','ONBOARDING','ACTIVATED') and old.supplier_status not in ('VERIFIED','ONBOARDING','ACTIVATED') then old.supplier_status else new.supplier_status end;
      new.activation_status := old.activation_status;
      new.documentation_status := case when new.documentation_status = 'VERIFIED' and old.documentation_status <> 'VERIFIED' then old.documentation_status else new.documentation_status end;
      new.insurance_status := case when new.insurance_status = 'VERIFIED' and old.insurance_status <> 'VERIFIED' then old.insurance_status else new.insurance_status end;
      new.inspection_status := case when new.inspection_status = 'VERIFIED' and old.inspection_status <> 'VERIFIED' then old.inspection_status else new.inspection_status end;
      new.verified_by := old.verified_by; new.verified_at := old.verified_at;
      new.review_status := old.review_status; new.data_quality_score := old.data_quality_score;
    end if;
  elsif tg_table_name = 'intern_supply_vehicles' then
    if tg_op = 'INSERT' then
      new.verified_by := null; new.verified_at := null; new.review_status := 'SUBMITTED';
      new.insurance_status := case when new.insurance_status = 'VERIFIED' then 'PENDING' else new.insurance_status end;
      new.inspection_status := case when new.inspection_status = 'VERIFIED' then 'PENDING' else new.inspection_status end;
    else
      new.verified_by := old.verified_by; new.verified_at := old.verified_at; new.review_status := old.review_status;
      new.insurance_status := case when new.insurance_status = 'VERIFIED' and old.insurance_status <> 'VERIFIED' then old.insurance_status else new.insurance_status end;
      new.inspection_status := case when new.inspection_status = 'VERIFIED' and old.inspection_status <> 'VERIFIED' then old.inspection_status else new.inspection_status end;
    end if;
  elsif tg_table_name = 'intern_supply_destinations' then
    if tg_op = 'INSERT' then
      new.status := case when new.status in ('ACCEPTED','COMPLETE') then 'SUBMITTED' else new.status end;
      new.demand_status := case when new.demand_status = 'VERIFIED' then 'UNVERIFIED' else new.demand_status end;
      new.reviewed_by := null; new.reviewed_at := null;
    else
      new.status := case when new.status in ('ACCEPTED','COMPLETE') and old.status not in ('ACCEPTED','COMPLETE') then 'SUBMITTED' else new.status end;
      new.demand_status := case when new.demand_status = 'VERIFIED' and old.demand_status <> 'VERIFIED' then old.demand_status else new.demand_status end;
      new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    end if;
  elsif tg_table_name = 'intern_supply_opportunities' then
    if tg_op = 'INSERT' then
      new.verified_revenue_kes := 0; new.verified_source_table := null; new.verified_source_id := null;
      new.verified_by := null; new.verified_at := null; new.review_status := 'SUBMITTED';
      new.stage := case when new.stage in ('CUSTOMER','BOOKING','COMPLETED_SERVICE','VERIFIED_REVENUE') then 'OPPORTUNITY' else new.stage end;
    else
      new.verified_revenue_kes := old.verified_revenue_kes; new.verified_source_table := old.verified_source_table;
      new.verified_source_id := old.verified_source_id; new.verified_by := old.verified_by; new.verified_at := old.verified_at;
      new.review_status := old.review_status;
      new.stage := case when new.stage in ('CUSTOMER','BOOKING','COMPLETED_SERVICE','VERIFIED_REVENUE') and old.stage not in ('CUSTOMER','BOOKING','COMPLETED_SERVICE','VERIFIED_REVENUE') then old.stage else new.stage end;
    end if;
  elsif tg_table_name = 'intern_supply_field_assignments' then
    if tg_op = 'INSERT' then
      new.supervisor_verified := false; new.verified_by := null; new.verified_at := null;
    else
      new.supervisor_verified := old.supervisor_verified; new.verified_by := old.verified_by; new.verified_at := old.verified_at;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    begin new.updated_at := now(); exception when others then null; end;
  end if;
  return new;
end $$;

create or replace function public.least_stage_guard(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case when p_stage in ('VERIFIED','ONBOARDING','APPROVED','ACTIVATED','PRODUCTIVE') then 'DOCUMENTS_SUBMITTED' else p_stage end
$$;

create trigger guard_prospects before insert or update on public.intern_supply_driver_prospects for each row execute function public.intern_supply_guard();
create trigger guard_suppliers before insert or update on public.intern_supply_fleet_suppliers for each row execute function public.intern_supply_guard();
create trigger guard_vehicles before insert or update on public.intern_supply_vehicles for each row execute function public.intern_supply_guard();
create trigger guard_destinations before insert or update on public.intern_supply_destinations for each row execute function public.intern_supply_guard();
create trigger guard_opportunities before insert or update on public.intern_supply_opportunities for each row execute function public.intern_supply_guard();
create trigger guard_field before insert or update on public.intern_supply_field_assignments for each row execute function public.intern_supply_guard();

-- ============ audit ============
create or replace function public.intern_supply_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.intern_audit_log (intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  values (coalesce(new.intern_id, old.intern_id), auth.uid(),
          lower(tg_op) || '_' || replace(tg_table_name, 'intern_supply_', ''),
          tg_table_name, coalesce(new.id, old.id),
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_prospects after insert or update or delete on public.intern_supply_driver_prospects for each row execute function public.intern_supply_audit();
create trigger audit_suppliers after insert or update or delete on public.intern_supply_fleet_suppliers for each row execute function public.intern_supply_audit();
create trigger audit_vehicles after insert or update or delete on public.intern_supply_vehicles for each row execute function public.intern_supply_audit();
create trigger audit_destinations after insert or update or delete on public.intern_supply_destinations for each row execute function public.intern_supply_audit();
create trigger audit_opportunities after insert or update or delete on public.intern_supply_opportunities for each row execute function public.intern_supply_audit();
create trigger audit_field after insert or update or delete on public.intern_supply_field_assignments for each row execute function public.intern_supply_audit();
