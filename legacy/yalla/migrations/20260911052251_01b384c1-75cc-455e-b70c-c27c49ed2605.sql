ALTER FUNCTION public.sales_lead_contact_link(jsonb)
  SET search_path = public, extensions;

ALTER FUNCTION public.partner_api_credential_issue(uuid, public.partner_api_environment, text, text[], text)
  SET search_path = public, extensions;

ALTER FUNCTION public.partner_api_credential_rotate(uuid, integer, text)
  SET search_path = public, extensions;

ALTER FUNCTION public.rec_profession_attempt_issue(uuid, uuid, integer)
  SET search_path = public, extensions;