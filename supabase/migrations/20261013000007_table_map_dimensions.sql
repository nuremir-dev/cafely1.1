alter table public.table_maps
  add column rows smallint not null default 6 check (rows between 3 and 12),
  add column columns smallint not null default 8 check (columns between 3 and 12);
