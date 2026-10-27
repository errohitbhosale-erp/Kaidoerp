-- Draft stock transaction lines. Posting to stock_ledger/stock_balances is handled by a later controlled workflow.
create table if not exists public.stock_txn_line (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  txn_id uuid not null references public.stock_txn_header(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  item_id uuid not null references public.item_master(id),
  warehouse_id uuid not null references public.warehouse_master(id),
  location_id uuid references public.location_master(id),
  qty numeric(20,6) not null check (qty > 0),
  unit_cost numeric(20,6) not null default 0 check (unit_cost >= 0),
  lot_number text,
  serial_number text,
  line_remarks text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint stock_txn_line_txn_line_unique unique (txn_id, line_no)
);
create index if not exists stock_txn_line_company_txn_idx on public.stock_txn_line(company_id, txn_id);
create index if not exists stock_txn_line_item_idx on public.stock_txn_line(company_id, item_id);
alter table public.stock_txn_line enable row level security;
drop policy if exists "company members read stock transaction lines" on public.stock_txn_line;
create policy "company members read stock transaction lines" on public.stock_txn_line
  for select to authenticated using (public.current_user_has_company(company_id));
drop policy if exists "authorized roles manage draft stock transaction lines" on public.stock_txn_line;
create policy "authorized roles manage draft stock transaction lines" on public.stock_txn_line
  for all to authenticated
  using (
    public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES','PURCHASE','PRODUCTION','PLANNING','DISPATCH','SUBCONTRACT'])
    and exists (select 1 from public.stock_txn_header h where h.id = txn_id and h.company_id = stock_txn_line.company_id and h.status = 'DRAFT' and h.created_by = (select auth.uid()))
  )
  with check (
    public.current_user_has_company_role(company_id, array['SUPER_ADMIN','ADMIN','STORES','PURCHASE','PRODUCTION','PLANNING','DISPATCH','SUBCONTRACT'])
    and exists (select 1 from public.stock_txn_header h where h.id = txn_id and h.company_id = stock_txn_line.company_id and h.status = 'DRAFT' and h.created_by = (select auth.uid()))
    and exists (select 1 from public.item_master i where i.id = item_id and i.company_id = stock_txn_line.company_id)
    and exists (select 1 from public.warehouse_master w where w.id = warehouse_id and w.company_id = stock_txn_line.company_id)
    and (location_id is null or exists (select 1 from public.location_master l where l.id = location_id and l.company_id = stock_txn_line.company_id and l.warehouse_id = stock_txn_line.warehouse_id))
  );
comment on table public.stock_txn_line is 'Draft stock transaction lines; stock ledger and balances are updated only by the controlled posting workflow.';
