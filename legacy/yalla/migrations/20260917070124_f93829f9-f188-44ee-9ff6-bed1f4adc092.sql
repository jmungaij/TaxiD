CREATE POLICY partner_applications_sales_read
  ON public.partner_applications
  FOR SELECT
  TO authenticated
  USING (public.has_staff_permission('staff.crm.read'));