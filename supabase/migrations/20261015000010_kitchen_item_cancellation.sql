-- A dish that has already reached the kitchen cannot silently disappear from
-- the cash register.  Store its locally printed cancellation as a distinct,
-- idempotent kitchen ticket so history and retry state remain accurate.
alter table public.kitchen_tickets
  add column if not exists is_cancellation boolean not null default false;

create function public.print_cafeline_local_cart_cancellation_to_kitchen(
  p_order_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_station_id text
)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid; v_status text; v_claimed_by text;
begin
  if p_idempotency_key is null or length(btrim(coalesce(p_station_id, ''))) < 8 then
    raise exception 'invalid cancellation print input' using errcode = '22023';
  end if;

  select ticket.id into v_ticket_id
  from public.kitchen_tickets ticket
  where ticket.idempotency_key = p_idempotency_key;
  if found then
    select job.id, job.status, job.claimed_by
    into v_job_id, v_status, v_claimed_by
    from public.print_jobs job
    where job.kitchen_ticket_id = v_ticket_id;
    if v_status = 'submitted' or (v_status = 'processing' and v_claimed_by = btrim(p_station_id)) then
      return query select v_ticket_id, v_job_id, false;
      return;
    end if;
    raise exception 'kitchen cancellation print job is no longer available' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'cancellation items required' using errcode = '22023';
  end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text)
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 1000
      or service_location is null or service_location not in ('hall', 'takeaway')
  ) then raise exception 'invalid cancellation item input' using errcode = '22023'; end if;
  if exists (
    with input as (
      select menu_item_id, menu_item_variant_id, service_location, sum(quantity)::integer as quantity
      from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text)
      group by menu_item_id, menu_item_variant_id, service_location
    )
    select 1 from input
    left join public.menu_items mi on mi.id = input.menu_item_id
    left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id and variant.menu_item_id = mi.id
    where mi.id is null or (input.menu_item_variant_id is not null and variant.id is null)
  ) then raise exception 'cancelled menu item unavailable' using errcode = '22023'; end if;

  insert into public.kitchen_tickets (order_id, idempotency_key, is_cancellation)
  values (p_order_id, p_idempotency_key, true)
  returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  with input as (
    select menu_item_id, menu_item_variant_id, service_location, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as value(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, service_location text)
    group by menu_item_id, menu_item_variant_id, service_location
  )
  select v_ticket_id, mi.id,
    mi.name || case when input.menu_item_variant_id is null then '' else ' · ' || variant.name end
      || ' · ' || case input.service_location when 'hall' then 'Зал' else 'На вынос' end,
    variant.name, coalesce(variant.price_tyiyn, mi.price_tyiyn), input.quantity,
    coalesce(variant.price_tyiyn, mi.price_tyiyn) * input.quantity
  from input
  join public.menu_items mi on mi.id = input.menu_item_id
  left join public.menu_item_variants variant on variant.id = input.menu_item_variant_id;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type, status, claimed_by, claimed_at, attempts)
  values (p_order_id, v_ticket_id, 'kitchen', 'processing', btrim(p_station_id), now(), 1)
  returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

revoke all on function public.print_cafeline_local_cart_cancellation_to_kitchen(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.print_cafeline_local_cart_cancellation_to_kitchen(uuid, jsonb, uuid, text) to service_role;
