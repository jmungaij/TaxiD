CREATE OR REPLACE FUNCTION private.driver_doc_checklist()
 RETURNS TABLE(code text, label text, mandatory boolean)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  VALUES
    ('NATIONAL_ID','National ID (both sides)', false),
    ('PASSPORT','Passport (instead of National ID)', false),
    ('DRIVING_LICENCE','Driving licence', true),
    ('PSV_BADGE','PSV badge', true),
    ('GOOD_CONDUCT','Certificate of good conduct', true),
    ('FULL_PHOTO','Full-size photograph', true),
    ('KRA_PIN','KRA PIN certificate', true),
    ('VEHICLE_LOGBOOK','Vehicle logbook', true),
    ('INSURANCE_STICKER','PSV comprehensive insurance sticker', true)
$function$;