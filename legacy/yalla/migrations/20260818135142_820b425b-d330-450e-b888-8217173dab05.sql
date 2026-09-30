UPDATE auth.users
SET email_confirmed_at = now(), updated_at = now()
WHERE email IN ('jmungai@yalla.africa','charles.gateru@yalla.africa')
  AND email_confirmed_at IS NULL;