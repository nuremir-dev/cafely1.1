alter table public.order_items add column if not exists service_location text;
alter table public.order_items drop constraint if exists order_items_service_location_check;
alter table public.order_items add constraint order_items_service_location_check
  check (service_location is null or service_location in ('hall', 'takeaway'));

create or replace function public.complete_cafeline_local_cart(p_order_id uuid, p_items jsonb)
returns table (print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job_id uuid; v_total_tyiyn integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'cart items required' using errcode = '22023'; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.order_items where order_id = p_order_id) then raise exception 'order already has saved items' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, service_location text)
    where quantity is null or quantity < 1 or quantity > 1000
      or (menu_item_id is null and (menu_item_variant_id is not null or quantity <> 1 or ad_hoc_amount_tyiyn is null or ad_hoc_amount_tyiyn < 1 or ad_hoc_amount_tyiyn > 100000000 or service_location is not null))
      or (menu_item_id is not null and (ad_hoc_amount_tyiyn is not null or service_location is null or service_location not in ('hall', 'takeaway')))
  ) then raise exception 'invalid item input' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, service_location text)
    left join public.menu_items mi on mi.id = input.menu_item_id and mi.is_active
    left join public.categories c on c.id = mi.category_id and c.is_active
    left join public.menu_item_variants v on v.id = input.menu_item_variant_id and v.menu_item_id = mi.id and v.is_active
    where input.menu_item_id is not null and (mi.id is null or c.id is null or (input.menu_item_variant_id is not null and v.id is null))
  ) then raise exception 'menu item unavailable' using errcode = '22023'; end if;
  insert into public.order_items (order_id, menu_item_id, menu_item_variant_id, service_location, item_name, variant_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, fulfillment_type)
  select p_order_id, input.menu_item_id, input.menu_item_variant_id,
    case when input.menu_item_id is null then null else input.service_location end,
    case when input.menu_item_id is null then 'Неизвестная покупка' else mi.name || case when input.menu_item_variant_id is null then '' else ' · ' || v.name end || ' · ' || case input.service_location when 'hall' then 'Зал' else 'На вынос' end end,
    case when input.menu_item_id is null then null else v.name end,
    coalesce(input.ad_hoc_amount_tyiyn, v.price_tyiyn, mi.price_tyiyn), input.quantity, input.quantity,
    coalesce(input.ad_hoc_amount_tyiyn, v.price_tyiyn, mi.price_tyiyn) * input.quantity,
    case when input.menu_item_id is null then 'counter' else c.fulfillment_type end
  from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, service_location text)
  left join public.menu_items mi on mi.id = input.menu_item_id
  left join public.categories c on c.id = mi.category_id
  left join public.menu_item_variants v on v.id = input.menu_item_variant_id;
  select coalesce(sum(line_total_tyiyn), 0)::integer into v_total_tyiyn from public.order_items where order_id = p_order_id;
  update public.orders set total_tyiyn = v_total_tyiyn, status = 'completed', completed_at = now() where id = p_order_id and status = 'open';
  if not found then raise exception 'order already closed' using errcode = 'P0002'; end if;
  insert into public.print_jobs (order_id, type) values (p_order_id, 'customer') returning id into v_job_id;
  return query select v_job_id, true;
end; $$;

create or replace function public.print_cafeline_local_cart_to_kitchen(p_order_id uuid, p_items jsonb, p_idempotency_key uuid)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'cart items required' using errcode = '22023'; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text) where quantity is null or quantity < 1 or quantity > 1000 or service_location is null or service_location not in ('hall', 'takeaway')) then raise exception 'invalid item input' using errcode = '22023'; end if;
  if exists (
    with input as (
      select menu_item_id, menu_item_variant_id, service_location, sum(quantity)::integer as quantity
      from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text)
      group by menu_item_id, menu_item_variant_id, service_location
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
    select menu_item_id, menu_item_variant_id, service_location, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text)
    group by menu_item_id, menu_item_variant_id, service_location
  )
  select v_ticket_id, mi.id,
    mi.name || case when input.menu_item_variant_id is null then '' else ' · ' || v.name end || ' · ' || case input.service_location when 'hall' then 'Зал' else 'На вынос' end,
    v.name, coalesce(v.price_tyiyn, mi.price_tyiyn), input.quantity,
    coalesce(v.price_tyiyn, mi.price_tyiyn) * input.quantity
  from input join public.menu_items mi on mi.id = input.menu_item_id left join public.menu_item_variants v on v.id = input.menu_item_variant_id;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type) values (p_order_id, v_ticket_id, 'kitchen') returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

revoke all on function public.complete_cafeline_local_cart(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_cafeline_local_cart(uuid, jsonb) to service_role;
revoke all on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid) to service_role;
