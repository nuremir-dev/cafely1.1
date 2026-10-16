-- Service mode belongs to an order, while a note belongs to one kitchen line.
-- Old item-level locations remain for historic compatibility only.
alter table public.orders
  add column if not exists service_location text not null default 'hall',
  add column if not exists draft_kitchen_comments jsonb not null default '{}'::jsonb,
  add constraint orders_service_location_check check (service_location in ('hall', 'takeaway'));

alter table public.order_items
  add column if not exists kitchen_comment text,
  add constraint order_items_kitchen_comment_length_check check (kitchen_comment is null or length(kitchen_comment) <= 280);

alter table public.kitchen_tickets
  add column if not exists service_location text not null default 'hall',
  add constraint kitchen_tickets_service_location_check check (service_location in ('hall', 'takeaway'));

alter table public.kitchen_ticket_items
  add column if not exists kitchen_comment text,
  add constraint kitchen_ticket_items_kitchen_comment_length_check check (kitchen_comment is null or length(kitchen_comment) <= 280);

create or replace function public.open_cafeline_table_order(
  p_idempotency_key uuid,
  p_cashier_name text,
  p_table_number smallint,
  p_service_location text
)
returns table (order_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid; v_shift_id uuid; v_location text;
begin
  v_location := coalesce(p_service_location, 'hall');
  if p_idempotency_key is null or length(btrim(coalesce(p_cashier_name, ''))) = 0
    or v_location not in ('hall', 'takeaway')
    or (p_table_number is not null and p_table_number not between 1 and 12) then
    raise exception 'invalid open order input' using errcode = '22023';
  end if;
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if found then return query select v_order_id, false; return; end if;
  select id into v_shift_id from public.cash_shifts where status = 'open' order by opened_at desc limit 1;
  if v_shift_id is null then raise exception 'cash shift is not open' using errcode = '22023'; end if;
  insert into public.orders (idempotency_key, total_tyiyn, cashier_name, status, table_number, service_location, shift_id)
  values (p_idempotency_key, 0, btrim(p_cashier_name), 'open', case when v_location = 'takeaway' then null else p_table_number end, v_location, v_shift_id)
  returning id into v_order_id;
  return query select v_order_id, true;
end;
$$;

create or replace function public.set_cafeline_order_service_location(p_order_id uuid, p_service_location text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_service_location not in ('hall', 'takeaway') then raise exception 'invalid service location' using errcode = '22023'; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.kitchen_tickets where order_id = p_order_id) then
    raise exception 'kitchen ticket already exists' using errcode = '22023';
  end if;
  update public.orders set service_location = p_service_location,
    table_number = case when p_service_location = 'takeaway' then null else table_number end
  where id = p_order_id;
end;
$$;

create or replace function public.save_cafeline_order_draft_comment(
  p_order_id uuid,
  p_client_line_id text,
  p_kitchen_comment text
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if length(btrim(coalesce(p_client_line_id, ''))) = 0 or length(p_client_line_id) > 120
    or length(coalesce(p_kitchen_comment, '')) > 280 then
    raise exception 'invalid draft comment input' using errcode = '22023';
  end if;
  update public.orders
  set draft_kitchen_comments = case
    when nullif(btrim(coalesce(p_kitchen_comment, '')), '') is null then draft_kitchen_comments - p_client_line_id
    else jsonb_set(draft_kitchen_comments, array[p_client_line_id], to_jsonb(btrim(p_kitchen_comment)), true)
  end
  where id = p_order_id and status = 'open';
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.complete_cafeline_local_cart(
  p_order_id uuid,
  p_items jsonb,
  p_customer_receipt_printed boolean
)
returns table (print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job_id uuid; v_total_tyiyn integer; v_location text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'cart items required' using errcode = '22023'; end if;
  select service_location into v_location from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.order_items where order_id = p_order_id) then raise exception 'order already has saved items' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, kitchen_comment text)
    where quantity is null or quantity < 1 or quantity > 1000 or length(coalesce(kitchen_comment, '')) > 280
  ) then raise exception 'invalid item input' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, kitchen_comment text)
    left join public.menu_items mi on mi.id = input.menu_item_id and mi.is_active
    left join public.categories c on c.id = mi.category_id and c.is_active
    left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id and variant.menu_item_id = mi.id and variant.is_active
    where input.menu_item_id is not null and (mi.id is null or c.id is null or (input.menu_item_variant_id is not null and variant.id is null))
  ) then raise exception 'menu item unavailable' using errcode = '22023'; end if;
  insert into public.order_items (order_id, menu_item_id, menu_item_variant_id, service_location, item_name, variant_name, kitchen_comment, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, fulfillment_type)
  select p_order_id, input.menu_item_id, input.menu_item_variant_id,
    case when input.menu_item_id is null then null else v_location end,
    case when input.menu_item_id is null then 'Неизвестная покупка'
      when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 and input.menu_item_variant_id is not null then mi.name || ' · ' || variant.name
      else mi.name end,
    case when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 then variant.name else null end,
    nullif(btrim(input.kitchen_comment), ''),
    coalesce(input.ad_hoc_amount_tyiyn, variant.price_tyiyn, mi.price_tyiyn), input.quantity, input.quantity,
    coalesce(input.ad_hoc_amount_tyiyn, variant.price_tyiyn, mi.price_tyiyn) * input.quantity,
    case when input.menu_item_id is null then 'counter' else c.fulfillment_type end
  from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer, kitchen_comment text)
  left join public.menu_items mi on mi.id = input.menu_item_id
  left join public.categories c on c.id = mi.category_id
  left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id;
  select coalesce(sum(line_total_tyiyn), 0)::integer into v_total_tyiyn from public.order_items where order_id = p_order_id;
  update public.orders set total_tyiyn = v_total_tyiyn, status = 'completed', completed_at = now() where id = p_order_id and status = 'open';
  insert into public.print_jobs (order_id, type, status, submitted_at)
  values (p_order_id, 'customer', case when coalesce(p_customer_receipt_printed, false) then 'submitted' else 'pending' end, case when coalesce(p_customer_receipt_printed, false) then now() else null end)
  returning id into v_job_id;
  return query select v_job_id, true;
