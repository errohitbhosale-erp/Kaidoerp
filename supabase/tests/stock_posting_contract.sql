-- Regression contract checks for the stock posting RPC.
-- Safe to run against a disposable/test database after migrations are applied.
-- These checks inspect the deployed function contract; they do not create or post transactions.
DO $test$
DECLARE
  v_definition text;
  v_save_definition text;
  v_submit_definition text;
  v_approve_definition text;
  v_anon_can_execute boolean;
  v_authenticated_can_execute boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.post_stock_transaction(uuid)'::regprocedure)
    INTO v_definition;

  SELECT pg_catalog.pg_get_functiondef('public.save_stock_transaction_draft(uuid,uuid,text,text,timestamp with time zone,text,text,text,text,jsonb)'::regprocedure)
    INTO v_save_definition;
  SELECT pg_catalog.pg_get_functiondef('public.submit_stock_transaction(uuid)'::regprocedure)
    INTO v_submit_definition;
  SELECT pg_catalog.pg_get_functiondef('public.approve_stock_transaction(uuid)'::regprocedure)
    INTO v_approve_definition;

  IF v_save_definition NOT LIKE '%Authentication required%' OR v_save_definition NOT LIKE '%current_user_has_company_role%' THEN
    RAISE EXCEPTION 'Draft save must authenticate and authorize company access';
  END IF;
  IF v_save_definition NOT LIKE '%idempotent_replay%' THEN
    RAISE EXCEPTION 'Draft save must be retry-safe for an existing document number';
  END IF;
  IF v_save_definition NOT LIKE '%Only DRAFT transactions can be edited%' THEN
    RAISE EXCEPTION 'Only drafts may be edited';
  END IF;
  IF v_submit_definition NOT LIKE '%Authentication required%' OR v_submit_definition NOT LIKE '%current_user_has_company_role%' THEN
    RAISE EXCEPTION 'Submission must authenticate and authorize company access';
  END IF;
  IF v_submit_definition NOT LIKE '%Only DRAFT transactions can be submitted%' THEN
    RAISE EXCEPTION 'Only drafts may be submitted';
  END IF;
  IF v_submit_definition NOT LIKE '%batch%' OR v_submit_definition NOT LIKE '%serial%' THEN
    RAISE EXCEPTION 'Submission must validate batch and serial tracking';
  END IF;
  IF v_approve_definition NOT LIKE '%Only pending transactions can be approved%' OR v_approve_definition NOT LIKE '%A different user must approve this transaction%' THEN
    RAISE EXCEPTION 'Approval must require pending status and separation of duties';
  END IF;

  IF v_definition NOT LIKE '%Authentication required%' THEN
    RAISE EXCEPTION 'Posting RPC must reject unauthenticated calls';
  END IF;
  IF v_definition NOT LIKE '%current_user_has_company_role%' THEN
    RAISE EXCEPTION 'Posting RPC must enforce company role authorization';
  END IF;
  IF v_definition NOT LIKE '%Only APPROVED transactions can be posted%' THEN
    RAISE EXCEPTION 'Posting RPC must only post approved transactions';
  END IF;
  IF v_definition NOT LIKE '%Insufficient quantity in batch%' OR v_definition NOT LIKE '%sl.lot_number=btrim(v_line.lot_number)%' THEN
    RAISE EXCEPTION 'Posting RPC must validate available batch quantity for the selected lot/location';
  END IF;
  IF v_definition NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'Posting RPC must serialize concurrent operations for the same serial';
  END IF;
  IF v_definition NOT LIKE '%sl.warehouse_id=v_line.warehouse_id and sl.location_id=v_line.location_id%' THEN
    RAISE EXCEPTION 'Outbound serial validation must be scoped to the selected warehouse/location';
  END IF;
  IF v_definition NOT LIKE '%Stock quantity (%) and valued quantity (%) differ%' THEN
    RAISE EXCEPTION 'Posting RPC must guard valuation against stock-balance mismatches';
  END IF;
  IF v_definition NOT LIKE '%WEIGHTED_AVERAGE%' OR v_definition NOT LIKE '%v_issue_cost := v_val.inventory_value / v_val.qty_on_hand_base%' THEN
    RAISE EXCEPTION 'Posting RPC must apply weighted-average issue costing';
  END IF;
  IF v_definition NOT LIKE '%already_posted%' THEN
    RAISE EXCEPTION 'Posting RPC must be idempotent for already-posted documents';
  END IF;

  IF v_definition LIKE '%insert into public.stock_balances(company_id,item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base%' THEN
    RAISE EXCEPTION 'Posting RPC must not insert into generated qty_available_base';
  END IF;
  IF v_definition LIKE '%qty_available_base=(public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base)%' THEN
    RAISE EXCEPTION 'Posting RPC must not assign generated qty_available_base on conflict';
  END IF;

  SELECT
    pg_catalog.has_function_privilege('anon', 'public.post_stock_transaction(uuid)', 'EXECUTE'),
    pg_catalog.has_function_privilege('authenticated', 'public.post_stock_transaction(uuid)', 'EXECUTE')
  INTO v_anon_can_execute, v_authenticated_can_execute;

  IF v_anon_can_execute THEN
    RAISE EXCEPTION 'Anonymous role must not execute the posting RPC';
  END IF;
  IF NOT v_authenticated_can_execute THEN
    RAISE EXCEPTION 'Authenticated role must be able to call the posting RPC';
  END IF;
END
$test$;
