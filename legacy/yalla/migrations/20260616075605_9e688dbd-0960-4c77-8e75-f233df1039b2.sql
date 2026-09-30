
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='app_role' AND e.enumlabel='compliance_admin') THEN
    ALTER TYPE app_role ADD VALUE 'compliance_admin';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='app_role' AND e.enumlabel='fleet_owner') THEN
    ALTER TYPE app_role ADD VALUE 'fleet_owner';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='app_role' AND e.enumlabel='driver') THEN
    ALTER TYPE app_role ADD VALUE 'driver';
  END IF;
END $$;

DO $$ BEGIN CREATE TYPE driver_type AS ENUM ('individual','fleet_driver','corporate_driver'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE driver_status AS ENUM ('draft','pending','active','suspended','deactivated','blacklisted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE doc_verification_status AS ENUM ('not_submitted','pending','in_review','approved','rejected','resubmission_required','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE vehicle_status_t AS ENUM ('draft','pending','active','inactive','suspended','retired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE assignment_status AS ENUM ('active','pending','ended','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inspection_result AS ENUM ('pass','conditional','fail','pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE incident_severity AS ENUM ('low','medium','high','critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
