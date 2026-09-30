
CREATE TABLE public.corporate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  document_number text,
  expiry_date date,
  storage_path text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewer_notes text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corporate_documents_status_chk
    CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT corporate_documents_doc_type_chk
    CHECK (doc_type IN (
      'business_photo','certificate_of_incorporation','contract',
      'cr12','crb_payment','crb_report','kra_pin','tax_compliance'
    )),
  CONSTRAINT corporate_documents_corp_type_uk UNIQUE (corporate_id, doc_type)
);

CREATE INDEX idx_corporate_documents_corp ON public.corporate_documents(corporate_id);
CREATE INDEX idx_corporate_documents_status ON public.corporate_documents(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_documents TO authenticated;
GRANT ALL ON public.corporate_documents TO service_role;

ALTER TABLE public.corporate_documents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_corporate_manager_or_admin(_user_id uuid, _corporate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.corporate_employees
    WHERE user_id = _user_id
      AND corporate_id = _corporate_id
      AND status = 'active'
      AND role IN ('corporate_admin','corporate_manager')
  );
$$;

CREATE POLICY "Corp members read own docs"
  ON public.corporate_documents FOR SELECT TO authenticated
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Corp members insert own docs"
  ON public.corporate_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id));

CREATE POLICY "Corp members update own docs"
  ON public.corporate_documents FOR UPDATE TO authenticated
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Corp members delete own docs"
  ON public.corporate_documents FOR DELETE TO authenticated
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_corporate_documents_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_corporate_documents_updated_at
  BEFORE UPDATE ON public.corporate_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_corporate_documents_updated_at();
