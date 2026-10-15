alter table public.order_items alter column menu_item_id drop not null;

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
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer)
    where quantity is null or quantity < 1 or quantity > 1000
      or (menu_item_id is null and (menu_item_variant_id is not null or quantity <> 1 or ad_hoc_amount_tyiyn is null or ad_hoc_amount_tyiyn < 1 or ad_hoc_amount_tyiyn > 100000000))
      or (menu_item_id is not null and ad_hoc_amount_tyiyn is not null)
  ) then raise exception 'invalid item input' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer)
    left join public.menu_items mi on mi.id = input.menu_item_id and mi.is_active
    left join public.categories c on c.id = mi.category_id and c.is_active
    left join public.menu_item_variants v on v.id = input.menu_item_variant_id and v.menu_item_id = mi.id and v.is_active
    where input.menu_item_id is not null and (mi.id is null or c.id is null or (input.menu_item_variant_id is not null and v.id is null))
  ) then raise exception 'menu item unavailable' using errcode = '22023'; end if;
  insert into public.order_items (order_id, menu_item_id, menu_item_variant_id, item_name, variant_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, fulfillment_type)
  select p_order_id, input.menu_item_id, input.menu_item_variant_id,
    case when input.menu_item_id is null then 'Неизвестная покупка' else mi.name || case when input.menu_item_variant_id is null then '' else ' · ' || v.name end end,
    case when input.menu_item_id is null then null else v.name end,
    coalesce(input.ad_hoc_amount_tyiyn, v.price_tyiyn, mi.price_tyiyn), input.quantity, input.quantity,
    coalesce(input.ad_hoc_amount_tyiyn, v.price_tyiyn, mi.price_tyiyn) * input.quantity,
    case when input.menu_item_id is null then 'counter' else c.fulfillment_type end
  from jsonb_to_recordset(p_items) as input(menu_item_id uuid, menu_item_variant_id uuid, quantity integer, ad_hoc_amount_tyiyn integer)
  left join public.menu_items mi on mi.id = input.menu_item_id
  left join public.categories c on c.id = mi.category_id
  left join public.menu_item_variants v on v.id = input.menu_item_variant_id;
  select coalesce(sum(line_total_tyiyn), 0)::integer into v_total_tyiyn from public.order_items where order_id = p_order_id;
  update public.orders set total_tyiyn = v_total_tyiyn, status = 'completed', completed_at = now() where id = p_order_id and status = 'open';
  if not found then raise exception 'order already closed' using errcode = 'P0002'; end if;
  insert into public.print_jobs (order_id, type) values (p_order_id, 'customer') returning id into v_job_id;
  return query select v_job_id, true;
end; $$;
