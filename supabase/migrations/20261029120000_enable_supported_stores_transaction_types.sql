-- Align submission allowlist with transaction types implemented by stock posting.
CREATE OR REPLACE FUNCTION public.submit_stock_transaction(p_txn_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tx public.stock_txn_header%rowtype;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_tx FROM public.stock_txn_header WHERE id=p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF NOT public.current_user_has_company_role(v_tx.company_id, ARRAY['SUPER_ADMIN','ADMIN','STORES','PURCHASE','PRODUCTION','PLANNING','DISPATCH','SUBCONTRACT']::text[]) THEN RAISE EXCEPTION 'Not authorized for this company'; END IF;
  IF v_tx.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT transactions can be submitted'; END IF;
  IF v_tx.created_by IS DISTINCT FROM v_uid AND NOT public.current_user_has_company_role(v_tx.company_id, ARRAY['SUPER_ADMIN','ADMIN']::text[]) THEN RAISE EXCEPTION 'Only the creator or an administrator may submit this draft'; END IF;
  IF v_tx.txn_type NOT IN ('OPENING','GRN','PURCHASE_RETURN','PRODUCTION_ISSUE','PRODUCTION_RETURN','SUBCON_OUT','SUBCON_IN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DISPATCH','CUSTOMER_RETURN','SCRAP') THEN RAISE EXCEPTION 'Unsupported transaction type for submission'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_txn_line l WHERE l.txn_id=v_tx.id AND l.company_id=v_tx.company_id) THEN RAISE EXCEPTION 'Add at least one transaction line'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_txn_line l
    LEFT JOIN public.item_master i ON i.id=l.item_id AND i.company_id=l.company_id
    LEFT JOIN public.warehouse_master w ON w.id=l.warehouse_id AND w.company_id=l.company_id
    LEFT JOIN public.location_master loc ON loc.id=l.location_id AND loc.company_id=l.company_id AND loc.warehouse_id=l.warehouse_id
    WHERE l.txn_id=v_tx.id AND l.company_id=v_tx.company_id
      AND (l.qty IS NULL OR l.qty<=0 OR l.unit_cost IS NULL OR l.unit_cost<0 OR l.location_id IS NULL
        OR i.id IS NULL OR i.is_active IS DISTINCT FROM true OR w.id IS NULL OR w.is_active IS DISTINCT FROM true
        OR loc.id IS NULL OR loc.is_active IS DISTINCT FROM true
        OR (i.is_batch_tracked AND nullif(btrim(l.lot_number),'') IS NULL)
        OR (i.is_serial_tracked AND (nullif(btrim(l.serial_number),'') IS NULL OR l.qty<>1)))
  ) THEN RAISE EXCEPTION 'One or more lines are incomplete or reference inactive/invalid item, warehouse, location, batch or serial data'; END IF;
  IF v_tx.txn_type='TRANSFER' THEN RAISE EXCEPTION 'Transfer posting is not enabled yet: the transaction line model needs explicit source and destination locations'; END IF;
  UPDATE public.stock_txn_header SET status='PENDING_APPROVAL', updated_at=now() WHERE id=v_tx.id;
  RETURN jsonb_build_object('txn_id',v_tx.id,'status','PENDING_APPROVAL');
END;
$function$
;
REVOKE ALL ON FUNCTION public.submit_stock_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_stock_transaction(uuid) TO authenticated;
