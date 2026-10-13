alter table public.order_items
  add column added_at timestamptz;

update public.order_items as item
set added_at = order_row.created_at
from public.orders as order_row
where order_row.id = item.order_id and item.added_at is null;

alter table public.order_items
  alter column added_at set not null,
  alter column added_at set default now();
