create or replace function public.validate_stock_reorder_scope()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (select 1 from public.item_master i where i.id=new.item_id and i.company_id=new.company_id) then
    raise exception 'Reorder item must belong to the selected company';
  end if;
  if not exists (select 1 from public.warehouse_master w where w.id=new.warehouse_id and w.company_id=new.company_id) then
    raise exception 'Reorder warehouse must belong to the selected company';
  end if;
  return new;
end;
$function$;
revoke all on function public.validate_stock_reorder_scope() from public, anon, authenticated;
drop trigger if exists trg_validate_stock_reorder_scope on public.stock_reorder_settings;
create trigger trg_validate_stock_reorder_scope
before insert or update of company_id,item_id,warehouse_id on public.stock_reorder_settings
for each row execute function public.validate_stock_reorder_scope();
