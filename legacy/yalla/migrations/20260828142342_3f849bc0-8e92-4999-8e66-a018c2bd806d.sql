ALTER TABLE public.logistics_hubs DROP CONSTRAINT IF EXISTS logistics_hubs_capabilities_chk;
ALTER TABLE public.logistics_hubs ADD CONSTRAINT logistics_hubs_capabilities_chk
  CHECK (capabilities <@ ARRAY['receiving','sorting','staging','cross_dock','dispatch','storage',
                               'returns_processing','cold_chain','gate','pick','pack']::text[]);