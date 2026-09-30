CREATE OR REPLACE FUNCTION public.ensure_my_wallet(_wallet_type public.wallet_type)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF _wallet_type NOT IN ('personal', 'driver') THEN
    RAISE EXCEPTION 'unsupported_wallet_type';
  END IF;
  SELECT id INTO v_id FROM public.wallets
  WHERE user_id = auth.uid() AND wallet_type = _wallet_type;
  IF v_id IS NULL THEN
    INSERT INTO public.wallets (user_id, wallet_type)
    VALUES (auth.uid(), _wallet_type)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_my_wallet(public.wallet_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_wallet(public.wallet_type) TO authenticated;