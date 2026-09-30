ALTER TABLE public.rec_candidate_documents
  DROP CONSTRAINT rec_candidate_documents_doc_type_check;

ALTER TABLE public.rec_candidate_documents
  ADD CONSTRAINT rec_candidate_documents_doc_type_check
  CHECK (doc_type IN (
    'cv',
    'cover_letter',
    'certificate',
    'identification',
    'offer_letter',
    'contract',
    'onboarding',
    'other',
    'supporting'
  ));