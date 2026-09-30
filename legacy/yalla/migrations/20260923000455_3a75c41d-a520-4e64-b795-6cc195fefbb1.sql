-- ============================================================
-- Replace USING (true) SELECT policies on reference/config tables
-- with real predicates. Writes and admin policies are untouched.
-- ============================================================

-- 1. Public reference data: only active/current/live rows are public.
DROP POLICY IF EXISTS "countries_read" ON public.countries;
CREATE POLICY "countries_read" ON public.countries FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "regions_read" ON public.regions;
CREATE POLICY "regions_read" ON public.regions FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.countries c WHERE c.id = regions.country_id AND c.is_active));

DROP POLICY IF EXISTS "lang read" ON public.languages;
CREATE POLICY "lang read" ON public.languages FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "currencies_read" ON public.currencies;
CREATE POLICY "currencies_read" ON public.currencies FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "ride_categories public read" ON public.ride_categories;
CREATE POLICY "ride_categories public read" ON public.ride_categories FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "tiers public read" ON public.driver_achievement_tiers;
CREATE POLICY "tiers public read" ON public.driver_achievement_tiers FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "incentive_programs public read" ON public.incentive_programs;
CREATE POLICY "incentive_programs public read" ON public.incentive_programs FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "privacy notices are public" ON public.rec_privacy_notices;
CREATE POLICY "privacy notices are public" ON public.rec_privacy_notices FOR SELECT TO anon, authenticated
  USING (is_current = true);

DROP POLICY IF EXISTS "launch status readable" ON public.country_launch_status;
CREATE POLICY "launch status readable" ON public.country_launch_status FOR SELECT TO anon, authenticated
  USING (status = 'live');
CREATE POLICY "launch status staff read" ON public.country_launch_status FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_platform_admin());

DROP POLICY IF EXISTS "signing keys are public trust anchors" ON public.doc_signing_keys;
CREATE POLICY "signing keys are public trust anchors" ON public.doc_signing_keys FOR SELECT TO anon, authenticated
  USING (trusted = true AND status = 'active' AND retired_at IS NULL);

DROP POLICY IF EXISTS "kyc_doc_types_read" ON public.kyc_document_types;
CREATE POLICY "kyc_doc_types_read" ON public.kyc_document_types FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "contract_public_read" ON public.rec_application_contract;
CREATE POLICY "contract_public_read" ON public.rec_application_contract FOR SELECT TO anon, authenticated
  USING (api_contract_version IS NOT NULL AND careers_build_id IS NOT NULL);

-- 2. Training library: published courses only.
DROP POLICY IF EXISTS "tco_read" ON public.training_courses;
CREATE POLICY "tco_read" ON public.training_courses FOR SELECT TO anon, authenticated
  USING (is_published = true);

DROP POLICY IF EXISTS "tc_read" ON public.training_categories;
CREATE POLICY "tc_read" ON public.training_categories FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.training_courses c
                 WHERE c.category_id = training_categories.id AND c.is_published));

DROP POLICY IF EXISTS "tmod_read" ON public.training_modules;
CREATE POLICY "tmod_read" ON public.training_modules FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.training_courses c
                 WHERE c.id = training_modules.course_id AND c.is_published));

DROP POLICY IF EXISTS "tless_read" ON public.training_lessons;
CREATE POLICY "tless_read" ON public.training_lessons FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.training_modules m
                 JOIN public.training_courses c ON c.id = m.course_id
                 WHERE m.id = training_lessons.module_id AND c.is_published));

DROP POLICY IF EXISTS "tvid_read" ON public.training_videos;
CREATE POLICY "tvid_read" ON public.training_videos FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.training_lessons l
                 JOIN public.training_modules m ON m.id = l.module_id
                 JOIN public.training_courses c ON c.id = m.course_id
                 WHERE l.id = training_videos.lesson_id AND c.is_published));

DROP POLICY IF EXISTS "tdoc_read" ON public.training_documents;
CREATE POLICY "tdoc_read" ON public.training_documents FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.training_lessons l
                 JOIN public.training_modules m ON m.id = l.module_id
                 JOIN public.training_courses c ON c.id = m.course_id
                 WHERE l.id = training_documents.lesson_id AND c.is_published));

DROP POLICY IF EXISTS "tassess_read" ON public.training_assessments;
CREATE POLICY "tassess_read" ON public.training_assessments FOR SELECT TO authenticated
  USING (is_active = true);

-- 3. Operational and internal registers: staff/finance/compliance only.
DROP POLICY IF EXISTS "settlement settings readable by signed in" ON public.provider_settlement_settings;
CREATE POLICY "settlement settings readable by signed in" ON public.provider_settlement_settings FOR SELECT TO authenticated
  USING (public.is_platform_admin()
         OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'finance_admin'::app_role]));

