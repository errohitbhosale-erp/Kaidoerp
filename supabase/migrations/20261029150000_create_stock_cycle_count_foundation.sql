-- Physical stock count foundation. Count sessions and variances do not post stock movements.
create table if not exists public.stock_cycle_counts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 count_no text not null,
 count_date date not null default current_date,
 warehouse_id uuid not null references public.warehouse_master(id) on delete restrict,
 status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','APPROVED','CANCELLED')),
 remarks text,
 created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 submitted_at timestamptz,
 approved_by uuid,
 approved_at timestamptz,
 unique(company_id,count_no)
);
create table if not exists public.stock_cycle_count_lines (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 cycle_count_id uuid not null references public.stock_cycle_counts(id) on delete cascade,
 item_id uuid not null references public.item_master(id) on delete restrict,
 location_id uuid references public.location_master(id) on delete restrict,
 expected_qty numeric(20,6) not null default 0 check(expected_qty >= 0),
 counted_qty numeric(20,6) check(counted_qty is null or counted_qty >= 0),
 variance_qty numeric(20,6) generated always as (coalesce(counted_qty,expected_qty)-expected_qty) stored,
 notes text,
 created_at timestamptz not null default now(),
 unique(cycle_count_id,item_id,location_id)
);
create index if not exists stock_cycle_counts_company_date_idx on public.stock_cycle_counts(company_id,count_date desc);
create index if not exists stock_cycle_count_lines_session_idx on public.stock_cycle_count_lines(cycle_count_id);
alter table public.stock_cycle_counts enable row level security;
alter table public.stock_cycle_count_lines enable row level security;
drop policy if exists stock_cycle_counts_read_company on public.stock_cycle_counts;
create policy stock_cycle_counts_read_company on public.stock_cycle_counts for select to authenticated using (public.current_user_has_company(company_id));
drop policy if exists stock_cycle_counts_manage_roles on public.stock_cycle_counts;
create policy stock_cycle_counts_manage_roles on public.stock_cycle_counts for all to authenticated using (public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[])) with check (public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[]));
drop policy if exists stock_cycle_count_lines_read_company on public.stock_cycle_count_lines;
create policy stock_cycle_count_lines_read_company on public.stock_cycle_count_lines for select to authenticated using (public.current_user_has_company(company_id));
drop policy if exists stock_cycle_count_lines_manage_roles on public.stock_cycle_count_lines;
create policy stock_cycle_count_lines_manage_roles on public.stock_cycle_count_lines for all to authenticated using (public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[])) with check (public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES']::text[]));
create or replace function public.validate_stock_cycle_count_scope()
returns trigger language plpgsql set search_path=''
as $function$
declare v_company uuid; v_warehouse uuid; v_status text;
begin
 if tg_table_name = 'stock_cycle_counts' then
   if not exists(select 1 from public.warehouse_master w where w.id=new.warehouse_id and w.company_id=new.company_id) then raise exception 'Cycle count warehouse must belong to the selected company'; end if;
 else
   select c.company_id,c.warehouse_id,c.status into v_company,v_warehouse,v_status from public.stock_cycle_counts c where c.id=new.cycle_count_id;
   if v_company is null or v_company <> new.company_id then raise exception 'Cycle count line must belong to its parent company'; end if;
   if v_status <> 'DRAFT' then raise exception 'Only draft cycle counts can be edited'; end if;
   if not exists(select 1 from public.item_master i where i.id=new.item_id and i.company_id=new.company_id) then raise exception 'Cycle count item must belong to the selected company'; end if;
   if new.location_id is not null and not exists(select 1 from public.location_master l where l.id=new.location_id and l.company_id=new.company_id and l.warehouse_id=v_warehouse) then raise exception 'Cycle count location must belong to the selected warehouse'; end if;
 end if;
 return new;
end;
$function$;
revoke all on function public.validate_stock_cycle_count_scope() from public, anon, authenticated;
drop trigger if exists trg_validate_stock_cycle_count_header on public.stock_cycle_counts;
create trigger trg_validate_stock_cycle_count_header before insert or update of company_id,warehouse_id on public.stock_cycle_counts for each row execute function public.validate_stock_cycle_count_scope();
drop trigger if exists trg_validate_stock_cycle_count_line on public.stock_cycle_count_lines;
create trigger trg_validate_stock_cycle_count_line before insert or update of company_id,cycle_count_id,item_id,location_id on public.stock_cycle_count_lines for each row execute function public.validate_stock_cycle_count_scope();
