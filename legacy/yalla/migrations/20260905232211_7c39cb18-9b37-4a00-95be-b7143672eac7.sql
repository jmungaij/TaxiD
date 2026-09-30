DELETE FROM public.rec_applications
WHERE candidate_id IN (
  SELECT id FROM public.rec_candidates
  WHERE email LIKE 'qa17886%@yalla.test'
);

DELETE FROM public.rec_candidates
WHERE email LIKE 'qa17886%@yalla.test'
  AND NOT EXISTS (
    SELECT 1 FROM public.rec_applications a WHERE a.candidate_id = rec_candidates.id
  );