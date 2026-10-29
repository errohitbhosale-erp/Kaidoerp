-- Validate every line update, including counted quantity and notes, so submitted sessions are immutable.
drop trigger if exists trg_validate_stock_cycle_count_line on public.stock_cycle_count_lines;
create trigger trg_validate_stock_cycle_count_line
before insert or update on public.stock_cycle_count_lines
for each row execute function public.validate_stock_cycle_count_scope();
