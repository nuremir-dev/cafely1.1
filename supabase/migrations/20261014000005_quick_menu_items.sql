alter table public.menu_items add column if not exists is_quick boolean not null default false;
create index if not exists menu_items_quick_idx on public.menu_items (is_quick, sort_order, name) where is_active and is_quick;
