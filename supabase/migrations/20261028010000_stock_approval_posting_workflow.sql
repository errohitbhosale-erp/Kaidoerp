create or replace function public.submit_stock_transaction(p_txn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.stock_txn_header%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN','STORES','PURCHASE','PRODUCTION','PLANNING','DISPATCH','SUBCONTRACT']::text[]) then raise exception 'Not authorized for this company'; end if;
  if v_tx.status <> 'DRAFT' then raise exception 'Only DRAFT transactions can be submitted'; end if;
  if v_tx.created_by is distinct from v_uid and not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN']::text[]) then raise exception 'Only the creator or an administrator may submit this draft'; end if;
  if not exists (select 1 from public.stock_txn_line l where l.txn_id=v_tx.id and l.company_id=v_tx.company_id) then raise exception 'Add at least one transaction line'; end if;
  if exists (select 1 from public.stock_txn_line l where l.txn_id=v_tx.id and (l.qty <= 0 or l.unit_cost < 0 or l.location_id is null)) then raise exception 'Each line needs positive quantity, non-negative cost, and a location'; end if;
  if v_tx.txn_type='TRANSFER' then raise exception 'Transfer posting is not enabled yet: the transaction line model needs explicit source and destination locations'; end if;
  update public.stock_txn_header set status='PENDING_APPROVAL', updated_at=now() where id=v_tx.id;
  return jsonb_build_object('txn_id',v_tx.id,'status','PENDING_APPROVAL');
end;
$$;

create or replace function public.approve_stock_transaction(p_txn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.stock_txn_header%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[]) then raise exception 'Approval role required'; end if;
  if v_tx.created_by = v_uid and not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN']::text[]) then raise exception 'A different user must approve this transaction'; end if;
  if v_tx.status <> 'PENDING_APPROVAL' then raise exception 'Only pending transactions can be approved'; end if;
  update public.stock_txn_header set status='APPROVED', approved_by=v_uid, approved_at=now(), updated_at=now() where id=v_tx.id;
  return jsonb_build_object('txn_id',v_tx.id,'status','APPROVED');
end;
$$;

create or replace function public.post_stock_transaction(p_txn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.stock_txn_header%rowtype;
  v_line public.stock_txn_line%rowtype;
  v_balance public.stock_balances%rowtype;
  v_uid uuid := auth.uid();
  v_in boolean;
  v_posted integer := 0;
  v_new_qty numeric;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  if not public.current_user_has_company_role(v_tx.company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[]) then raise exception 'Posting role required'; end if;
  if v_tx.status='POSTED' then
    return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','already_posted',true);
  end if;
  if v_tx.status <> 'APPROVED' then raise exception 'Only APPROVED transactions can be posted'; end if;
  if v_tx.txn_type='TRANSFER' then raise exception 'Transfer posting is not enabled until source and destination locations are represented separately'; end if;
  if v_tx.txn_type not in ('OPENING','GRN','PURCHASE_RETURN','PRODUCTION_ISSUE','PRODUCTION_RETURN','SUBCON_OUT','SUBCON_IN','ADJUSTMENT_IN','ADJUSTMENT_OUT','DISPATCH','CUSTOMER_RETURN','SCRAP') then raise exception 'Unsupported transaction type for posting'; end if;

  update public.stock_txn_header set status='POSTING', updated_at=now() where id=v_tx.id;

  for v_line in
    select * from public.stock_txn_line
    where txn_id=v_tx.id and company_id=v_tx.company_id
    order by item_id, warehouse_id, location_id, line_no
  loop
    if v_line.qty <= 0 or v_line.unit_cost < 0 or v_line.location_id is null then
      raise exception 'Line % requires positive quantity, non-negative cost, and a location',v_line.line_no;
    end if;
    if not exists(select 1 from public.item_master i where i.id=v_line.item_id and i.company_id=v_tx.company_id and i.is_active=true) then
      raise exception 'Line % item is inactive or belongs to another company',v_line.line_no;
    end if;
    if not exists(select 1 from public.warehouse_master w where w.id=v_line.warehouse_id and w.company_id=v_tx.company_id and w.is_active=true) then
      raise exception 'Line % warehouse is inactive or belongs to another company',v_line.line_no;
    end if;
    if not exists(select 1 from public.location_master loc where loc.id=v_line.location_id and loc.warehouse_id=v_line.warehouse_id and loc.company_id=v_tx.company_id and loc.is_active=true) then
      raise exception 'Line % location is inactive or does not belong to the selected warehouse/company',v_line.line_no;
    end if;

    v_in := v_tx.txn_type in ('OPENING','GRN','PRODUCTION_RETURN','SUBCON_IN','ADJUSTMENT_IN','CUSTOMER_RETURN');
    if v_in then
      insert into public.stock_balances(company_id,item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base,last_movement_at,updated_at)
      values(v_tx.company_id,v_line.item_id,v_line.warehouse_id,v_line.location_id,v_line.qty,0,v_line.qty,now(),now())
      on conflict(company_id,item_id,warehouse_id,location_id)
      do update set qty_on_hand_base=public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base,
        qty_available_base=(public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base)-public.stock_balances.qty_reserved_base,
        last_movement_at=now(),updated_at=now();
      insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
      values(v_tx.company_id,v_tx.id,v_line.line_no,v_line.item_id,v_line.warehouse_id,v_line.location_id,v_line.qty,0,v_line.unit_cost,v_line.lot_number,v_line.serial_number,v_line.line_remarks,v_uid);
    else
      select * into v_balance from public.stock_balances
      where company_id=v_tx.company_id and item_id=v_line.item_id and warehouse_id=v_line.warehouse_id and location_id=v_line.location_id
      for update;
      if not found then raise exception 'Insufficient stock for item on line %: no balance exists at selected location',v_line.line_no; end if;
      if (v_balance.qty_on_hand_base-v_balance.qty_reserved_base) < v_line.qty then
        raise exception 'Insufficient available stock for line %: on hand %, reserved %, requested %',v_line.line_no,v_balance.qty_on_hand_base,v_balance.qty_reserved_base,v_line.qty;
      end if;
      v_new_qty := v_balance.qty_on_hand_base-v_line.qty;
      update public.stock_balances set qty_on_hand_base=v_new_qty,
        qty_available_base=v_new_qty-v_balance.qty_reserved_base,last_movement_at=now(),updated_at=now()
      where company_id=v_tx.company_id and item_id=v_line.item_id and warehouse_id=v_line.warehouse_id and location_id=v_line.location_id;
      insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
      values(v_tx.company_id,v_tx.id,v_line.line_no,v_line.item_id,v_line.warehouse_id,v_line.location_id,0,v_line.qty,v_line.unit_cost,v_line.lot_number,v_line.serial_number,v_line.line_remarks,v_uid);
    end if;
    v_posted := v_posted+1;
  end loop;
  if v_posted=0 then raise exception 'No transaction lines found'; end if;
  update public.stock_txn_header set status='POSTED',posted_by=v_uid,posted_at=now(),updated_at=now() where id=v_tx.id;
  return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','lines_posted',v_posted);
end;
$$;

revoke all on function public.submit_stock_transaction(uuid) from public, anon;
revoke all on function public.approve_stock_transaction(uuid) from public, anon;
revoke all on function public.post_stock_transaction(uuid) from public, anon;
grant execute on function public.submit_stock_transaction(uuid) to authenticated;
grant execute on function public.approve_stock_transaction(uuid) to authenticated;
grant execute on function public.post_stock_transaction(uuid) to authenticated;
