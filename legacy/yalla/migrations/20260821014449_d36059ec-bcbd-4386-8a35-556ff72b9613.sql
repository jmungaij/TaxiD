
revoke all on function public.intern_supply_guard() from public, anon, authenticated;
revoke all on function public.intern_supply_audit() from public, anon, authenticated;
revoke all on function public.least_stage_guard(text) from public, anon;

-- ============ metrics view ============
create or replace view public.v_intern_supply_metrics as
select
  p.id as intern_id,
  p.full_name,
  p.cohort_id,
  c.name as cohort_name,
  t.code as track_code,
  t.name as track_name,
  p.talent_level,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id) as driver_prospects,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.stage in ('QUALIFIED','DOCUMENTS_REQUESTED','DOCUMENTS_SUBMITTED','VERIFIED','ONBOARDING','APPROVED','ACTIVATED','PRODUCTIVE')) as qualified_drivers,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.stage in ('ONBOARDING','APPROVED')) as drivers_onboarding,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.stage in ('ACTIVATED','PRODUCTIVE')) as drivers_activated,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.review_status = 'ACCEPTED') as prospects_accepted,
  (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.review_status in ('RETURNED','REJECTED')) as prospects_rejected,
  (select count(*) from public.intern_supply_fleet_suppliers f where f.intern_id = p.id) as fleet_leads,
  (select count(*) from public.intern_supply_fleet_suppliers f where f.intern_id = p.id and f.supplier_status in ('QUALIFIED','DOCUMENTS_SUBMITTED','VERIFIED','ONBOARDING','ACTIVATED')) as fleet_suppliers_qualified,
  (select count(*) from public.intern_supply_fleet_suppliers f where f.intern_id = p.id and f.supplier_status in ('VERIFIED','ONBOARDING','ACTIVATED')) as fleet_suppliers_verified,
  (select coalesce(sum(f.vehicle_count), 0) from public.intern_supply_fleet_suppliers f where f.intern_id = p.id and f.supplier_status in ('VERIFIED','ONBOARDING','ACTIVATED')) as verified_fleet_capacity,
  (select count(*) from public.intern_supply_vehicles v where v.intern_id = p.id) as vehicles_mapped,
  (select count(*) from public.intern_supply_destinations dd where dd.intern_id = p.id) as destinations_researched,
  (select count(*) from public.intern_supply_destinations dd where dd.intern_id = p.id and dd.status in ('ACCEPTED','COMPLETE')) as destination_profiles,
  (select count(*) from public.intern_supply_opportunities o where o.intern_id = p.id) as opportunities,
  (select count(*) from public.intern_supply_opportunities o where o.intern_id = p.id and o.stage in ('QUALIFIED','OPPORTUNITY','CUSTOMER','BOOKING','COMPLETED_SERVICE','VERIFIED_REVENUE')) as opportunities_qualified,
  (select coalesce(sum(o.verified_revenue_kes), 0) from public.intern_supply_opportunities o where o.intern_id = p.id) as verified_revenue_kes,
  (select count(*) from public.intern_supply_field_assignments fa where fa.intern_id = p.id) as field_assignments,
  (select count(*) from public.intern_supply_field_assignments fa where fa.intern_id = p.id and fa.supervisor_verified) as field_assignments_verified,
  (select round(avg(d.data_quality_score), 1) from public.intern_supply_driver_prospects d where d.intern_id = p.id and d.data_quality_score is not null) as data_quality_score,
  bool_or(coalesce(p.institution, '') = 'DEMO / TEST DATA') as is_demo
from public.intern_profiles p
left join public.intern_cohorts c on c.id = p.cohort_id
left join public.intern_tracks t on t.id = p.track_id
where p.deleted_at is null
group by p.id, p.full_name, p.cohort_id, c.name, t.code, t.name, p.talent_level;

grant select on public.v_intern_supply_metrics to authenticated;

