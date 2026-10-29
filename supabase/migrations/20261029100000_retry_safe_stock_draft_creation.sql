-- Make stock draft creation safe to retry after a lost client response.
-- Reuse the same document number for the lifetime of the create form.
-- Atomically create or replace a stock transaction draft and all of its lines.
-- No stock balances or ledger records are changed by this function.
CREATE OR REPLACE FUNCTION public.save_stock_transaction_draft(
  p_txn_id uuid, p_company_id uuid, p_document_no text, p_txn_type text,
  p_txn_date timestamptz, p_reference_no text, p_source_document_type text,
  p_source_document_no text, p_remarks text, p_lines jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tx public.stock_txn_header%rowtype;
  v_line jsonb;
  v_line_no integer := 0;
  v_item public.item_master%rowtype;
  v_warehouse public.warehouse_master%rowtype;
  v_location public.location_master%rowtype;
  v_qty numeric; v_cost numeric;
  v_item_id uuid; v_warehouse_id uuid; v_location_id uuid;
  v_lot text; v_serial text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_company_id IS NULL OR NOT public.current_user_has_company_role(
    p_company_id, ARRAY['SUPER_ADMIN','ADMIN','STORES','PURCHASE','PRODUCTION','PLANNING','DISPATCH','SUBCONTRACT']::text[]
  ) THEN RAISE EXCEPTION 'Not authorized for this company'; END IF;
  IF p_txn_type IS NULL OR p_txn_type NOT IN ('OPENING','GRN','PRODUCTION_ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT') THEN
    RAISE EXCEPTION 'Unsupported transaction type for draft entry';
  END IF;
  IF p_txn_date IS NULL THEN RAISE EXCEPTION 'Transaction date is required'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'Add at least one transaction line';
  END IF;

  IF p_txn_id IS NULL THEN
    IF nullif(btrim(p_document_no),'') IS NULL THEN RAISE EXCEPTION 'Document number is required'; END IF;
    SELECT * INTO v_tx
    FROM public.stock_txn_header
    WHERE company_id=p_company_id AND document_no=btrim(p_document_no)
    FOR UPDATE;
    IF FOUND THEN
      IF v_tx.created_by IS DISTINCT FROM v_uid OR v_tx.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Document number already exists; refresh the register and use the existing document';
      END IF;
      RETURN jsonb_build_object('txn_id',v_tx.id,'status',v_tx.status,'idempotent_replay',true);
    END IF;
  END IF;

  IF p_txn_id IS NOT NULL THEN
    SELECT * INTO v_tx FROM public.stock_txn_header WHERE id=p_txn_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
    IF v_tx.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'Company mismatch'; END IF;
    IF v_tx.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT transactions can be edited'; END IF;
    IF v_tx.created_by IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Only the draft creator can edit this transaction'; END IF;
    UPDATE public.stock_txn_header SET txn_type=p_txn_type, txn_date=p_txn_date,
      reference_no=nullif(btrim(p_reference_no),''), source_document_type=nullif(btrim(p_source_document_type),''),
      source_document_no=nullif(btrim(p_source_document_no),''), remarks=nullif(btrim(p_remarks),''), updated_at=now()
      WHERE id=p_txn_id AND company_id=p_company_id AND status='DRAFT';
    DELETE FROM public.stock_txn_line WHERE txn_id=p_txn_id AND company_id=p_company_id;
  ELSE
    IF nullif(btrim(p_document_no),'') IS NULL THEN RAISE EXCEPTION 'Document number is required'; END IF;
    INSERT INTO public.stock_txn_header(company_id,document_no,txn_type,txn_date,status,source_document_type,
      source_document_no,reference_no,remarks,idempotency_key,created_by)
    VALUES(p_company_id,btrim(p_document_no),p_txn_type,p_txn_date,'DRAFT',
      nullif(btrim(p_source_document_type),''),nullif(btrim(p_source_document_no),''),
      nullif(btrim(p_reference_no),''),nullif(btrim(p_remarks),''),pg_catalog.gen_random_uuid()::text,v_uid)
    RETURNING * INTO v_tx;
    p_txn_id := v_tx.id;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_no := v_line_no + 1;
    BEGIN
      v_item_id := (v_line->>'item_id')::uuid;
      v_warehouse_id := (v_line->>'warehouse_id')::uuid;
      v_location_id := nullif(v_line->>'location_id','')::uuid;
      v_qty := (v_line->>'qty')::numeric; v_cost := (v_line->>'unit_cost')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Line % contains an invalid item, warehouse, location, quantity or cost',v_line_no;
    END;
    IF v_qty IS NULL OR v_qty <= 0 OR v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Line % requires positive quantity and non-negative unit cost',v_line_no;
    END IF;
    IF v_location_id IS NULL THEN RAISE EXCEPTION 'Line % requires a location/bin',v_line_no; END IF;
    SELECT * INTO v_item FROM public.item_master WHERE id=v_item_id AND company_id=p_company_id AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line % item is inactive or belongs to another company',v_line_no; END IF;
    SELECT * INTO v_warehouse FROM public.warehouse_master WHERE id=v_warehouse_id AND company_id=p_company_id AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line % warehouse is inactive or belongs to another company',v_line_no; END IF;
    SELECT * INTO v_location FROM public.location_master WHERE id=v_location_id AND warehouse_id=v_warehouse_id AND company_id=p_company_id AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line % location is inactive or does not belong to the selected warehouse/company',v_line_no; END IF;
    v_lot := nullif(btrim(v_line->>'lot_number'),''); v_serial := nullif(btrim(v_line->>'serial_number'),'');
    IF v_item.is_batch_tracked AND v_lot IS NULL THEN RAISE EXCEPTION 'Line % requires a batch/lot number',v_line_no; END IF;
    IF v_item.is_serial_tracked AND v_serial IS NULL THEN RAISE EXCEPTION 'Line % requires a serial number',v_line_no; END IF;
    IF v_item.is_serial_tracked AND v_qty <> 1 THEN RAISE EXCEPTION 'Line % is serial-tracked; use one unit per serial-number line',v_line_no; END IF;
    INSERT INTO public.stock_txn_line(company_id,txn_id,line_no,item_id,warehouse_id,location_id,qty,unit_cost,lot_number,serial_number,line_remarks,created_by)
    VALUES(p_company_id,p_txn_id,v_line_no,v_item_id,v_warehouse_id,v_location_id,v_qty,v_cost,v_lot,v_serial,
      nullif(btrim(v_line->>'line_remarks'),''),v_uid);
  END LOOP;
  RETURN jsonb_build_object('txn_id',p_txn_id,'status','DRAFT','lines_saved',v_line_no);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_stock_transaction_draft(uuid,uuid,text,text,timestamptz,text,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_transaction_draft(uuid,uuid,text,text,timestamptz,text,text,text,text,jsonb) TO authenticated;
