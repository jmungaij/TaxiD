CREATE OR REPLACE FUNCTION public.ensure_rider_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_verified boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO v_email, v_verified FROM auth.users WHERE id = v_uid;
  IF v_email = 'ustaxid@gmail.com' AND v_verified THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  IF v_email IN ('admin@taxid.us', 'sales@taxid.us', 'taxidlimited@gmail.com') AND v_verified THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'support') ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  INSERT INTO public.rider_profiles (user_id, email, display_name)
  VALUES (v_uid, v_email, split_part(v_email,'@',1)) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.wallets (user_id, wallet_type) VALUES (v_uid, 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'rider') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.ensure_rider_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_rider_account() TO authenticated, service_role;