INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'operations_admin'::app_role
FROM auth.users u WHERE u.email = 'jmungai@yalla.africa'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'finance_admin'::app_role
FROM auth.users u WHERE u.email = 'charles.gateru@yalla.africa'
ON CONFLICT (user_id, role) DO NOTHING;