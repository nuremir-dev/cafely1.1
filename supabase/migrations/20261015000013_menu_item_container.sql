alter table public.menu_items
  add column is_container boolean not null default false;

create unique index menu_items_one_container_idx
  on public.menu_items ((is_container))
  where is_container;
