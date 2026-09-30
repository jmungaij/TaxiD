CREATE OR REPLACE FUNCTION public.is_known_contact_email(_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    _email IS NOT NULL AND (
      lower(trim(_email)) LIKE '%@yalla.africa'
      OR EXISTS (SELECT 1 FROM sales_leads WHERE lower(contact_email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM crm_contacts WHERE lower(email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM partner_applications WHERE lower(contact_email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM public_meeting_bookings WHERE lower(client_email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM rec_candidates WHERE lower(email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM corporate_employees WHERE lower(email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM contact_submissions WHERE lower(email) = lower(trim(_email)))
      OR EXISTS (SELECT 1 FROM staff_members WHERE lower(work_email) = lower(trim(_email)))
    ), false)
$$;
REVOKE ALL ON FUNCTION public.is_known_contact_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_known_contact_email(text) TO service_role;