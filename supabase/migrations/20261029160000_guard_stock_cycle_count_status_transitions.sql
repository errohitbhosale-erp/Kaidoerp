-- Prevent direct status escalation; approvals must be implemented through a controlled review RPC.
create or replace function public.guard_stock_cycle_count_status()
returns trigger language plpgsql set search_path=''
as $function$
begin
 if old.status <> 'DRAFT' then
   if new.status <> old.status and not (old.status = 'SUBMITTED' and new.status = 'CANCELLED') then
     raise exception 'Only draft counts can be submitted; submitted counts cannot be approved directly.';
   end if;
   if new.count_no is distinct from old.count_no or new.count_date is distinct from old.count_date or new.warehouse_id is distinct from old.warehouse_id or new.remarks is distinct from old.remarks then
     raise exception 'Count header details are locked after submission.';
   end if;
 elsif new.status not in ('DRAFT','SUBMITTED','CANCELLED') then
   raise exception 'Unsupported cycle count status transition.';
 end if;
 return new;
end;
$function$;
revoke all on function public.guard_stock_cycle_count_status() from public, anon, authenticated;
drop trigger if exists trg_guard_stock_cycle_count_status on public.stock_cycle_counts;
create trigger trg_guard_stock_cycle_count_status before update on public.stock_cycle_counts for each row execute function public.guard_stock_cycle_count_status();
