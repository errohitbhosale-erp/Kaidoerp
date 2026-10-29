-- Regression contract checks for database-enforced warehouse/location hierarchy.
-- These assertions do not create or modify operational records.
DO $test$
DECLARE
  v_definition text;
  v_trigger_count integer;
  v_rls_enabled boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.validate_location_master_hierarchy()'::regprocedure)
    INTO v_definition;

  IF v_definition NOT LIKE '%A location cannot be its own parent%' THEN
    RAISE EXCEPTION 'Hierarchy trigger must reject self-parenting';
  END IF;
  IF v_definition NOT LIKE '%Parent location must belong to the same company and warehouse%' THEN
    RAISE EXCEPTION 'Hierarchy trigger must enforce same company and warehouse';
  END IF;
  IF v_definition NOT LIKE '%A location cannot be placed under one of its descendants%' THEN
    RAISE EXCEPTION 'Hierarchy trigger must reject cycles';
  END IF;

  SELECT count(*)
    INTO v_trigger_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'location_master'
     AND t.tgname = 'trg_validate_location_master_hierarchy'
     AND NOT t.tgisinternal
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 4) = 4
     AND (t.tgtype & 16) = 16;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'Expected hierarchy trigger on INSERT and row-level operations';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls_enabled
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'location_master';

  IF NOT coalesce(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'Location master must retain row-level security';
  END IF;
END
$test$;
