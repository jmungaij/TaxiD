ALTER TABLE public.air_fleet ADD COLUMN IF NOT EXISTS icao24 text;
ALTER TABLE public.air_fleet DROP CONSTRAINT IF EXISTS air_fleet_icao24_format;
ALTER TABLE public.air_fleet ADD CONSTRAINT air_fleet_icao24_format CHECK (icao24 IS NULL OR icao24 ~ '^[0-9a-f]{6}$');