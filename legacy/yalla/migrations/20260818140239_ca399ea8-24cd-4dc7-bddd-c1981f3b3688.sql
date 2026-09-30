-- Leadership role assignment: jmungai = super_admin + director, charles = general_manager
DELETE FROM public.user_roles
WHERE user_id = '7a8f6644-40c8-44fa-9347-e827dade9d51'::uuid
  AND role NOT IN ('super_admin'::public.app_role, 'director'::public.app_role);

INSERT INTO public.user_roles (user_id, role)
VALUES ('7a8f6644-40c8-44fa-9347-e827dade9d51'::uuid, 'super_admin'::public.app_role),
       ('7a8f6644-40c8-44fa-9347-e827dade9d51'::uuid, 'director'::public.app_role)
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles
WHERE user_id = 'fdfacaf2-10ae-4f02-b96c-865e8fc0a3d0'::uuid
  AND role <> 'general_manager'::public.app_role;

INSERT INTO public.user_roles (user_id, role)
VALUES ('fdfacaf2-10ae-4f02-b96c-865e8fc0a3d0'::uuid, 'general_manager'::public.app_role)
ON CONFLICT (user_id, role) DO NOTHING;