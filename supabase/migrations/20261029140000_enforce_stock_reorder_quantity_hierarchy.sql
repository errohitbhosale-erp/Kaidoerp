-- Keep reorder planning quantities in a valid hierarchy at the database boundary.
-- Minimum <= reorder quantity <= optional maximum.
alter table public.stock_reorder_settings
  add constraint stock_reorder_settings_quantity_hierarchy_check
  check (reorder_qty >= minimum_qty and (maximum_qty is null or maximum_qty >= reorder_qty));