-- ============ supply development score (server-authoritative) ============
create or replace function public.intern_supply_score(p_intern uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m record; s numeric; comp jsonb; prod numeric;
  f_qp numeric; f_vd numeric; f_on numeric; f_act numeric; f_fs numeric; f_cap numeric; f_dest numeric; f_dq numeric;
begin
  if not public.intern_can_view(p_intern) then
    raise exception 'not authorised to score this intern';
  end if;
  select * into m from public.v_intern_supply_metrics where intern_id = p_intern;
  if m is null then return jsonb_build_object('supply_score', 0, 'components', '[]'::jsonb); end if;

  -- normalised achievement against published 24-week programme benchmarks
  f_qp   := least(1.0, m.qualified_drivers::numeric / 40);
  f_vd   := least(1.0, (select count(*) from public.intern_supply_driver_prospects d where d.intern_id = p_intern and d.documents_status = 'VERIFIED')::numeric / 25);
  f_on   := least(1.0, m.drivers_onboarding::numeric / 15);
  f_act  := least(1.0, m.drivers_activated::numeric / 10);
  f_fs   := least(1.0, m.fleet_suppliers_qualified::numeric / 12);
  f_cap  := least(1.0, m.verified_fleet_capacity::numeric / 60);
  f_dest := least(1.0, m.destination_profiles::numeric / 8);
  f_dq   := coalesce(m.data_quality_score, 0) / 100;

  s := round(100 * (f_qp*0.10 + f_vd*0.15 + f_on*0.15 + f_act*0.20 + f_fs*0.10 + f_cap*0.15 + f_dest*0.10 + f_dq*0.05), 1);

  comp := jsonb_build_array(
    jsonb_build_object('dimension','Qualified driver prospects','weight',10,'achievement',round(f_qp*100,1)),
    jsonb_build_object('dimension','Verified driver applications','weight',15,'achievement',round(f_vd*100,1)),
    jsonb_build_object('dimension','Drivers entering onboarding','weight',15,'achievement',round(f_on*100,1)),
    jsonb_build_object('dimension','Activated drivers','weight',20,'achievement',round(f_act*100,1)),
    jsonb_build_object('dimension','Qualified fleet suppliers','weight',10,'achievement',round(f_fs*100,1)),
    jsonb_build_object('dimension','Verified fleet capacity','weight',15,'achievement',round(f_cap*100,1)),
    jsonb_build_object('dimension','Destination mobility opportunities','weight',10,'achievement',round(f_dest*100,1)),
    jsonb_build_object('dimension','Data quality','weight',5,'achievement',round(f_dq*100,1))
  );

  prod := round(100 * least(1.0, (m.prospects_accepted + m.destination_profiles + m.fleet_suppliers_qualified + m.field_assignments_verified)::numeric / 60), 1);

  return jsonb_build_object(
    'intern_id', p_intern,
    'supply_score', s,
    'productivity_score', prod,
    'quality_score', coalesce(m.data_quality_score, 0),
    'acceptance_rate', case when (m.prospects_accepted + m.prospects_rejected) > 0
      then round(100.0 * m.prospects_accepted / (m.prospects_accepted + m.prospects_rejected), 1) else null end,
    'verified_revenue_kes', m.verified_revenue_kes,
    'components', comp,
    'weights', jsonb_build_object('learning',15,'productivity',20,'supply_development',25,'quality',15,'commercial',15,'conduct',10),
    'is_demo', m.is_demo
  );
end $$;

revoke all on function public.intern_supply_score(uuid) from public, anon;
grant execute on function public.intern_supply_score(uuid) to authenticated;

-- ============ integrity scan ============
create or replace function public.intern_supply_scan_integrity(p_cohort uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_flags int := 0; r record;
begin
  if not public.intern_programme_authority(auth.uid()) then
    raise exception 'integrity scan requires programme authority';
  end if;

  for r in
    select d.intern_id, 'duplicate_driver_phone' as signal, jsonb_build_object('phone', d.phone_norm, 'count', count(*)) as detail
    from public.intern_supply_driver_prospects d
    where d.cohort_id = p_cohort and d.phone_norm <> ''
    group by d.intern_id, d.phone_norm having count(*) > 1
    union all
    select v.intern_id, 'duplicate_vehicle_registration', jsonb_build_object('registration', v.registration_norm, 'count', count(*))
    from public.intern_supply_vehicles v
    where v.cohort_id = p_cohort and v.registration_norm <> ''
    group by v.intern_id, v.registration_norm having count(*) > 1
    union all
    select f.intern_id, 'duplicate_supplier', jsonb_build_object('supplier', lower(f.supplier_name), 'count', count(*))
    from public.intern_supply_fleet_suppliers f
    where f.cohort_id = p_cohort
    group by f.intern_id, lower(f.supplier_name) having count(*) > 1
    union all
    select o.intern_id, 'unsupported_revenue_claim', jsonb_build_object('opportunity', o.id)
    from public.intern_supply_opportunities o
    where o.cohort_id = p_cohort and o.stage = 'VERIFIED_REVENUE' and o.verified_source_id is null
    union all
    select d.intern_id, 'low_quality_bulk_capture', jsonb_build_object('day', d.created_at::date, 'records', count(*))
    from public.intern_supply_driver_prospects d
    where d.cohort_id = p_cohort and d.review_status in ('RETURNED','REJECTED')
    group by d.intern_id, d.created_at::date having count(*) >= 5
  loop
    insert into public.intern_integrity_flags (intern_id, signal, severity, detail, status)
    values (r.intern_id, r.signal, 'medium', r.detail || jsonb_build_object('resolution','INTEGRITY REVIEW REQUIRED — human review mandatory'), 'open');
    v_flags := v_flags + 1;
  end loop;

  return jsonb_build_object('cohort_id', p_cohort, 'flags_raised', v_flags, 'note', 'INTEGRITY REVIEW REQUIRED — no automatic misconduct determination');
end $$;

revoke all on function public.intern_supply_scan_integrity(uuid) from public, anon;
grant execute on function public.intern_supply_scan_integrity(uuid) to authenticated;

-- ============ DEMO cohort seed ============
do $seed$
declare
  v_prog uuid; v_dest uuid; v_fleet uuid; v_cohort uuid; v_intern uuid;
  v_names text[] := array['Amina Wairimu','Brian Otieno','Cynthia Njeri','Daniel Mutiso','Esther Kilonzo','Felix Barasa','Grace Achieng','Hassan Abdulla'];
  v_tracks text[] := array['Destination Intelligence','Driver Acquisition','Fleet Development','Corporate Mobility','Airport Mobility','Charter & Rental Supply','Logistics Mobility','Destination Commercialisation'];
  i int; v_prospects int; v_qualified int; v_onboard int; v_activated int; v_dq numeric; j int;
begin
  select id into v_prog from public.intern_programmes where code = 'YMEITA';
  select id into v_dest from public.intern_tracks where code = 'DEST_SUPPLY';
  select id into v_fleet from public.intern_tracks where code = 'DRIVER_FLEET';

  select id into v_cohort from public.intern_cohorts where name = 'YMEITA-DMFD-2026-A';
  if v_cohort is null then
    insert into public.intern_cohorts (programme_id, name, start_date, end_date, duration_weeks, intake_size, status, target_outcomes)
    values (v_prog, 'YMEITA-DMFD-2026-A', '2026-10-05', '2027-03-19', 24, 8, 'PLANNED',
      'DEMO / TEST DATA — Destinations Management, Mobility Supply & Fleet Development (DMFD-INT-2608). Nairobi, hybrid/field. Build verified mobility supply: drivers, fleet suppliers, destination profiles and commercial mobility opportunities.')
    returning id into v_cohort;
  end if;

  for i in 1..8 loop
    select id into v_intern from public.intern_profiles where cohort_id = v_cohort and full_name = v_names[i] || ' (DEMO)';
    if v_intern is null then
      insert into public.intern_profiles (cohort_id, track_id, full_name, institution, programme_of_study, qualification_level,
        location, work_arrangement, availability, status, talent_level, start_date, expected_end_date)
      values (v_cohort, case when i in (2,3,6) then v_fleet else v_dest end, v_names[i] || ' (DEMO)',
        'DEMO / TEST DATA', v_tracks[i] || ' Track', 'Undergraduate degree',
        'Nairobi, Kenya', 'hybrid', 'Full-time', 'ACTIVE', 'APPRENTICE', '2026-10-05', '2027-03-19')
      returning id into v_intern;
    end if;

    v_prospects := (array[34,42,12,18,26,15,20,17])[i];
    v_qualified := (array[21,28,7,11,17,9,13,11])[i];
    v_onboard   := (array[9,13,3,4,6,3,4,4])[i];
    v_activated := (array[5,7,2,2,4,2,3,4])[i];
    v_dq        := (array[91,94,89,93,90,88,92,90])[i];

    -- driver prospects
    for j in 1..v_prospects loop
      insert into public.intern_supply_driver_prospects
        (intern_id, cohort_id, full_name, phone, location, operating_area, vehicle_category, service_category, availability,
         stage, documents_status, review_status, reviewed_at, verified_at, activated_at, data_quality_score, notes, is_demo)
      select v_intern, v_cohort,
        'DEMO Driver ' || lpad(((i*100)+j)::text, 4, '0'),
        '+2547' || lpad(((i*1000)+j)::text, 8, '0'),
        (array['Nairobi CBD','Westlands','Embakasi','Karen','Kasarani','Ruiru'])[1 + (j % 6)],
        (array['Nairobi Metro','JKIA corridor','Mombasa Road','Thika Road'])[1 + (j % 4)],
        (array['Sedan','SUV','Executive sedan','Van','Minibus'])[1 + (j % 5)],
        (array['Ride-hailing','Airport transfer','Corporate mobility','Courier & logistics','Tourism mobility'])[1 + (j % 5)],
        'Weekdays',
        case
          when j <= v_activated then 'ACTIVATED'
          when j <= v_activated + v_onboard then 'ONBOARDING'
          when j <= v_qualified then 'QUALIFIED'
          when j <= v_qualified + 3 then 'CONTACTED'
          else 'LEAD' end,
        case when j <= v_activated + v_onboard then 'VERIFIED' when j <= v_qualified then 'PENDING' else 'NOT_PROVIDED' end,
        case when j <= v_qualified then 'ACCEPTED' when j % 9 = 0 then 'RETURNED' else 'SUBMITTED' end,
        case when j <= v_qualified then now() - (j || ' days')::interval end,
        case when j <= v_activated + v_onboard then now() - (j || ' days')::interval end,
        case when j <= v_activated then now() - (j || ' days')::interval end,
        v_dq, 'DEMO / TEST DATA', true;
    end loop;

    -- fleet suppliers + mapped vehicles
    for j in 1..(case when i = 3 then 18 when i = 6 then 8 else 3 end) loop
      insert into public.intern_supply_fleet_suppliers
        (intern_id, cohort_id, supplier_name, owner_name, contact_phone, fleet_type, location, operating_area, service_category,
         vehicle_count, capacity_seats, documentation_status, insurance_status, inspection_status, driver_availability,
         commercial_terms, supplier_status, activation_status, verified_at, data_quality_score, notes, is_demo)
      values (v_intern, v_cohort,
        'DEMO Fleet Supplier ' || i || '-' || lpad(j::text, 2, '0'),
        'DEMO Owner ' || i || '-' || j,
        '+2547' || lpad(((i*2000)+j)::text, 8, '0'),
        (array['Owner-operator','Small fleet','Corporate fleet','Bus & coach operator','Truck operator','Rental operator'])[1 + (j % 6)],
        (array['Nairobi','Mombasa Road','Thika','Nakuru'])[1 + (j % 4)],
        'Nairobi Metro',
        (array['Charter','Rentals & leasing','Corporate mobility','Logistics','Airport transfer'])[1 + (j % 5)],
        (array[4,6,9,12,3,7])[1 + (j % 6)],
        (array[4,7,14,33,51,5])[1 + (j % 6)],
        case when j % 3 = 0 then 'VERIFIED' else 'PENDING' end,
        case when j % 3 = 0 then 'VERIFIED' else 'PENDING' end,
        case when j % 4 = 0 then 'VERIFIED' else 'NOT_PROVIDED' end,
        'Own drivers available',
        'Standard supply agreement — DEMO',
        case when j % 3 = 0 then 'VERIFIED' when j % 2 = 0 then 'QUALIFIED' else 'CONTACTED' end,
        case when j % 6 = 0 then 'ACTIVATED' else 'NOT_ACTIVATED' end,
        case when j % 3 = 0 then now() - (j || ' days')::interval end,
        v_dq, 'DEMO / TEST DATA', true);
    end loop;

    insert into public.intern_supply_vehicles
      (intern_id, supplier_id, cohort_id, vehicle_type, registration, capacity, location, service_category, availability,
       insurance_status, inspection_status, review_status, is_demo)
    select v_intern, f.id, v_cohort,
      (array['Sedan','SUV','Van','Minibus','Coach','Truck','Executive vehicle'])[1 + (n % 7)],
      'DEMO ' || upper(substr(md5(f.id::text || n::text), 1, 3)) || ' ' || (100 + n)::text || 'X',
      (array[4,5,7,14,33,3,4])[1 + (n % 7)],
      f.location, f.service_category, 'Weekdays',
      case when n % 3 = 0 then 'VERIFIED' else 'PENDING' end,
      case when n % 4 = 0 then 'VERIFIED' else 'NOT_PROVIDED' end,
      case when n % 2 = 0 then 'ACCEPTED' else 'SUBMITTED' end, true
    from public.intern_supply_fleet_suppliers f
      cross join generate_series(1, 4) as n
    where f.intern_id = v_intern and f.cohort_id = v_cohort;

    -- destination profiles
    for j in 1..(case when i in (1,8) then 7 when i = 5 then 6 else 4 end) loop
      insert into public.intern_supply_destinations
        (intern_id, cohort_id, destination_name, destination_type, location, customer_segments, demand_status,
         demand_hypothesis, demand_evidence, mobility_requirements, vehicle_categories, driver_requirements,
         fleet_requirements, yalla_products, supplier_pipeline, activation_strategy, operational_risks,
         completeness, status, reviewed_at, is_demo)
      values (v_intern, v_cohort,
        'DEMO Destination ' || i || '-' || j || ' · ' || (array['JKIA','Wilson Airport','Nairobi CBD','Upper Hill','Westlands hotels','Naivasha conference belt','Maasai Mara gateway','Industrial Area logistics hub','USIU campus','Two Rivers'])[1 + (j % 10)],
        (array['airport','business district','hotel cluster','conference venue','tourism destination','logistics hub','university','shopping centre'])[1 + (j % 8)],
        'Nairobi Metro / Kenya',
        array['Corporate','Travellers','Tourists','Logistics clients'],
        'UNVERIFIED',
        'Recurring inbound and outbound mobility demand indicated by field observation — DEMO, unverified.',
        'Field visit notes and supplier interviews (DEMO evidence only)',
        'Scheduled transfers, executive chauffeur cover, group movement and courier runs',
        array['Sedan','SUV','Van','Minibus','Coach'],
        'Verified chauffeurs with airport and corporate etiquette training',
        'Mixed fleet with guaranteed weekday availability',
        array['Corporate mobility','Airport transfers','Charter','Rentals & leasing','Logistics'],
        'Supplier pipeline under development — DEMO',
        'Qualify suppliers, verify documents, activate capacity, map to Yalla products',
        'Supply concentration, documentation gaps, seasonal demand variability',
        (array[100,100,85,70])[1 + (j % 4)],
        case when j % 4 in (1,2) then 'ACCEPTED' else 'SUBMITTED' end,
        case when j % 4 in (1,2) then now() - (j || ' days')::interval end,
        true);
    end loop;

    -- commercial opportunities (never verified revenue for seeded data)
    for j in 1..(case when i = 4 then 16 when i in (7,8) then 5 else 3 end) loop
      insert into public.intern_supply_opportunities
        (intern_id, cohort_id, destination_id, title, product_line, customer_segment, requirement, stage,
         estimated_value_kes, verified_revenue_kes, review_status, notes, is_demo)
      select v_intern, v_cohort,
        (select id from public.intern_supply_destinations d where d.intern_id = v_intern order by d.created_at limit 1),
        'DEMO Mobility Opportunity ' || i || '-' || lpad(j::text, 2, '0'),
        (array['Corporate mobility','Airport transfers','Charter','Rentals & leasing','Logistics','Tourism mobility'])[1 + (j % 6)],
        (array['Corporate','SME','Hotel','Tour operator','Institution'])[1 + (j % 5)],
        'Recurring mobility requirement identified in the field — DEMO',
        case when j % 3 = 0 then 'OPPORTUNITY' when j % 2 = 0 then 'QUALIFIED' else 'LEAD' end,
        (array[120000,340000,85000,560000,210000])[1 + (j % 5)],
        0,
        case when j % 2 = 0 then 'ACCEPTED' else 'SUBMITTED' end,
        'DEMO / TEST DATA — no authoritative financial record, verified revenue remains KES 0', true;
    end loop;

    -- field assignments
    for j in 1..4 loop
      insert into public.intern_supply_field_assignments
        (intern_id, cohort_id, assignment, location, scheduled_for, objective, contacts_made, records_created,
         outcomes, follow_up, supervisor_verified, verified_at, is_demo)
      values (v_intern, v_cohort,
        (array['Driver acquisition field day','Fleet mapping exercise','Airport mobility mapping','Corporate district mapping','Hotel mobility mapping','Logistics supplier mapping'])[1 + (j % 6)],
        (array['JKIA','Nairobi CBD','Industrial Area','Westlands'])[1 + (j % 4)],
        (date '2026-10-12') + (j * 14),
        'Identify and qualify mobility supply for the mapped destination — DEMO',
        (array[9,14,7,11])[j], (array[6,10,5,8])[j],
        'Prospects captured and supplier contacts logged (DEMO)',
        'Follow up on documentation within 5 working days',
        j <= 3, case when j <= 3 then now() - (j || ' days')::interval end, true);
    end loop;
  end loop;
end $seed$;
