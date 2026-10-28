-- Enforce location hierarchy integrity at the database boundary.
-- UI validation is helpful, but direct API calls must not create cross-warehouse parents or cycles.

create or replace function public.validate_location_master_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_parent_company uuid;
  v_parent_warehouse uuid;
  v_cycle_found boolean;
begin
  if new.parent_location_id is null then
    return new;
  end if;

  if new.parent_location_id = new.id then
    raise exception 'A location cannot be its own parent.' using errcode = '23514';
  end if;

  select l.company_id, l.warehouse_id
    into v_parent_company, v_parent_warehouse
    from public.location_master as l
   where l.id = new.parent_location_id;

  if not found then
    raise exception 'Parent location does not exist or is not accessible.' using errcode = '23503';
  end if;

  if v_parent_company is distinct from new.company_id
     or v_parent_warehouse is distinct from new.warehouse_id then
    raise exception 'Parent location must belong to the same company and warehouse.' using errcode = '23514';
  end if;

  with recursive ancestry(id, parent_location_id, visited) as (
    select l.id, l.parent_location_id, array[l.id]
      from public.location_master as l
     where l.id = new.parent_location_id
    union all
    select p.id, p.parent_location_id, a.visited || p.id
      from ancestry as a
      join public.location_master as p on p.id = a.parent_location_id
     where not (p.id = any(a.visited))
  )
  select exists(select 1 from ancestry where id = new.id)
    into v_cycle_found;

  if v_cycle_found then
    raise exception 'A location cannot be placed under one of its descendants.' using errcode = '23514';
  end if;

  return new;
end;
$function$;

-- Trigger functions are invoked by PostgreSQL, not directly by API clients.
revoke all on function public.validate_location_master_hierarchy() from public, anon, authenticated;

drop trigger if exists trg_validate_location_master_hierarchy on public.location_master;
create trigger trg_validate_location_master_hierarchy
before insert or update of company_id, warehouse_id, parent_location_id
on public.location_master
for each row execute function public.validate_location_master_hierarchy();
