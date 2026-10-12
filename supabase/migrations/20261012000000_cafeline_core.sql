create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0),
  constraint categories_sort_order_nonnegative check (sort_order >= 0)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  price_tyiyn integer not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_items_category_name_key unique (category_id, name),
  constraint menu_items_name_not_blank check (length(btrim(name)) > 0),
  constraint menu_items_price_nonnegative check (price_tyiyn >= 0),
  constraint menu_items_sort_order_nonnegative check (sort_order >= 0)
);

create sequence public.orders_order_number_seq as bigint start with 1 increment by 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null default nextval('public.orders_order_number_seq'),
  idempotency_key uuid not null,
  total_tyiyn integer not null,
  cashier_name text not null,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  constraint orders_order_number_key unique (order_number),
  constraint orders_idempotency_key_key unique (idempotency_key),
  constraint orders_total_nonnegative check (total_tyiyn >= 0),
  constraint orders_cashier_name_not_blank check (length(btrim(cashier_name)) > 0),
  constraint orders_status_completed check (status = 'completed')
);

alter sequence public.orders_order_number_seq owned by public.orders.order_number;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  item_name text not null,
  unit_price_tyiyn integer not null,
  quantity integer not null,
  line_total_tyiyn integer not null,
  constraint order_items_name_not_blank check (length(btrim(item_name)) > 0),
  constraint order_items_unit_price_nonnegative check (unit_price_tyiyn >= 0),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_line_total_nonnegative check (line_total_tyiyn >= 0),
  constraint order_items_line_total_matches_price check (
    line_total_tyiyn = unit_price_tyiyn * quantity
  )
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  submitted_at timestamptz,
  constraint print_jobs_order_type_key unique (order_id, type),
  constraint print_jobs_type_check check (type in ('customer', 'kitchen')),
  constraint print_jobs_status_check check (status in ('pending', 'submitted', 'failed')),
  constraint print_jobs_attempts_nonnegative check (attempts >= 0)
);

create index menu_items_catalog_idx
  on public.menu_items (category_id, is_active, sort_order, name);
create index orders_created_at_idx
  on public.orders (created_at desc, id desc);
create index order_items_order_id_idx
  on public.order_items (order_id);
create index print_jobs_order_id_idx
  on public.print_jobs (order_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger menu_items_set_updated_at
before update on public.menu_items
for each row execute function public.set_updated_at();

-- The browser never receives direct table privileges; only server code using
-- the Supabase service role can access data and invoke this RPC.
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.print_jobs enable row level security;

alter table public.categories force row level security;
alter table public.menu_items force row level security;
alter table public.orders force row level security;
alter table public.order_items force row level security;
alter table public.print_jobs force row level security;

revoke all on table public.categories, public.menu_items, public.orders,
  public.order_items, public.print_jobs from anon, authenticated;
revoke all on sequence public.orders_order_number_seq from anon, authenticated;

create or replace function public.create_cafeline_order(
  p_idempotency_key uuid,
  p_cashier_name text,
  p_items jsonb
)
returns table (
  order_id uuid,
  order_number bigint,
  total_tyiyn integer,
  customer_print_job_id uuid,
  kitchen_print_job_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_total_tyiyn bigint;
  v_requested_item_count integer;
  v_selected_item_count integer;
  v_customer_job_id uuid;
  v_kitchen_job_id uuid;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_cashier_name, ''))) = 0 then
    raise exception 'cashier_name is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(menu_item_id uuid, quantity integer)
    where menu_item_id is null or quantity is null or quantity <= 0
  ) then
    raise exception 'each item requires menu_item_id and positive quantity' using errcode = '22023';
  end if;

  select o.id, o.order_number, o.total_tyiyn
    into v_order_id, v_order_number, v_total_tyiyn
  from public.orders o
  where o.idempotency_key = p_idempotency_key;

  if found then
    return query
    select
      v_order_id,
      v_order_number,
      v_total_tyiyn::integer,
      max(pj.id::text) filter (where pj.type = 'customer')::uuid,
      max(pj.id::text) filter (where pj.type = 'kitchen')::uuid,
      false
    from public.print_jobs pj
    where pj.order_id = v_order_id;
    return;
  end if;

  with requested_items as (
    select input.menu_item_id, sum(input.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as input(menu_item_id uuid, quantity integer)
    group by input.menu_item_id
  ), selected_items as (
    select requested_items.menu_item_id, requested_items.quantity,
      menu_items.name, menu_items.price_tyiyn
    from requested_items
    join public.menu_items on menu_items.id = requested_items.menu_item_id
    join public.categories on categories.id = menu_items.category_id
    where menu_items.is_active and categories.is_active
  )
  select
    coalesce(sum(selected_items.price_tyiyn::bigint * selected_items.quantity), 0),
    count(*)
    into v_total_tyiyn, v_selected_item_count
  from selected_items;

  select count(*) into v_requested_item_count
  from (
    select distinct input.menu_item_id
    from jsonb_to_recordset(p_items) as input(menu_item_id uuid, quantity integer)
  ) as requested_ids;

  if v_selected_item_count <> v_requested_item_count then
    raise exception 'items do not exist or are unavailable' using errcode = '22023';
  end if;

  if v_total_tyiyn > 2147483647 then
    raise exception 'order total is too large' using errcode = '22003';
  end if;

  insert into public.orders (idempotency_key, total_tyiyn, cashier_name)
  values (p_idempotency_key, v_total_tyiyn::integer, btrim(p_cashier_name))
  on conflict (idempotency_key) do nothing
  returning orders.id, orders.order_number into v_order_id, v_order_number;

  if v_order_id is null then
    select o.id, o.order_number, o.total_tyiyn
      into v_order_id, v_order_number, v_total_tyiyn
    from public.orders o
    where o.idempotency_key = p_idempotency_key;

    return query
    select
      v_order_id,
      v_order_number,
      v_total_tyiyn::integer,
      max(pj.id::text) filter (where pj.type = 'customer')::uuid,
      max(pj.id::text) filter (where pj.type = 'kitchen')::uuid,
      false
    from public.print_jobs pj
    where pj.order_id = v_order_id;
    return;
  end if;

  with requested_items as (
    select input.menu_item_id, sum(input.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as input(menu_item_id uuid, quantity integer)
    group by input.menu_item_id
  )
  insert into public.order_items (
    order_id, menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn
  )
  select
    v_order_id,
    menu_items.id,
    menu_items.name,
    menu_items.price_tyiyn,
    requested_items.quantity,
    menu_items.price_tyiyn * requested_items.quantity
  from requested_items
  join public.menu_items on menu_items.id = requested_items.menu_item_id
  join public.categories on categories.id = menu_items.category_id
  where menu_items.is_active and categories.is_active;

  insert into public.print_jobs (order_id, type)
  values (v_order_id, 'customer'), (v_order_id, 'kitchen');

  -- INSERT .. RETURNING has no ordering guarantee. Resolve each job explicitly.
  select public.print_jobs.id into v_customer_job_id
  from public.print_jobs
  where public.print_jobs.order_id = v_order_id and public.print_jobs.type = 'customer';
  select public.print_jobs.id into v_kitchen_job_id
  from public.print_jobs
  where public.print_jobs.order_id = v_order_id and public.print_jobs.type = 'kitchen';

  return query select
    v_order_id,
    v_order_number,
    v_total_tyiyn::integer,
    v_customer_job_id,
    v_kitchen_job_id,
    true;
end;
$$;

revoke all on function public.create_cafeline_order(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_cafeline_order(uuid, text, jsonb) to service_role;
