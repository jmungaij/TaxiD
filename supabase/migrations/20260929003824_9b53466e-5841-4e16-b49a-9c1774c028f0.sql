GRANT UPDATE ON public.trip_bookings TO authenticated;

CREATE POLICY "Staff update bookings"
ON public.trip_bookings
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));