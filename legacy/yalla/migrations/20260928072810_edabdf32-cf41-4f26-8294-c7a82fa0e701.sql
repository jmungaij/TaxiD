CREATE POLICY "Requester replies on own case"
ON public.support_case_notes FOR INSERT TO authenticated
WITH CHECK (
  author_user_id = auth.uid()
  AND visibility = 'customer'
  AND EXISTS (SELECT 1 FROM public.support_cases c WHERE c.id = case_id AND c.requester_user_id = auth.uid())
);