CREATE OR REPLACE FUNCTION public.post_stock_transaction(p_txn_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_tx public.stock_txn_header%rowtype;
  v_line public.stock_txn_line%rowtype;
  v_balance public.stock_balances%rowtype;
  v_item public.item_master%rowtype;
  v_val public.stock_valuation%rowtype;
  v_uid uuid := auth.uid();
  v_in boolean;
  v_posted integer := 0;
  v_new_qty numeric;
  v_serial_net numeric;
  v_issue_cost numeric;
  v_new_value numeric;
  v_balance_qty numeric;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[]) then raise exception 'Posting role required'; end if;
  if v_tx.status='POSTED' then return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','already_posted',true); end if;
  if v_tx.status <> 'APPROVED' then raise exception 'Only APPROVED transactions can be posted'; end if;
  if v_tx.txn_type='TRANSFER' then raise exception 'Transfer posting is not enabled until source and destination locations are represented separately'; end if;
  if v_tx.txn_type not in ('OPENING','GRN','PURCHASE_RETURN','PRODUCTION_ISSUE','PRODUCTION_RETURN','SUBCON_OUT','SUBCON_IN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DISPATCH','CUSTOMER_RETURN','SCRAP') then raise exception 'Unsupported transaction type for posting'; end if;
  update public.stock_txn_header set status='POSTING', updated_at=now() where id=v_tx.id;

  for v_line in
    select * from public.stock_txn_line
    where txn_id=v_tx.id and company_id=v_tx.company_id
    order by item_id,warehouse_id,location_id,line_no
  loop
    if v_line.qty <= 0 or v_line.unit_cost < 0 or v_line.location_id is null then
      raise exception 'Line % requires positive quantity, non-negative cost, and a location',v_line.line_no;
    end if;
    select * into v_item from public.item_master i
      where i.id=v_line.item_id and i.company_id=v_tx.company_id and i.is_active=true;
    if not found then raise exception 'Line % item is inactive or belongs to another company',v_line.line_no; end if;
    if not exists(select 1 from public.warehouse_master w where w.id=v_line.warehouse_id and w.company_id=v_tx.company_id and w.is_active=true) then
      raise exception 'Line % warehouse is inactive or belongs to another company',v_line.line_no;
    end if;
    if not exists(select 1 from public.location_master loc where loc.id=v_line.location_id and loc.warehouse_id=v_line.warehouse_id and loc.company_id=v_tx.company_id and loc.is_active=true) then
      raise exception 'Line % location is inactive or does not belong to the selected warehouse/company',v_line.line_no;
    end if;
    if v_item.is_batch_tracked and nullif(btrim(v_line.lot_number),'') is null then
      raise exception 'Line % requires a batch/lot number for this item',v_line.line_no;
    end if;
    v_in := v_tx.txn_type in ('OPENING','GRN','PRODUCTION_RETURN','SUBCON_IN','ADJUSTMENT_IN','CUSTOMER_RETURN');
    if v_item.is_serial_tracked then
      if nullif(btrim(v_line.serial_number),'') is null then raise exception 'Line % requires a serial number for this item',v_line.line_no; end if;
      if v_line.qty <> 1 then raise exception 'Line % is serial-tracked; use one unit per serial-number line',v_line.line_no; end if;
      -- Serialize competing posts for the same company/item/serial before checking ledger availability.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tx.company_id::text || ':' || v_line.item_id::text || ':' || btrim(v_line.serial_number), 0));
      if v_in then
        -- A serial may only be received once while it is present anywhere in the company.
        select coalesce(sum(sl.qty_in_base-sl.qty_out_base),0) into v_serial_net
          from public.stock_ledger sl
          where sl.company_id=v_tx.company_id and sl.item_id=v_line.item_id and sl.serial_number=btrim(v_line.serial_number);
        if v_serial_net > 0 then raise exception 'Serial number % already exists in available stock',v_line.serial_number; end if;
      else
        -- Outbound serial validation must match the exact warehouse/location being issued.
        select coalesce(sum(sl.qty_in_base-sl.qty_out_base),0) into v_serial_net
          from public.stock_ledger sl
          where sl.company_id=v_tx.company_id and sl.item_id=v_line.item_id
            and sl.warehouse_id=v_line.warehouse_id and sl.location_id=v_line.location_id
            and sl.serial_number=btrim(v_line.serial_number);
        if v_serial_net < 1 then raise exception 'Serial number % is not available at the selected location',v_line.serial_number; end if;
      end if;
    end if;

    insert into public.stock_valuation(company_id,item_id,valuation_method,valuation_status,qty_on_hand_base,inventory_value)
    values(v_tx.company_id,v_line.item_id,'WEIGHTED_AVERAGE','UNINITIALIZED',0,0)
    on conflict(company_id,item_id) do nothing;
    select * into v_val from public.stock_valuation
      where company_id=v_tx.company_id and item_id=v_line.item_id for update;

    -- Fail closed if legacy/location balances and company-item valuation disagree.
    -- Do not let a new receipt silently label unvalued legacy stock as reconciled.
    select coalesce(sum(sb.qty_on_hand_base),0) into v_balance_qty
      from public.stock_balances sb
      where sb.company_id=v_tx.company_id and sb.item_id=v_line.item_id;
    if v_balance_qty <> v_val.qty_on_hand_base then
      raise exception 'Stock quantity (%) and valued quantity (%) differ for item on line %; reconcile opening valuation before posting', v_balance_qty, v_val.qty_on_hand_base, v_line.line_no;
    end if;

    if v_in then
      v_new_qty := v_val.qty_on_hand_base + v_line.qty;
      v_new_value := v_val.inventory_value + (v_line.qty * v_line.unit_cost);
      update public.stock_valuation
        set qty_on_hand_base=v_new_qty,
            inventory_value=case when v_new_qty=0 then 0 else v_new_value end,
            valuation_status='RECONCILED',
            last_valuation_at=now(),updated_at=now(),updated_by=v_uid
        where company_id=v_tx.company_id and item_id=v_line.item_id;

      insert into public.stock_balances(company_id,item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base,last_movement_at,updated_at)
      values(v_tx.company_id,v_line.item_id,v_line.warehouse_id,v_line.location_id,v_line.qty,0,v_line.qty,now(),now())
      on conflict(company_id,item_id,warehouse_id,location_id) do update
        set qty_on_hand_base=public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base,
            qty_available_base=(public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base)-public.stock_balances.qty_reserved_base,
            last_movement_at=now(),updated_at=now();

      insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
      values(v_tx.company_id,v_tx.id,v_line.line_no,v_line.item_id,v_line.warehouse_id,v_line.location_id,v_line.qty,0,v_line.unit_cost,v_line.lot_number,v_line.serial_number,v_line.line_remarks,v_uid);
    else
      select * into v_balance from public.stock_balances
        where company_id=v_tx.company_id and item_id=v_line.item_id and warehouse_id=v_line.warehouse_id and location_id=v_line.location_id for update;
      if not found then raise exception 'Insufficient stock for item on line %: no balance exists at selected location',v_line.line_no; end if;
      if (v_balance.qty_on_hand_base-v_balance.qty_reserved_base) < v_line.qty then
        raise exception 'Insufficient available stock for line %: on hand %, reserved %, requested %',v_line.line_no,v_balance.qty_on_hand_base,v_balance.qty_reserved_base,v_line.qty;
      end if;
      if v_val.valuation_status='UNINITIALIZED' or v_val.qty_on_hand_base < v_line.qty then
        raise exception 'Valuation is not initialized or has insufficient valued quantity for item on line %; reconcile opening stock valuation first',v_line.line_no;
      end if;
      v_issue_cost := v_val.inventory_value / v_val.qty_on_hand_base;
      v_new_qty := v_val.qty_on_hand_base-v_line.qty;
      v_new_value := case when v_new_qty=0 then 0 else greatest(0,v_val.inventory_value-(v_line.qty*v_issue_cost)) end;
      update public.stock_valuation
        set qty_on_hand_base=v_new_qty,inventory_value=v_new_value,
            valuation_status='RECONCILED',last_valuation_at=now(),updated_at=now(),updated_by=v_uid
        where company_id=v_tx.company_id and item_id=v_line.item_id;

      update public.stock_balances
        set qty_on_hand_base=v_balance.qty_on_hand_base-v_line.qty,
            qty_available_base=(v_balance.qty_on_hand_base-v_line.qty)-v_balance.qty_reserved_base,
            last_movement_at=now(),updated_at=now()
        where company_id=v_tx.company_id and item_id=v_line.item_id and warehouse_id=v_line.warehouse_id and location_id=v_line.location_id;

      insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
      values(v_tx.company_id,v_tx.id,v_line.line_no,v_line.item_id,v_line.warehouse_id,v_line.location_id,0,v_line.qty,v_issue_cost,v_line.lot_number,v_line.serial_number,v_line.line_remarks,v_uid);
    end if;
    v_posted := v_posted+1;
  end loop;
  if v_posted=0 then raise exception 'No transaction lines found'; end if;
  update public.stock_txn_header set status='POSTED',posted_by=v_uid,posted_at=now(),updated_at=now() where id=v_tx.id;
  return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','lines_posted',v_posted);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.post_stock_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_transaction(uuid) TO authenticated;