DROP POLICY IF EXISTS "fx_read" ON public.exchange_rates;
CREATE POLICY "fx_read" ON public.exchange_rates FOR SELECT TO authenticated
  USING (public.is_staff_member()
         OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'finance_admin'::app_role]));

DROP POLICY IF EXISTS "taxfw read" ON public.tax_frameworks;
CREATE POLICY "taxfw read" ON public.tax_frameworks FOR SELECT TO authenticated
  USING (active = true AND (public.is_staff_member() OR public.is_platform_admin()));

DROP POLICY IF EXISTS "regf_read" ON public.regulatory_frameworks;
CREATE POLICY "regf_read" ON public.regulatory_frameworks FOR SELECT TO authenticated
  USING ((effective_to IS NULL OR effective_to >= CURRENT_DATE)
         AND (public.is_staff_member() OR public.is_platform_admin()));

DROP POLICY IF EXISTS "cdr_read" ON public.country_document_requirements;
CREATE POLICY "cdr_read" ON public.country_document_requirements FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_platform_admin());

DROP POLICY IF EXISTS "leg_transitions_read" ON public.logistics_leg_transitions;
CREATE POLICY "leg_transitions_read" ON public.logistics_leg_transitions FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_platform_admin());

DROP POLICY IF EXISTS "offline_command_types_read" ON public.logistics_offline_command_types;
CREATE POLICY "offline_command_types_read" ON public.logistics_offline_command_types FOR SELECT TO authenticated
  USING (offline_allowed = true AND (public.is_staff_member() OR public.is_platform_admin()));

DROP POLICY IF EXISTS "rename_flag_read_any_authenticated" ON public.rename_feature_flag;
CREATE POLICY "rename_flag_read_any_authenticated" ON public.rename_feature_flag FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_platform_admin());

DROP POLICY IF EXISTS "Authenticated read reason codes" ON public.rec_rejection_reasons;
CREATE POLICY "Authenticated read reason codes" ON public.rec_rejection_reasons FOR SELECT TO authenticated
  USING (is_active = true AND (public.is_staff_member() OR public.is_platform_admin()));

DROP POLICY IF EXISTS "por_read" ON public.partner_onboarding_requirements;
CREATE POLICY "por_read" ON public.partner_onboarding_requirements FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "lifecycle_stages_read" ON public.driver_lifecycle_stages;
CREATE POLICY "lifecycle_stages_read" ON public.driver_lifecycle_stages FOR SELECT TO authenticated
  USING (public.is_staff_member()
         OR public.is_platform_admin()
         OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = auth.uid()));

-- 4. Marketplace dispatch grids: signed-in, active/fresh rows only.
DROP POLICY IF EXISTS "zones readable" ON public.marketplace_dispatch_zones;
CREATE POLICY "zones readable" ON public.marketplace_dispatch_zones FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "hex cells readable by all" ON public.marketplace_hex_cells;
CREATE POLICY "hex cells readable by all" ON public.marketplace_hex_cells FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "heatmap readable" ON public.marketplace_heatmap_tiles;
CREATE POLICY "heatmap readable" ON public.marketplace_heatmap_tiles FOR SELECT TO authenticated
  USING (computed_at >= now() - interval '24 hours');

-- 5. Intern programme content: programme authorities, staff and the interns themselves.
DROP POLICY IF EXISTS "intern_programmes_read" ON public.intern_programmes;
CREATE POLICY "intern_programmes_read" ON public.intern_programmes FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid())
         OR public.is_staff_member()
         OR EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.user_id = auth.uid()));

DROP POLICY IF EXISTS "intern_tracks_read" ON public.intern_tracks;
CREATE POLICY "intern_tracks_read" ON public.intern_tracks FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid())
         OR public.is_staff_member()
         OR EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.user_id = auth.uid()));

DROP POLICY IF EXISTS "intern_cohorts_read" ON public.intern_cohorts;
CREATE POLICY "intern_cohorts_read" ON public.intern_cohorts FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid())
         OR public.is_staff_member()
         OR EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.user_id = auth.uid()));

DROP POLICY IF EXISTS "intern_modules_read" ON public.intern_learning_modules;
CREATE POLICY "intern_modules_read" ON public.intern_learning_modules FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid())
         OR public.is_staff_member()
         OR EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.user_id = auth.uid()));

DROP POLICY IF EXISTS "course_comp_read" ON public.intern_course_competencies;
CREATE POLICY "course_comp_read" ON public.intern_course_competencies FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())
         OR public.is_staff_member()
         OR EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.user_id = auth.uid()));