-- see /tmp/mig/partners360.sql
-- YALLA PARTNERS 360 — marketplace spine: supply linkage, demand matching,
-- quotation engine, explainable performance index, risk flags.

create table if not exists public.partner_supply_assets (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('DRIVER','VEHICLE','FLEET_CAPACITY','EQUIPMENT')),
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  label text not null,
  service_types text[] not null default '{}',
  vehicle_class text,
  city text,
  county text,
  country text not null default 'KE',
  capacity integer not null default 1 check (capacity > 0),
  status text not null default 'REGISTERED'
    check (status in ('REGISTERED','VERIFICATION','APPROVED','AVAILABLE','ASSIGNED','ON_TRIP','UNAVAILABLE','SUSPENDED','RETIRED')),
  compliance_expires_at date,
  quality_score numeric(5,2) not null default 70 check (quality_score between 0 and 100),
  is_demo boolean not null default false,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_supply_kind_identity check (
    (asset_kind = 'DRIVER'  and driver_id is not null) or
    (asset_kind = 'VEHICLE' and vehicle_id is not null) or
    (asset_kind in ('FLEET_CAPACITY','EQUIPMENT'))
  )
);

create unique index if not exists partner_supply_driver_uniq
  on public.partner_supply_assets(driver_id) where driver_id is not null;
create unique index if not exists partner_supply_vehicle_uniq
  on public.partner_supply_assets(vehicle_id) where vehicle_id is not null;
create index if not exists partner_supply_partner_idx on public.partner_supply_assets(partner_id, status);
create index if not exists partner_supply_city_idx on public.partner_supply_assets(city, status);

grant select, insert, update on public.partner_supply_assets to authenticated;
grant all on public.partner_supply_assets to service_role;
alter table public.partner_supply_assets enable row level security;

create policy partner_supply_staff_all on public.partner_supply_assets
  for all to authenticated using (public.yp_is_staff()) with check (public.yp_is_staff());
create policy partner_supply_member_read on public.partner_supply_assets
  for select to authenticated using (public.is_partner_member(partner_id));

create trigger partner_supply_touch before update on public.partner_supply_assets
  for each row execute function public.yp_touch_updated_at();

create table if not exists public.partner_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_code text not null unique default ('PQ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  request_id uuid not null references public.capacity_requests(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  state text not null default 'REQUESTED'
    check (state in ('REQUESTED','VIEWED','DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED','REJECTED','EXPIRED','WITHDRAWN')),
  currency text not null default 'KES',
  quoted_amount numeric(14,2),
  tax_amount numeric(14,2) not null default 0,
  fees_amount numeric(14,2) not null default 0,
  commission_pct numeric(6,3),
  commission_amount numeric(14,2),
  partner_net numeric(14,2),
  yalla_margin numeric(14,2),
  validity_until timestamptz,
  inclusions text,
  exclusions text,
  terms text,
  decision_notes text,
  response_minutes integer,
  order_id uuid references public.mobility_orders(id) on delete set null,
  requested_by uuid,
  submitted_by uuid,
  decided_by uuid,
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, partner_id)
);

create index if not exists partner_quotes_state_idx on public.partner_quotes(state, requested_at desc);
create index if not exists partner_quotes_partner_idx on public.partner_quotes(partner_id, state);

grant select on public.partner_quotes to authenticated;
grant all on public.partner_quotes to service_role;
alter table public.partner_quotes enable row level security;

create policy partner_quotes_staff_read on public.partner_quotes
  for select to authenticated using (public.yp_is_staff());
create policy partner_quotes_member_read on public.partner_quotes
  for select to authenticated using (public.is_partner_member(partner_id));

create trigger partner_quotes_touch before update on public.partner_quotes
  for each row execute function public.yp_touch_updated_at();

create table if not exists public.partner_performance_components (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  computed_at timestamptz not null default now(),
  component text not null,
  weight numeric(6,2) not null,
  score numeric(6,2) not null,
  evidence jsonb not null default '{}'::jsonb,
  window_days integer not null default 90
);
create index if not exists partner_perf_partner_idx
  on public.partner_performance_components(partner_id, computed_at desc);

