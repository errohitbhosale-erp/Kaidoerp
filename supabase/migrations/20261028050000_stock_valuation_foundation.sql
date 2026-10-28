create unique index if not exists item_master_company_id_id_uidx on public.item_master(company_id, id);

create table if not exists public.stock_valuation (
  company_id uuid not null references public.companies(id) on delete restrict,
  item_id uuid not null,
  valuation_method text not null default 'WEIGHTED_AVERAGE'
    check (valuation_method in ('WEIGHTED_AVERAGE')),
  valuation_status text not null default 'UNINITIALIZED'
    check (valuation_status in ('UNINITIALIZED','RECONCILED','ESTIMATED')),
  qty_on_hand_base numeric(20,6) not null default 0 check (qty_on_hand_base >= 0),
  inventory_value numeric(20,6) not null default 0 check (inventory_value >= 0),
  average_cost numeric(20,8) generated always as (
    case when qty_on_hand_base > 0 then inventory_value / qty_on_hand_base else 0 end
  ) stored,
  last_valuation_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (company_id, item_id),
  constraint stock_valuation_company_item_fk
    foreign key (company_id, item_id) references public.item_master(company_id, id) on delete restrict,
  constraint stock_valuation_zero_qty_value_check
    check (qty_on_hand_base > 0 or inventory_value = 0)
);

alter table public.stock_valuation enable row level security;
revoke all on public.stock_valuation from anon, authenticated;
grant select on public.stock_valuation to authenticated;
drop policy if exists stock_valuation_read_company on public.stock_valuation;
create policy stock_valuation_read_company
  on public.stock_valuation
  for select
  to authenticated
  using (public.current_user_has_company(company_id));

comment on table public.stock_valuation is
  'Company-item moving weighted-average valuation. Seed only from explicit opening valuation; never infer inventory value from item_master.standard_rate.';
comment on column public.stock_valuation.valuation_status is
  'UNINITIALIZED means opening valuation has not been explicitly established; RECONCILED means ledger-derived; ESTIMATED means explicitly marked estimate.';
comment on column public.stock_valuation.inventory_value is
  'Inventory value in the company base currency; currency mapping is pending company accounting configuration.';
