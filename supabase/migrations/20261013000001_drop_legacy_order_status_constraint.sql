-- The initial schema named this constraint without the `_check` suffix.
-- Keep the newer open/completed constraint from the table-order migration.
alter table public.orders drop constraint if exists orders_status_completed;