grant select on public.partner_performance_components to authenticated;
grant all on public.partner_performance_components to service_role;
alter table public.partner_performance_components enable row level security;

create policy partner_perf_staff_read on public.partner_performance_components
  for select to authenticated using (public.yp_is_staff());
create policy partner_perf_member_read on public.partner_performance_components
  for select to authenticated using (public.is_partner_member(partner_id));

create table if not exists public.partner_risk_flags (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  kind text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  state text not null default 'OPEN' check (state in ('OPEN','INVESTIGATING','RESOLVED','DISMISSED')),
  detail text not null,
  evidence jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  detected_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_notes text,
  updated_at timestamptz not null default now()
);
create index if not exists partner_risk_state_idx on public.partner_risk_flags(state, severity, detected_at desc);

grant select on public.partner_risk_flags to authenticated;
grant all on public.partner_risk_flags to service_role;
alter table public.partner_risk_flags enable row level security;

create policy partner_risk_staff_read on public.partner_risk_flags
  for select to authenticated using (public.yp_is_staff());

create trigger partner_risk_touch before update on public.partner_risk_flags
  for each row execute function public.yp_touch_updated_at();

create or replace function public.partner_supply_register(
  _partner_id uuid,
  _asset_kind text,
  _label text,
  _service_types text[] default '{}',
  _driver_id uuid default null,
  _vehicle_id uuid default null,
  _vehicle_class text default null,
  _city text default null,
  _capacity integer default 1,
  _compliance_expires_at date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare _id uuid; _p partners;
begin
  select * into _p from partners where id = _partner_id;
  if _p.id is null then raise exception 'Partner not found'; end if;
  if not (yp_is_staff() or is_partner_member(_partner_id)) then
    raise exception 'Not authorised to register supply for this partner';
  end if;
  if _p.status not in ('active','pending') then
    raise exception 'Partner % cannot register supply while %', _p.partner_code, _p.status;
  end if;

  if _asset_kind = 'DRIVER' then
    if _driver_id is null then raise exception 'Driver reference required'; end if;
    if not exists (select 1 from drivers d where d.id = _driver_id
                   and d.verification_status::text = 'verified' and d.status::text = 'active') then
      raise exception 'Driver is not verified and active in the driver master';
    end if;
  elsif _asset_kind = 'VEHICLE' then
    if _vehicle_id is null then raise exception 'Vehicle reference required'; end if;
    if not exists (select 1 from vehicles v where v.id = _vehicle_id
                   and coalesce(v.vehicle_status::text,'') in ('active','available','approved')) then
      raise exception 'Vehicle is not approved in the fleet master';
    end if;
  end if;

  insert into partner_supply_assets(
    partner_id, asset_kind, driver_id, vehicle_id, label, service_types,
    vehicle_class, city, capacity, compliance_expires_at, status, created_by, is_demo)
  values (_partner_id, _asset_kind, _driver_id, _vehicle_id, _label,
          coalesce(_service_types,'{}'), _vehicle_class, _city, greatest(coalesce(_capacity,1),1),
          _compliance_expires_at,
          case when _asset_kind in ('DRIVER','VEHICLE') then 'AVAILABLE' else 'VERIFICATION' end,
          auth.uid(), _p.is_demo)
  returning id into _id;

  insert into partner_events(partner_id, event_type, title, detail, severity, payload, actor_id)
  values (_partner_id, 'SUPPLY_ADDED', 'Supply registered: ' || _label,
          _asset_kind, 'info', jsonb_build_object('asset_id', _id, 'kind', _asset_kind), auth.uid());
  perform yp_audit('supply.create', 'partner_supply_assets', _id,
                   jsonb_build_object('partner_id', _partner_id, 'kind', _asset_kind));
  return _id;
end $$;

create or replace function public.partner_supply_set_status(
  _asset_id uuid, _status text, _note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare _a partner_supply_assets;
begin
  select * into _a from partner_supply_assets where id = _asset_id;
  if _a.id is null then raise exception 'Supply asset not found'; end if;
  if not yp_is_staff() then raise exception 'Only Yalla staff may change supply status'; end if;
  update partner_supply_assets set status = _status, notes = coalesce(_note, notes) where id = _asset_id;
  insert into partner_events(partner_id, event_type, title, detail, severity, payload, actor_id)
  values (_a.partner_id, 'SUPPLY_STATUS_CHANGED', _a.label || ' -> ' || _status, _note, 'info',
          jsonb_build_object('asset_id', _asset_id, 'from', _a.status, 'to', _status), auth.uid());
  perform yp_audit('supply.update', 'partner_supply_assets', _asset_id,
                   jsonb_build_object('from', _a.status, 'to', _status));
end $$;

create or replace function public.partner_match_demand(_request_id uuid)
returns table (
  partner_id uuid, partner_code text, partner_name text, eligible boolean,
  score numeric, matched_assets integer, capacity_available integer,
  reasons text[], exclusions text[]
)
language plpgsql security definer set search_path = public as $$
declare _r capacity_requests;
begin
  perform yp_require_staff();
  select * into _r from capacity_requests where id = _request_id;
  if _r.id is null then raise exception 'Demand request not found'; end if;

  return query
  with agg as (
    select p.id, p.partner_code, p.legal_name, p.trading_name, p.status::text as status,
           p.verification_status::text as verification_status, p.risk_score, p.trust_score,
           count(a.id) filter (
             where a.status in ('AVAILABLE','APPROVED')
               and (_r.service_type::text = any(a.service_types) or a.service_types = '{}')
               and (_r.vehicle_class is null or a.vehicle_class is null or a.vehicle_class = _r.vehicle_class)
               and (a.compliance_expires_at is null or a.compliance_expires_at >= current_date)
           )::int as ok_assets,
           coalesce(sum(a.capacity) filter (
             where a.status in ('AVAILABLE','APPROVED')
               and (_r.service_type::text = any(a.service_types) or a.service_types = '{}')
               and (a.compliance_expires_at is null or a.compliance_expires_at >= current_date)
           ),0)::int as cap,
           count(a.id) filter (where a.compliance_expires_at < current_date)::int as expired_assets,
           count(a.id) filter (where a.city is not null and _r.origin_label ilike '%' || a.city || '%')::int as local_assets,
           avg(a.quality_score) as avg_quality
      from partners p
      left join partner_supply_assets a on a.partner_id = p.id
     group by p.id
  )
  select agg.id, agg.partner_code, coalesce(nullif(agg.trading_name,''), agg.legal_name),
         (agg.status = 'active' and agg.verification_status = 'verified'
            and agg.ok_assets > 0 and agg.cap >= coalesce(_r.passengers,1)
            and coalesce(agg.risk_score,0) < 70),
         round(
           least(30, agg.ok_assets * 6)
           + case when agg.local_assets > 0 then 20 else 0 end
           + least(20, coalesce(agg.avg_quality,0) * 0.2)
           + greatest(0, 15 - coalesce(agg.risk_score,0) * 0.15)
           + least(15, coalesce(agg.trust_score,0) * 0.15)
         , 2),
         agg.ok_assets, agg.cap,
         array_remove(array[
           case when agg.ok_assets > 0 then agg.ok_assets || ' compliant asset(s) match the service' end,
           case when agg.local_assets > 0 then 'Supply based near ' || _r.origin_label end,
           case when agg.cap >= coalesce(_r.passengers,1) then 'Capacity ' || agg.cap || ' meets required ' || coalesce(_r.passengers,1) end,
           case when coalesce(agg.risk_score,0) < 30 then 'Low risk score' end,
           case when agg.verification_status = 'verified' then 'KYB verified' end
         ], null),
         array_remove(array[
           case when agg.status <> 'active' then 'Partner status is ' || agg.status end,
           case when agg.verification_status <> 'verified' then 'Verification is ' || agg.verification_status end,
           case when agg.ok_assets = 0 then 'No available compliant supply for ' || _r.service_type::text end,
           case when agg.cap < coalesce(_r.passengers,1) then 'Capacity ' || agg.cap || ' below required ' || coalesce(_r.passengers,1) end,
           case when agg.expired_assets > 0 then agg.expired_assets || ' asset(s) have expired compliance' end,
           case when coalesce(agg.risk_score,0) >= 70 then 'Risk score ' || agg.risk_score || ' exceeds threshold' end
         ], null)
    from agg
   order by 4 desc, 5 desc;
end $$;

create or replace function public.partner_quote_request(_request_id uuid, _partner_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare _id uuid; _r capacity_requests;
begin
  perform yp_require_staff();
  select * into _r from capacity_requests where id = _request_id;
  if _r.id is null then raise exception 'Demand request not found'; end if;
  if not exists (select 1 from partners where id = _partner_id and status::text = 'active'
                 and verification_status::text = 'verified') then
    raise exception 'Only active, verified partners may be invited to quote';
  end if;

  insert into partner_quotes(request_id, partner_id, requested_by, currency, is_demo)
  values (_request_id, _partner_id, auth.uid(), coalesce(_r.currency,'KES'), coalesce(_r.is_demo,false))
  on conflict (request_id, partner_id) do update set updated_at = now()
  returning id into _id;

  insert into partner_events(partner_id, event_type, title, detail, severity, payload, actor_id)
  values (_partner_id, 'QUOTE_REQUESTED', 'Quote requested for ' || _r.request_code,
          _r.origin_label, 'info', jsonb_build_object('quote_id', _id, 'request_id', _request_id), auth.uid());
  return _id;
end $$;

create or replace function public.partner_quote_submit(
  _quote_id uuid,
  _quoted_amount numeric,
  _tax_amount numeric default 0,
  _fees_amount numeric default 0,
  _validity_hours integer default 72,
  _inclusions text default null,
  _exclusions text default null,
  _terms text default null
) returns public.partner_quotes
language plpgsql security definer set search_path = public as $$
declare _q partner_quotes; _pct numeric; _out partner_quotes;
begin
  select * into _q from partner_quotes where id = _quote_id;
  if _q.id is null then raise exception 'Quote not found'; end if;
  if not (yp_is_staff() or is_partner_member(_q.partner_id)) then
    raise exception 'Not authorised to submit this quote';
  end if;
  if _q.state not in ('REQUESTED','VIEWED','DRAFT','SUBMITTED') then
    raise exception 'Quote is % and can no longer be priced', _q.state;
  end if;
  if coalesce(_quoted_amount,0) <= 0 then raise exception 'Quoted amount must be positive'; end if;

  select coalesce(partner_margin_pct, 0) into _pct from partners where id = _q.partner_id;

  update partner_quotes set
    state = 'SUBMITTED',
    quoted_amount = round(_quoted_amount, 2),
    tax_amount = round(greatest(coalesce(_tax_amount,0),0), 2),
    fees_amount = round(greatest(coalesce(_fees_amount,0),0), 2),
    commission_pct = _pct,
    commission_amount = round(_quoted_amount * _pct / 100.0, 2),
    partner_net = round(_quoted_amount - (_quoted_amount * _pct / 100.0), 2),
    yalla_margin = round(_quoted_amount * _pct / 100.0, 2),
    validity_until = now() + make_interval(hours => greatest(coalesce(_validity_hours,72),1)),
    inclusions = _inclusions, exclusions = _exclusions, terms = _terms,
    submitted_by = auth.uid(), submitted_at = now(),
    response_minutes = greatest(0, (extract(epoch from (now() - requested_at)) / 60)::int)
  where id = _quote_id
  returning * into _out;

  insert into partner_events(partner_id, event_type, title, detail, severity, payload, actor_id)
  values (_q.partner_id, 'QUOTE_SUBMITTED', 'Quote ' || _out.quote_code || ' submitted',
          _out.currency || ' ' || _out.quoted_amount, 'info',
          jsonb_build_object('quote_id', _quote_id, 'amount', _out.quoted_amount), auth.uid());
  perform yp_audit('quote.submit', 'partner_quotes', _quote_id,
                   jsonb_build_object('amount', _out.quoted_amount, 'net', _out.partner_net));
  return _out;
end $$;

create or replace function public.partner_quote_decide(
  _quote_id uuid, _accept boolean, _note text default null
) returns public.partner_quotes
language plpgsql security definer set search_path = public as $$
declare _q partner_quotes; _out partner_quotes;
begin
  select * into _q from partner_quotes where id = _quote_id;
  if _q.id is null then raise exception 'Quote not found'; end if;
  if not (has_any_role(auth.uid(), array['super_admin','admin','finance_admin','pricing_manager']::app_role[])) then
    raise exception 'Quote decisions require commercial authority';
  end if;
  if _q.state <> 'SUBMITTED' then raise exception 'Only submitted quotes can be decided (state %)', _q.state; end if;
  if _q.validity_until is not null and _q.validity_until < now() then
    update partner_quotes set state = 'EXPIRED' where id = _quote_id;
    raise exception 'Quote expired on %', _q.validity_until;
  end if;
  if _accept and auth.uid() is not null and auth.uid() = _q.submitted_by then
    raise exception 'Maker-checker: the actor who priced this quote cannot accept it';
  end if;

  update partner_quotes set
    state = case when _accept then 'ACCEPTED' else 'REJECTED' end,
    decided_by = auth.uid(), decided_at = now(), decision_notes = _note
  where id = _quote_id returning * into _out;

  if _accept then
    update capacity_requests set status = 'matched' where id = _q.request_id;
    update partner_quotes set state = 'REJECTED',
           decision_notes = coalesce(decision_notes, 'Another quote was accepted'),
           decided_by = auth.uid(), decided_at = now()
     where request_id = _q.request_id and id <> _quote_id and state in ('REQUESTED','VIEWED','DRAFT','SUBMITTED');
  end if;

  insert into partner_events(partner_id, event_type, title, detail, severity, payload, actor_id)
  values (_q.partner_id, case when _accept then 'QUOTE_ACCEPTED' else 'QUOTE_REJECTED' end,
          'Quote ' || _out.quote_code || (case when _accept then ' accepted' else ' rejected' end),
          _note, case when _accept then 'info' else 'warning' end,
          jsonb_build_object('quote_id', _quote_id), auth.uid());
  perform yp_audit('quote.decide', 'partner_quotes', _quote_id,
                   jsonb_build_object('accepted', _accept, 'note', _note));
  return _out;
end $$;

create or replace function public.partner_score_recompute(_partner_id uuid, _days integer default 90)
returns table (component text, weight numeric, score numeric, evidence jsonb)
language plpgsql security definer set search_path = public as $$
declare
  _since timestamptz := now() - make_interval(days => greatest(coalesce(_days,90),7));
  _total int; _completed int; _cancelled int; _breached int; _cases int;
  _docs int; _bad_docs int; _quotes int; _answered int; _avg_resp numeric;
  _gbv numeric; _margin numeric;
  _reliability numeric; _quality numeric; _compliance numeric; _commercial numeric; _resp numeric;
begin
  perform yp_require_staff();
  if not exists (select 1 from partners where id = _partner_id) then raise exception 'Partner not found'; end if;

  select count(*), count(*) filter (where status::text = 'COMPLETED'), count(*) filter (where status::text = 'CANCELLED'),
         coalesce(sum(customer_price),0), coalesce(sum(yalla_margin),0)
    into _total, _completed, _cancelled, _gbv, _margin
    from mobility_orders where partner_id = _partner_id and created_at >= _since;

  select count(*), count(*) filter (where resolved_at is null and due_at < now())
    into _cases, _breached
    from partner_work_items where partner_id = _partner_id and created_at >= _since;

  select count(*), count(*) filter (where status::text <> 'approved' or (expires_at is not null and expires_at < current_date))
    into _docs, _bad_docs
    from partner_documents where partner_id = _partner_id;

  select count(*), count(*) filter (where submitted_at is not null), avg(response_minutes)
    into _quotes, _answered, _avg_resp
    from partner_quotes where partner_id = _partner_id and requested_at >= _since;

  _reliability := case when _total = 0 then 12.5 else round(25.0 * _completed / _total, 2) end;
  _quality     := case when _cases = 0 then 20 else round(greatest(0, 20 - (_breached::numeric / _cases) * 20), 2) end;
  _compliance  := case when _docs = 0 then 8 else round(20.0 * (_docs - _bad_docs) / _docs, 2) end;
  _commercial  := case when _gbv = 0 then 8 else round(least(20, 10 + (_margin / greatest(_gbv,1)) * 100), 2) end;
  _resp        := case when _quotes = 0 then 7.5
                       else round(least(15, 15.0 * _answered / _quotes
                            * case when coalesce(_avg_resp, 0) <= 240 then 1 else 0.7 end), 2) end;

  delete from partner_performance_components where partner_id = _partner_id;
  insert into partner_performance_components(partner_id, component, weight, score, evidence, window_days)
  values
    (_partner_id, 'RELIABILITY', 25, _reliability,
      jsonb_build_object('orders', _total, 'completed', _completed, 'cancelled', _cancelled), _days),
    (_partner_id, 'SERVICE_QUALITY', 20, _quality,
      jsonb_build_object('cases', _cases, 'sla_breached', _breached), _days),
    (_partner_id, 'COMPLIANCE', 20, _compliance,
      jsonb_build_object('documents', _docs, 'invalid_or_expired', _bad_docs), _days),
    (_partner_id, 'COMMERCIAL', 20, _commercial,
      jsonb_build_object('gbv', _gbv, 'yalla_margin', _margin), _days),
    (_partner_id, 'RESPONSIVENESS', 15, _resp,
      jsonb_build_object('quotes', _quotes, 'answered', _answered, 'avg_response_minutes', round(coalesce(_avg_resp,0),1)), _days);

  update partners set trust_score = round(_reliability + _quality + _compliance + _commercial + _resp)
   where id = _partner_id;

  perform yp_audit('partner.score', 'partners', _partner_id,
                   jsonb_build_object('total', _reliability + _quality + _compliance + _commercial + _resp));

  return query select c.component, c.weight, c.score, c.evidence
    from partner_performance_components c where c.partner_id = _partner_id
    order by c.weight desc, c.component;
end $$;

create or replace function public.partner_risk_scan()
returns integer
language plpgsql security definer set search_path = public as $$
declare _n integer := 0; _c integer;
begin
  perform yp_require_staff();

  with ins as (
    insert into partner_risk_flags(partner_id, kind, severity, detail, evidence, dedupe_key)
    select d.partner_id, 'DOCUMENT_EXPIRED', 'high',
           'Compliance document ' || d.requirement_code || ' expired on ' || d.expires_at,
           jsonb_build_object('document_id', d.id, 'expires_at', d.expires_at),
           'doc-expired:' || d.id
      from partner_documents d
     where d.partner_id is not null and d.expires_at is not null and d.expires_at < current_date
    on conflict (dedupe_key) do nothing
    returning 1)
  select count(*) into _c from ins; _n := _n + _c;

  with ins as (
    insert into partner_risk_flags(partner_id, kind, severity, detail, evidence, dedupe_key)
    select a.partner_id, 'SUPPLY_COMPLIANCE_EXPIRED', 'high',
           'Supply asset ' || a.label || ' has expired compliance',
           jsonb_build_object('asset_id', a.id, 'expires_at', a.compliance_expires_at),
           'supply-expired:' || a.id
      from partner_supply_assets a
     where a.compliance_expires_at < current_date and a.status <> 'RETIRED'
    on conflict (dedupe_key) do nothing
    returning 1)
  select count(*) into _c from ins; _n := _n + _c;

  with ins as (
    insert into partner_risk_flags(partner_id, kind, severity, detail, evidence, dedupe_key)
    select p.id, 'ACTIVE_WITHOUT_VERIFICATION', 'critical',
           'Partner is active but verification is ' || p.verification_status,
           jsonb_build_object('verification_status', p.verification_status),
           'unverified-active:' || p.id || ':' || p.verification_status
      from partners p
     where p.status::text = 'active' and p.verification_status::text <> 'verified'
    on conflict (dedupe_key) do nothing
    returning 1)
  select count(*) into _c from ins; _n := _n + _c;

  with ins as (
    insert into partner_risk_flags(partner_id, kind, severity, detail, evidence, dedupe_key)
    select w.partner_id, 'SLA_BREACH', 'medium',
           'Work item ' || w.work_code || ' breached its SLA',
           jsonb_build_object('work_item_id', w.id, 'due_at', w.due_at, 'queue', w.queue),
           'sla-breach:' || w.id
      from partner_work_items w
     where w.partner_id is not null and w.resolved_at is null and w.due_at < now()
    on conflict (dedupe_key) do nothing
    returning 1)
  select count(*) into _c from ins; _n := _n + _c;

  update partner_risk_flags f set state = 'RESOLVED', resolved_at = now(),
         resolution_notes = coalesce(resolution_notes, 'Condition cleared automatically')
   where f.state in ('OPEN','INVESTIGATING')
     and f.kind = 'SLA_BREACH'
     and exists (select 1 from partner_work_items w
                  where 'sla-breach:' || w.id = f.dedupe_key and w.resolved_at is not null);

  return _n;
end $$;

create or replace function public.partner_risk_resolve(
  _flag_id uuid, _state text, _note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare _f partner_risk_flags;
begin
  if not has_any_role(auth.uid(), array['super_admin','admin','compliance_admin']::app_role[]) then
    raise exception 'Risk resolution requires compliance authority';
  end if;
  select * into _f from partner_risk_flags where id = _flag_id;
  if _f.id is null then raise exception 'Risk flag not found'; end if;
  if _state not in ('OPEN','INVESTIGATING','RESOLVED','DISMISSED') then raise exception 'Invalid state'; end if;
  update partner_risk_flags set state = _state, resolution_notes = _note,
         resolved_by = case when _state in ('RESOLVED','DISMISSED') then auth.uid() else null end,
         resolved_at = case when _state in ('RESOLVED','DISMISSED') then now() else null end
   where id = _flag_id;
  perform yp_audit('risk.resolve', 'partner_risk_flags', _flag_id,
                   jsonb_build_object('state', _state, 'note', _note));
end $$;

create or replace function public.partner_supply_coverage()
returns table (
  city text, service_type text, available_capacity bigint, available_assets bigint,
  qualified_partners bigint, open_demand bigint, required_capacity bigint
)
language sql security definer set search_path = public stable as $$
  with supply as (
    select coalesce(a.city,'Unassigned') as city, s.service_type,
           sum(a.capacity) as cap, count(*) as assets, count(distinct a.partner_id) as partners
      from partner_supply_assets a
      join partners p on p.id = a.partner_id and p.status::text = 'active'
      cross join lateral unnest(case when a.service_types = '{}' then array['RIDE'] else a.service_types end) as s(service_type)
     where a.status in ('AVAILABLE','APPROVED')
       and (a.compliance_expires_at is null or a.compliance_expires_at >= current_date)
     group by 1, 2
  ), demand as (
    select coalesce(nullif(r.origin_label,''),'Unassigned') as city, r.service_type::text as service_type,
           count(*) as reqs, coalesce(sum(coalesce(r.passengers,1)),0) as needed
      from capacity_requests r
     where r.status in ('open','pending','matching')
     group by 1, 2
  )
  select coalesce(s.city, d.city), coalesce(s.service_type, d.service_type),
         coalesce(s.cap,0)::bigint, coalesce(s.assets,0)::bigint, coalesce(s.partners,0)::bigint,
         coalesce(d.reqs,0)::bigint, coalesce(d.needed,0)::bigint
    from supply s full join demand d on d.city = s.city and d.service_type = s.service_type
   order by 6 desc, 3 desc;
$$;

grant execute on function public.partner_supply_register(uuid,text,text,text[],uuid,uuid,text,text,integer,date) to authenticated;
grant execute on function public.partner_supply_set_status(uuid,text,text) to authenticated;
grant execute on function public.partner_match_demand(uuid) to authenticated;
grant execute on function public.partner_quote_request(uuid,uuid) to authenticated;
grant execute on function public.partner_quote_submit(uuid,numeric,numeric,numeric,integer,text,text,text) to authenticated;
grant execute on function public.partner_quote_decide(uuid,boolean,text) to authenticated;
grant execute on function public.partner_score_recompute(uuid,integer) to authenticated;
grant execute on function public.partner_risk_scan() to authenticated;
grant execute on function public.partner_risk_resolve(uuid,text,text) to authenticated;
grant execute on function public.partner_supply_coverage() to authenticated;