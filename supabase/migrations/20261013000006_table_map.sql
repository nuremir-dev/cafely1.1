create table public.table_maps (
  id boolean primary key default true check (id),
  cells jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint table_maps_cells_array check (jsonb_typeof(cells) = 'array')
);

alter table public.table_maps enable row level security;
alter table public.table_maps force row level security;
revoke all on table public.table_maps from anon, authenticated;

insert into public.table_maps (id, cells)
values (true, '[0,1,2,3,4,5,6,7,8,9,10,11]'::jsonb)
on conflict (id) do nothing;
