create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  txn_id uuid not null references public.stock_txn_header(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  item_id uuid not null references public.item_master(id) on delete restrict,
  source_warehouse_id uuid not null references public.warehouse_master(id) on delete restrict,
  source_location_id uuid not null references public.location_master(id) on delete restrict,
  destination_warehouse_id uuid not null references public.warehouse_master(id) on delete restrict,
  destination_location_id uuid not null references public.location_master(id) on delete restrict,
  qty numeric not null check (qty > 0),
  lot_number text,
  serial_number text,
  line_remarks text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique(txn_id,line_no),
  check (source_location_id <> destination_location_id or source_warehouse_id <> destination_warehouse_id)
);
alter table public.stock_transfer_lines enable row level security;
drop policy if exists stock_transfer_lines_company_read on public.stock_transfer_lines;
create policy stock_transfer_lines_company_read on public.stock_transfer_lines for select to authenticated
using (public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES','PLANNING','PRODUCTION']::text[]));
revoke insert, update, delete on public.stock_transfer_lines from anon, authenticated;

create or replace function public.save_stock_transfer_draft(
 p_company_id uuid, p_document_no text, p_txn_date timestamptz,
 p_reference_no text, p_remarks text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_tx uuid; v_line jsonb; v_no integer:=0;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if not public.current_user_has_company_role(p_company_id,array['SUPER_ADMIN','ADMIN','STORES','PLANNING']::text[]) then raise exception 'Not authorized'; end if;
 if nullif(btrim(p_document_no),'') is null then raise exception 'Transfer number required'; end if;
 if p_txn_date is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Transfer date and at least one line are required'; end if;
 if exists(select 1 from public.stock_txn_header where company_id=p_company_id and document_no=btrim(p_document_no)) then raise exception 'Document number already exists'; end if;
 insert into public.stock_txn_header(company_id,document_no,txn_type,txn_date,status,reference_no,remarks,idempotency_key,created_by)
 values(p_company_id,btrim(p_document_no),'TRANSFER',p_txn_date,'DRAFT',nullif(btrim(p_reference_no),''),nullif(btrim(p_remarks),''),'TRANSFER:'||gen_random_uuid()::text,v_uid)
 returning id into v_tx;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_no:=v_no+1;
  if coalesce((v_line->>'qty')::numeric,0)<=0 then raise exception 'Line % quantity must be positive',v_no; end if;
  if (v_line->>'source_location_id') is null or (v_line->>'destination_location_id') is null then raise exception 'Line % needs source and destination locations',v_no; end if;
  if v_line->>'source_location_id'=v_line->>'destination_location_id' then raise exception 'Line % source and destination must differ',v_no; end if;
  if not exists(select 1 from public.item_master where id=(v_line->>'item_id')::uuid and company_id=p_company_id and is_active) then raise exception 'Line % item invalid or inactive',v_no; end if;
  if not exists(select 1 from public.warehouse_master where id=(v_line->>'source_warehouse_id')::uuid and company_id=p_company_id and is_active) or not exists(select 1 from public.warehouse_master where id=(v_line->>'destination_warehouse_id')::uuid and company_id=p_company_id and is_active) then raise exception 'Line % warehouse invalid or inactive',v_no; end if;
  if not exists(select 1 from public.location_master where id=(v_line->>'source_location_id')::uuid and company_id=p_company_id and warehouse_id=(v_line->>'source_warehouse_id')::uuid and is_active) or not exists(select 1 from public.location_master where id=(v_line->>'destination_location_id')::uuid and company_id=p_company_id and warehouse_id=(v_line->>'destination_warehouse_id')::uuid and is_active) then raise exception 'Line % location does not belong to selected warehouse/company',v_no; end if;
  insert into public.stock_transfer_lines(company_id,txn_id,line_no,item_id,source_warehouse_id,source_location_id,destination_warehouse_id,destination_location_id,qty,lot_number,serial_number,line_remarks,created_by)
  values(p_company_id,v_tx,v_no,(v_line->>'item_id')::uuid,(v_line->>'source_warehouse_id')::uuid,(v_line->>'source_location_id')::uuid,(v_line->>'destination_warehouse_id')::uuid,(v_line->>'destination_location_id')::uuid,(v_line->>'qty')::numeric,nullif(btrim(v_line->>'lot_number'),''),nullif(btrim(v_line->>'serial_number'),''),nullif(btrim(v_line->>'line_remarks'),''),v_uid);
 end loop;
 return v_tx;
end; $$;

create or replace function public.submit_stock_transfer(p_txn_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_tx public.stock_txn_header%rowtype; v_uid uuid:=auth.uid();
begin
 select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
 if not found then raise exception 'Transfer not found'; end if;
 if v_uid is null or not public.current_user_has_company_role(v_tx.company_id,array['SUPER_ADMIN','ADMIN','STORES','PLANNING']::text[]) then raise exception 'Not authorized'; end if;
 if v_tx.txn_type<>'TRANSFER' or v_tx.status<>'DRAFT' then raise exception 'Only transfer drafts can be submitted'; end if;
 if v_tx.created_by is distinct from v_uid and not public.current_user_has_company_role(v_tx.company_id,array['SUPER_ADMIN','ADMIN']::text[]) then raise exception 'Only creator or administrator may submit'; end if;
 if not exists(select 1 from public.stock_transfer_lines where txn_id=v_tx.id and company_id=v_tx.company_id) then raise exception 'Transfer needs at least one line'; end if;
 update public.stock_txn_header set status='PENDING_APPROVAL',updated_at=now() where id=v_tx.id;
 return jsonb_build_object('txn_id',v_tx.id,'status','PENDING_APPROVAL');
end; $$;

create or replace function public.post_stock_transfer(p_txn_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_tx public.stock_txn_header%rowtype; v_l public.stock_transfer_lines%rowtype;
 v_src public.stock_balances%rowtype; v_uid uuid:=auth.uid(); v_n integer:=0; v_item public.item_master%rowtype; v_cost numeric;
begin
 select * into v_tx from public.stock_txn_header where id=p_txn_id for update;
 if not found then raise exception 'Transfer not found'; end if;
 if v_uid is null or not public.current_user_has_company_role(v_tx.company_id,array['SUPER_ADMIN','ADMIN','STORES']::text[]) then raise exception 'Posting role required'; end if;
 if v_tx.txn_type<>'TRANSFER' then raise exception 'Transaction is not a transfer'; end if;
 if v_tx.status='POSTED' then return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','already_posted',true); end if;
 if v_tx.status<>'APPROVED' then raise exception 'Only approved transfers can be posted'; end if;
 for v_l in select * from public.stock_transfer_lines where txn_id=v_tx.id and company_id=v_tx.company_id order by item_id,source_warehouse_id,source_location_id,line_no loop
  select * into v_item from public.item_master where id=v_l.item_id and company_id=v_tx.company_id and is_active for share;
  if not found then raise exception 'Transfer item is inactive or invalid'; end if;
  if v_item.is_batch_tracked and nullif(btrim(v_l.lot_number),'') is null then raise exception 'Batch number required for %',v_item.item_code; end if;
  if v_item.is_serial_tracked and (nullif(btrim(v_l.serial_number),'') is null or v_l.qty<>1) then raise exception 'Serial-controlled transfer requires one unit per serial number'; end if;
  select * into v_src from public.stock_balances where company_id=v_tx.company_id and item_id=v_l.item_id and warehouse_id=v_l.source_warehouse_id and location_id=v_l.source_location_id for update;
  if not found or v_src.qty_on_hand_base-v_src.qty_reserved_base<v_l.qty then raise exception 'Insufficient unreserved source stock for %',v_item.item_code; end if;
  if v_item.is_batch_tracked and not exists(select 1 from public.stock_ledger where company_id=v_tx.company_id and item_id=v_l.item_id and warehouse_id=v_l.source_warehouse_id and location_id=v_l.source_location_id and lot_number=v_l.lot_number group by item_id having sum(qty_in_base-qty_out_base)>=v_l.qty) then raise exception 'Insufficient batch quantity at source for %',v_item.item_code; end if;
  if v_item.is_serial_tracked and not exists(select 1 from public.stock_ledger where company_id=v_tx.company_id and item_id=v_l.item_id and serial_number=v_l.serial_number group by item_id having sum(qty_in_base-qty_out_base)>=1) then raise exception 'Serial is not available for transfer'; end if;
  select case when qty_on_hand_base>0 then inventory_value/qty_on_hand_base else 0 end into v_cost from public.stock_valuation where company_id=v_tx.company_id and item_id=v_l.item_id;
  v_cost:=coalesce(v_cost,0);
  update public.stock_balances set qty_on_hand_base=qty_on_hand_base-v_l.qty,qty_available_base=qty_on_hand_base-v_l.qty-qty_reserved_base,last_movement_at=now(),updated_at=now()
   where company_id=v_tx.company_id and item_id=v_l.item_id and warehouse_id=v_l.source_warehouse_id and location_id=v_l.source_location_id;
  insert into public.stock_balances(company_id,item_id,warehouse_id,location_id,qty_on_hand_base,qty_reserved_base,qty_available_base,last_movement_at,updated_at)
  values(v_tx.company_id,v_l.item_id,v_l.destination_warehouse_id,v_l.destination_location_id,v_l.qty,0,v_l.qty,now(),now())
  on conflict(company_id,item_id,warehouse_id,location_id) do update set qty_on_hand_base=public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base,qty_available_base=public.stock_balances.qty_on_hand_base+excluded.qty_on_hand_base-public.stock_balances.qty_reserved_base,last_movement_at=now(),updated_at=now();
  insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
  values(v_tx.company_id,v_tx.id,v_l.line_no*2-1,v_l.item_id,v_l.source_warehouse_id,v_l.source_location_id,0,v_l.qty,v_cost,v_l.lot_number,v_l.serial_number,'TRANSFER OUT: '||v_tx.document_no||coalesce(' · '||v_l.line_remarks,''),v_uid);
  insert into public.stock_ledger(company_id,txn_id,txn_line_no,item_id,warehouse_id,location_id,qty_in_base,qty_out_base,unit_cost,lot_number,serial_number,line_remarks,created_by)
  values(v_tx.company_id,v_tx.id,v_l.line_no*2,v_l.item_id,v_l.destination_warehouse_id,v_l.destination_location_id,v_l.qty,0,v_cost,v_l.lot_number,v_l.serial_number,'TRANSFER IN: '||v_tx.document_no||coalesce(' · '||v_l.line_remarks,''),v_uid);
  v_n:=v_n+1;
 end loop;
 if v_n=0 then raise exception 'No transfer lines found'; end if;
 update public.stock_txn_header set status='POSTED',posted_by=v_uid,posted_at=now(),updated_at=now() where id=v_tx.id;
 return jsonb_build_object('txn_id',v_tx.id,'status','POSTED','lines_posted',v_n);
end; $$;

revoke all on function public.save_stock_transfer_draft(uuid,text,timestamptz,text,text,jsonb) from public,anon;
revoke all on function public.submit_stock_transfer(uuid) from public,anon;
revoke all on function public.post_stock_transfer(uuid) from public,anon;
grant execute on function public.save_stock_transfer_draft(uuid,text,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.submit_stock_transfer(uuid) to authenticated;
grant execute on function public.post_stock_transfer(uuid) to authenticated;