create or replace function public.print_cafeline_local_cart_to_kitchen(p_order_id uuid, p_items jsonb, p_idempotency_key uuid)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then
    select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id;
    return query select v_ticket_id, v_job_id, false; return;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'cart items required' using errcode = '22023'; end if;

  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer) where quantity is null or quantity < 1 or quantity > 1000) then raise exception 'invalid item quantity' using errcode = '22023'; end if;
  if exists (
    with input as (
      select menu_item_id, menu_item_variant_id, sum(quantity)::integer as quantity
      from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer)
      group by menu_item_id, menu_item_variant_id
    )
    select 1 from input
    left join public.menu_items mi on mi.id = input.menu_item_id and mi.is_active
    left join public.categories c on c.id = mi.category_id and c.is_active
    left join public.menu_item_variants v on v.id = input.menu_item_variant_id and v.menu_item_id = mi.id and v.is_active
    where mi.id is null or c.id is null or (input.menu_item_variant_id is not null and v.id is null)
  ) then raise exception 'menu item unavailable' using errcode = '22023'; end if;

  insert into public.kitchen_tickets (order_id, idempotency_key) values (p_order_id, p_idempotency_key) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  with input as (
    select menu_item_id, menu_item_variant_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer)
    group by menu_item_id, menu_item_variant_id
  )
  select v_ticket_id, mi.id,
    mi.name || case when input.menu_item_variant_id is null then '' else ' · ' || v.name end,
    v.name, coalesce(v.price_tyiyn, mi.price_tyiyn), input.quantity,
    coalesce(v.price_tyiyn, mi.price_tyiyn) * input.quantity
  from input
  join public.menu_items mi on mi.id = input.menu_item_id
  left join public.menu_item_variants v on v.id = input.menu_item_variant_id;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type) values (p_order_id, v_ticket_id, 'kitchen') returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

revoke all on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid) to service_role;
