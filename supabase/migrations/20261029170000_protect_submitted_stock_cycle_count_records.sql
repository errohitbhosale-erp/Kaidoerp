-- Submitted cycle counts are audit records; only draft sessions/lines may be deleted.
create or replace function public.guard_stock_cycle_count_line_delete()
returns trigger language plpgsql set search_path=''
as $function$
declare v_status text;
begin
 select status into v_status from public.stock_cycle_counts where id=old.cycle_count_id;
 if v_status is distinct from 'DRAFT' then
   raise exception 'Only draft cycle count lines can be deleted.';
 end if;
 return old;
end;
$function$;
revoke all on function public.guard_stock_cycle_count_line_delete() from public, anon, authenticated;
drop trigger if exists trg_guard_stock_cycle_count_line_delete on public.stock_cycle_count_lines;
create trigger trg_guard_stock_cycle_count_line_delete before delete on public.stock_cycle_count_lines for each row execute function public.guard_stock_cycle_count_line_delete();
create or replace function public.guard_stock_cycle_count_header_delete()
returns trigger language plpgsql set search_path=''
as $function$
begin
 if old.status <> 'DRAFT' then raise exception 'Only draft cycle counts can be deleted.'; end if;
 return old;
end;
$function$;
revoke all on function public.guard_stock_cycle_count_header_delete() from public, anon, authenticated;
drop trigger if exists trg_guard_stock_cycle_count_header_delete on public.stock_cycle_counts;
create trigger trg_guard_stock_cycle_count_header_delete before delete on public.stock_cycle_counts for each row execute function public.guard_stock_cycle_count_header_delete();
