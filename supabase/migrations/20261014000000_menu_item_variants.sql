create table public.menu_item_variants (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  price_tyiyn integer not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_item_variants_name_not_blank check (length(btrim(name)) > 0),
  constraint menu_item_variants_price_nonnegative check (price_tyiyn >= 0),
  constraint menu_item_variants_sort_order_nonnegative check (sort_order >= 0),
  constraint menu_item_variants_item_name_key unique (menu_item_id, name)
);

create index menu_item_variants_catalog_idx on public.menu_item_variants (menu_item_id, is_active, sort_order, name);
create trigger menu_item_variants_set_updated_at before update on public.menu_item_variants for each row execute function public.set_updated_at();
alter table public.menu_item_variants enable row level security;
alter table public.menu_item_variants force row level security;
revoke all on table public.menu_item_variants from anon, authenticated;

alter table public.order_items add column menu_item_variant_id uuid references public.menu_item_variants(id) on delete set null;
alter table public.order_items add column variant_name text;
alter table public.kitchen_ticket_items add column variant_name text;

drop index if exists public.order_items_one_pending_item_idx;
create unique index order_items_one_pending_base_item_idx on public.order_items (order_id, menu_item_id) where sent_quantity = 0 and menu_item_variant_id is null;
create unique index order_items_one_pending_variant_item_idx on public.order_items (order_id, menu_item_variant_id) where sent_quantity = 0 and menu_item_variant_id is not null;

create or replace function public.replace_cafeline_menu_item_variants(p_menu_item_id uuid, p_variants jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_menu_item_id is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) < 1 then
    raise exception 'invalid variants input' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_variants) as value(name text, price_tyiyn integer, sort_order integer, is_active boolean)
    where length(btrim(coalesce(value.name, ''))) = 0 or length(value.name) > 100 or value.price_tyiyn is null or value.price_tyiyn < 0 or value.sort_order is null or value.sort_order < 0 or value.is_active is null
  ) then raise exception 'invalid variant' using errcode = '22023'; end if;
  if not exists (select 1 from public.menu_items where id = p_menu_item_id) then raise exception 'menu item not found' using errcode = 'P0002'; end if;

  delete from public.menu_item_variants where menu_item_id = p_menu_item_id;
  insert into public.menu_item_variants (menu_item_id, name, price_tyiyn, sort_order, is_active)
  select p_menu_item_id, btrim(value.name), value.price_tyiyn, value.sort_order, value.is_active
  from jsonb_to_recordset(p_variants) as value(name text, price_tyiyn integer, sort_order integer, is_active boolean);
end; $$;

create or replace function public.change_cafeline_open_order_item(p_order_id uuid, p_menu_item_id uuid, p_menu_item_variant_id uuid, p_delta integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_quantity integer; v_price integer; v_name text; v_variant_name text; v_fulfillment_type text;
begin
  if p_delta = 0 or p_delta < -1000 or p_delta > 1000 then raise exception 'invalid quantity delta' using errcode = '22023'; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  select quantity into v_quantity from public.order_items where order_id = p_order_id and menu_item_id = p_menu_item_id and menu_item_variant_id is not distinct from p_menu_item_variant_id and sent_quantity = 0 for update;
  if p_delta > 0 then
    select mi.price_tyiyn, mi.name, c.fulfillment_type into v_price, v_name, v_fulfillment_type
    from public.menu_items mi join public.categories c on c.id = mi.category_id where mi.id = p_menu_item_id and mi.is_active and c.is_active;
    if not found then raise exception 'menu item unavailable' using errcode = '22023'; end if;
    if p_menu_item_variant_id is not null then
      select name, price_tyiyn into v_variant_name, v_price from public.menu_item_variants
      where id = p_menu_item_variant_id and menu_item_id = p_menu_item_id and is_active;
      if not found then raise exception 'menu item variant unavailable' using errcode = '22023'; end if;
      v_name := v_name || ' · ' || v_variant_name;
    end if;
    if v_quantity is null then
      insert into public.order_items (order_id, menu_item_id, menu_item_variant_id, item_name, variant_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn, fulfillment_type)
      values (p_order_id, p_menu_item_id, p_menu_item_variant_id, v_name, v_variant_name, v_price, p_delta, 0, v_price * p_delta, v_fulfillment_type);
    else
      update public.order_items set quantity = quantity + p_delta, line_total_tyiyn = unit_price_tyiyn * (quantity + p_delta)
      where order_id = p_order_id and menu_item_id = p_menu_item_id and menu_item_variant_id is not distinct from p_menu_item_variant_id and sent_quantity = 0;
    end if;
  elsif v_quantity is null or v_quantity + p_delta < 0 then raise exception 'pending item not found' using errcode = '22023';
  elsif v_quantity + p_delta = 0 then delete from public.order_items where order_id = p_order_id and menu_item_id = p_menu_item_id and menu_item_variant_id is not distinct from p_menu_item_variant_id and sent_quantity = 0;
  else update public.order_items set quantity = quantity + p_delta, line_total_tyiyn = unit_price_tyiyn * (quantity + p_delta) where order_id = p_order_id and menu_item_id = p_menu_item_id and menu_item_variant_id is not distinct from p_menu_item_variant_id and sent_quantity = 0;
  end if;
  update public.orders set total_tyiyn = coalesce((select sum(line_total_tyiyn)::integer from public.order_items where order_id = p_order_id), 0) where id = p_order_id;
end; $$;

-- PostgreSQL identifies a function by its argument types, not argument names.
-- The old second argument was p_menu_item_id; replace that signature explicitly.
drop function if exists public.send_cafeline_order_item_to_kitchen(uuid, uuid, uuid);
create function public.send_cafeline_order_item_to_kitchen(p_order_id uuid, p_order_item_id uuid, p_idempotency_key uuid)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.order_items where id = p_order_item_id and order_id = p_order_id and fulfillment_type = 'kitchen' and sent_quantity < quantity) then raise exception 'pending kitchen item not found' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key) values (p_order_id, p_idempotency_key) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity - sent_quantity, unit_price_tyiyn * (quantity - sent_quantity) from public.order_items where id = p_order_item_id;
  update public.order_items set sent_quantity = quantity where id = p_order_item_id;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type) values (p_order_id, v_ticket_id, 'kitchen') returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

revoke all on function public.replace_cafeline_menu_item_variants(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.change_cafeline_open_order_item(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.send_cafeline_order_item_to_kitchen(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.replace_cafeline_menu_item_variants(uuid, jsonb) to service_role;
grant execute on function public.change_cafeline_open_order_item(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.send_cafeline_order_item_to_kitchen(uuid, uuid, uuid) to service_role;
