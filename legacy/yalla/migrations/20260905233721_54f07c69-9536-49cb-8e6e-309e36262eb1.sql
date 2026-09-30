UPDATE public.rec_blueprints b
   SET document_requirements = COALESCE((
         SELECT jsonb_agg(jsonb_set(e, '{required}', 'false'::jsonb))
           FROM jsonb_array_elements(b.document_requirements) e), '[]'::jsonb)
 WHERE b.document_requirements IS NOT NULL
   AND jsonb_typeof(b.document_requirements) = 'array'
   AND jsonb_array_length(b.document_requirements) > 0
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(b.document_requirements) e
      WHERE COALESCE((e->>'required')::boolean, false));