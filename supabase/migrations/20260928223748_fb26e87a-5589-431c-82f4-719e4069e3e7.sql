CREATE OR REPLACE FUNCTION public.ensure_rider_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text := lower(coalesce(auth.jwt()->>'email',''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF v_email = 'jmungai@taxid.us' AND coalesce((auth.jwt()->'user_metadata'->>'email_verified')::boolean, auth.jwt()->>'email_confirmed_at' IS NOT NULL, true) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN;
  END IF;
  INSERT INTO public.rider_profiles (user_id, email, display_name)
  VALUES (v_uid, v_email, split_part(v_email,'@',1)) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.wallets (user_id, wallet_type) VALUES (v_uid, 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'rider') ON CONFLICT DO NOTHING;
END $$;