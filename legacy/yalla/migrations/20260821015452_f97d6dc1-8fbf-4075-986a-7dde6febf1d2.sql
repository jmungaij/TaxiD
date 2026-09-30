-- Internship applications: an applicant may not have declared a qualification
-- level or programme title yet. These are self-declared facts, so store them as
-- unknown rather than blocking the application or inventing a value.
ALTER TABLE public.intern_academic_profiles
  ALTER COLUMN qualification_level DROP NOT NULL,
  ALTER COLUMN programme DROP NOT NULL,
  ALTER COLUMN institution DROP NOT NULL;