end;
$$;

create or replace function public.print_cafeline_local_cart_to_kitchen(
  p_order_id uuid, p_items jsonb, p_idempotency_key uuid, p_station_id text
)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid; v_location text;
begin
  if p_idempotency_key is null or length(btrim(coalesce(p_station_id, ''))) < 8 then raise exception 'invalid kitchen print input' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  select service_location into v_location from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, kitchen_comment text)
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 1000 or length(coalesce(kitchen_comment, '')) > 280
  ) then raise exception 'invalid kitchen item input' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key, service_location) values (p_order_id, p_idempotency_key, v_location) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, kitchen_comment, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, mi.id,
    case when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 and input.menu_item_variant_id is not null then mi.name || ' · ' || variant.name else mi.name end,
    case when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 then variant.name else null end,
    nullif(btrim(input.kitchen_comment), ''), coalesce(variant.price_tyiyn, mi.price_tyiyn), input.quantity, coalesce(variant.price_tyiyn, mi.price_tyiyn) * input.quantity
  from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, kitchen_comment text)
  join public.menu_items mi on mi.id = input.menu_item_id and mi.is_active
  join public.categories c on c.id = mi.category_id and c.is_active
  left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id and variant.menu_item_id = mi.id and variant.is_active;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type, status, claimed_by, claimed_at, attempts)
  values (p_order_id, v_ticket_id, 'kitchen', 'processing', btrim(p_station_id), now(), 1) returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end;
$$;

create or replace function public.print_cafeline_local_cart_cancellation_to_kitchen(
  p_order_id uuid, p_items jsonb, p_idempotency_key uuid, p_station_id text
)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid; v_location text;
begin
  if p_idempotency_key is null or length(btrim(coalesce(p_station_id, ''))) < 8 then raise exception 'invalid cancellation print input' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  select service_location into v_location from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, kitchen_comment text)
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 1000 or length(coalesce(kitchen_comment, '')) > 280
  ) then raise exception 'invalid cancellation item input' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key, is_cancellation, service_location)
  values (p_order_id, p_idempotency_key, true, v_location) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, kitchen_comment, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, mi.id,
    case when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 and input.menu_item_variant_id is not null then mi.name || ' · ' || variant.name else mi.name end,
    case when (select count(*) from public.menu_item_variants only_variant where only_variant.menu_item_id = mi.id and only_variant.is_active) > 1 then variant.name else null end,
    nullif(btrim(input.kitchen_comment), ''), coalesce(variant.price_tyiyn, mi.price_tyiyn), input.quantity, coalesce(variant.price_tyiyn, mi.price_tyiyn) * input.quantity
  from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, kitchen_comment text)
  join public.menu_items mi on mi.id = input.menu_item_id
  left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id and variant.menu_item_id = mi.id;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type, status, claimed_by, claimed_at, attempts)
  values (p_order_id, v_ticket_id, 'kitchen', 'processing', btrim(p_station_id), now(), 1) returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end;
$$;

revoke all on function public.open_cafeline_table_order(uuid, text, smallint, text) from public, anon, authenticated;
revoke all on function public.set_cafeline_order_service_location(uuid, text) from public, anon, authenticated;
revoke all on function public.save_cafeline_order_draft_comment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_cafeline_local_cart(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.print_cafeline_local_cart_cancellation_to_kitchen(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.open_cafeline_table_order(uuid, text, smallint, text) to service_role;
grant execute on function public.set_cafeline_order_service_location(uuid, text) to service_role;
grant execute on function public.save_cafeline_order_draft_comment(uuid, text, text) to service_role;
grant execute on function public.complete_cafeline_local_cart(uuid, jsonb, boolean) to service_role;
grant execute on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.print_cafeline_local_cart_cancellation_to_kitchen(uuid, jsonb, uuid, text) to service_role;
