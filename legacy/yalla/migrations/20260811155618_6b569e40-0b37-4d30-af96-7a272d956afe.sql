DROP INDEX IF EXISTS public.org_objectives_seed_title_key;
DROP INDEX IF EXISTS public.staff_members_seed_no_key;
CREATE UNIQUE INDEX org_objectives_seed_title_key ON public.org_objectives (seed_batch, title);
CREATE UNIQUE INDEX staff_members_seed_no_key ON public.staff_members (seed_batch, staff_no);