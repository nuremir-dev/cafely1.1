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
