CREATE TABLE public.rider_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  phone_number text,
  status text NOT NULL DEFAULT 'invited',
  welcome_credit_cents bigint NOT NULL DEFAULT 0,
  credit_reason text,
  credit_applied_at timestamptz,
  is_test boolean NOT NULL DEFAULT false,
  invited_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  claimed_user_id uuid,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rider_inv_status CHECK (status IN ('invited','approved','rejected','claimed')),
  CONSTRAINT rider_inv_credit CHECK (welcome_credit_cents BETWEEN 0 AND 500000)
);
CREATE UNIQUE INDEX rider_invitations_email_uq ON public.rider_invitations (lower(email));
GRANT SELECT ON public.rider_invitations TO authenticated;
GRANT ALL ON public.rider_invitations TO service_role;
ALTER TABLE public.rider_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rider invitations" ON public.rider_invitations FOR SELECT TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'support'::app_role]));
CREATE TRIGGER tg_rider_invitations_updated BEFORE UPDATE ON public.rider_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION private.rider_invite(_email text, _full_name text, _phone text, _is_test boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'support'::app_role]) THEN
    RAISE EXCEPTION 'Not allowed'; END IF;
  IF _email IS NULL OR _email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'A valid email is required'; END IF;
  INSERT INTO rider_invitations(email, full_name, phone_number, is_test, invited_by)
  VALUES (lower(trim(_email)), nullif(trim(_full_name),''), nullif(trim(_phone),''), coalesce(_is_test,false), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION private.rider_invite_decide(_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]) THEN
    RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE rider_invitations SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now()
  WHERE id = _id AND status IN ('invited','approved','rejected');
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found or already claimed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION private.rider_apply_credit(_inv rider_invitations, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w uuid;
BEGIN
  IF _inv.welcome_credit_cents <= 0 OR _inv.credit_applied_at IS NOT NULL OR _inv.status NOT IN ('approved','claimed') THEN RETURN; END IF;
  INSERT INTO wallets(user_id, wallet_type) VALUES (_user, 'personal')
    ON CONFLICT (user_id, wallet_type) DO NOTHING;
  SELECT id INTO _w FROM wallets WHERE user_id = _user AND wallet_type = 'personal';
  INSERT INTO wallet_transactions(wallet_id, user_id, direction, amount_cents, kind, status, reference, metadata)
  VALUES (_w, _user, 'credit', _inv.welcome_credit_cents, 'adjustment', 'completed', 'WELCOME-' || left(_inv.id::text,8),
    jsonb_build_object('source','rider_invitation','invitation_id',_inv.id,'reason',_inv.credit_reason,'is_test',_inv.is_test));
  UPDATE wallets SET balance_cents = balance_cents + _inv.welcome_credit_cents WHERE id = _w;
  UPDATE rider_invitations SET credit_applied_at = now() WHERE id = _inv.id;
END $$;

CREATE OR REPLACE FUNCTION private.rider_invite_set_credit(_id uuid, _amount_kes numeric, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv rider_invitations;
BEGIN
  IF NOT private.has_role(auth.uid(), 'super_admin'::app_role) THEN RAISE EXCEPTION 'Only the super admin can add wallet credit'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _amount_kes IS NULL OR _amount_kes <= 0 OR _amount_kes > 5000 THEN RAISE EXCEPTION 'Credit must be between KES 1 and KES 5,000'; END IF;
  UPDATE rider_invitations SET welcome_credit_cents = round(_amount_kes*100)::bigint, credit_reason = trim(_reason)
  WHERE id = _id AND credit_applied_at IS NULL RETURNING * INTO _inv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found or credit already applied'; END IF;
  IF _inv.claimed_user_id IS NOT NULL THEN PERFORM private.rider_apply_credit(_inv, _inv.claimed_user_id); END IF;
END $$;

CREATE OR REPLACE FUNCTION private.rider_claim_invitation()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _email text; _inv rider_invitations;
BEGIN
  IF _uid IS NULL THEN RETURN 'none'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = _uid AND email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN RETURN 'none'; END IF;
  SELECT * INTO _inv FROM rider_invitations WHERE lower(email) = _email AND status IN ('invited','approved') AND claimed_user_id IS NULL;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  INSERT INTO rider_profiles(user_id, email, display_name, phone_number)
  VALUES (_uid, _email, coalesce(_inv.full_name, split_part(_email,'@',1)), _inv.phone_number)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE rider_invitations SET claimed_user_id = _uid, claimed_at = now(),
    status = CASE WHEN status = 'approved' THEN 'claimed' ELSE status END
  WHERE id = _inv.id RETURNING * INTO _inv;
  PERFORM private.rider_apply_credit(_inv, _uid);
  RETURN _inv.status;
END $$;

-- Approving after the rider already signed up also applies pending credit
CREATE OR REPLACE FUNCTION private.tg_rider_inv_after_approve() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.claimed_user_id IS NOT NULL THEN
    UPDATE rider_invitations SET status = 'claimed' WHERE id = NEW.id;
    PERFORM private.rider_apply_credit((SELECT r FROM rider_invitations r WHERE r.id = NEW.id), NEW.claimed_user_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tg_rider_inv_approve AFTER UPDATE OF status ON public.rider_invitations
  FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION private.tg_rider_inv_after_approve();

REVOKE ALL ON FUNCTION private.rider_invite(text,text,text,boolean), private.rider_invite_decide(uuid,boolean),
  private.rider_apply_credit(rider_invitations,uuid), private.rider_invite_set_credit(uuid,numeric,text),
  private.rider_claim_invitation(), private.tg_rider_inv_after_approve() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rider_invite(text,text,text,boolean), private.rider_invite_decide(uuid,boolean),
  private.rider_invite_set_credit(uuid,numeric,text), private.rider_claim_invitation() TO authenticated;

CREATE OR REPLACE FUNCTION public.rider_invite(_email text, _full_name text, _phone text, _is_test boolean DEFAULT false)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.rider_invite(_email,_full_name,_phone,_is_test) $$;
CREATE OR REPLACE FUNCTION public.rider_invite_decide(_id uuid, _approve boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.rider_invite_decide(_id,_approve) $$;
CREATE OR REPLACE FUNCTION public.rider_invite_set_credit(_id uuid, _amount_kes numeric, _reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.rider_invite_set_credit(_id,_amount_kes,_reason) $$;
CREATE OR REPLACE FUNCTION public.rider_claim_invitation()
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.rider_claim_invitation() $$;
REVOKE ALL ON FUNCTION public.rider_invite(text,text,text,boolean), public.rider_invite_decide(uuid,boolean),
  public.rider_invite_set_credit(uuid,numeric,text), public.rider_claim_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_invite(text,text,text,boolean), public.rider_invite_decide(uuid,boolean),
  public.rider_invite_set_credit(uuid,numeric,text), public.rider_claim_invitation() TO authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;