alter table public.stock_reservations
  add column if not exists source_reference text;

drop function if exists public.reserve_stock_item(uuid,text,uuid,uuid,uuid,numeric,text,uuid,timestamptz);

create function public.reserve_stock_item(
  p_company_id uuid,
  p_reservation_no text,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_location_id uuid,
  p_qty numeric,
  p_source_type text,
  p_source_id uuid default null,
  p_source_reference text default null,
  p_expires_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reservation_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.current_user_has_company_role(p_company_id, array['SUPER_ADMIN','ADMIN','STORES','PLANNING','PRODUCTION']) then
    raise exception 'You do not have permission to reserve stock for this company';
  end if;
  if p_reservation_no is null or btrim(p_reservation_no) = '' then raise exception 'Reservation number is required'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Reservation quantity must be greater than zero'; end if;
  if p_source_type is null or btrim(p_source_type) = '' then raise exception 'Source type is required'; end if;
  if not exists (select 1 from public.item_master i where i.id=p_item_id and i.company_id=p_company_id and i.is_active) then
    raise exception 'Item is invalid, inactive, or belongs to another company';
  end if;
  if not exists (select 1 from public.warehouse_master w where w.id=p_warehouse_id and w.company_id=p_company_id and w.is_active) then
    raise exception 'Warehouse is invalid, inactive, or belongs to another company';
  end if;
  if not exists (select 1 from public.location_master l where l.id=p_location_id and l.company_id=p_company_id and l.warehouse_id=p_warehouse_id and l.is_active) then
    raise exception 'An active location in the selected warehouse is required';
  end if;

  select b.qty_on_hand_base, b.qty_reserved_base into v_on_hand, v_reserved
  from public.stock_balances b
  where b.company_id=p_company_id and b.item_id=p_item_id
    and b.warehouse_id=p_warehouse_id and b.location_id=p_location_id
  for update;
  if not found then raise exception 'No stock balance exists for this item at the selected location'; end if;
  if v_on_hand - v_reserved < p_qty then
    raise exception 'Insufficient available stock. Available: %, requested: %', v_on_hand-v_reserved, p_qty;
  end if;

  update public.stock_balances
  set qty_reserved_base=qty_reserved_base+p_qty, updated_at=now()
  where company_id=p_company_id and item_id=p_item_id
    and warehouse_id=p_warehouse_id and location_id=p_location_id;

  insert into public.stock_reservations (
    company_id,reservation_no,item_id,warehouse_id,location_id,qty_reserved_base,
    source_type,source_id,source_reference,status,expires_at,created_by
  ) values (
    p_company_id,btrim(p_reservation_no),p_item_id,p_warehouse_id,p_location_id,p_qty,
    upper(btrim(p_source_type)),p_source_id,nullif(btrim(coalesce(p_source_reference,'')),''),'ACTIVE',p_expires_at,v_user
  ) returning id into v_reservation_id;
  return v_reservation_id;
end;
$$;

revoke all on function public.reserve_stock_item(uuid,text,uuid,uuid,uuid,numeric,text,uuid,text,timestamptz) from public, anon;
grant execute on function public.reserve_stock_item(uuid,text,uuid,uuid,uuid,numeric,text,uuid,text,timestamptz) to authenticated;