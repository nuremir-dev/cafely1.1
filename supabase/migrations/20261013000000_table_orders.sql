alter table public.orders
  drop constraint if exists orders_status_completed_check,
  add column table_number smallint,
  add column completed_at timestamptz;

alter table public.orders
  alter column status set default 'completed',
  add constraint orders_status_check check (status in ('open', 'completed')),
  add constraint orders_table_number_check check (table_number between 1 and 12 or table_number is null);

update public.orders set completed_at = created_at where status = 'completed' and completed_at is null;

create unique index orders_one_open_order_per_table_idx
  on public.orders (table_number)
  where status = 'open';

alter table public.order_items add column sent_quantity integer not null default 0;
update public.order_items as item
set sent_quantity = item.quantity
from public.orders as order_row
where order_row.id = item.order_id and order_row.status = 'completed';
alter table public.order_items
  add constraint order_items_sent_quantity_valid check (sent_quantity >= 0 and sent_quantity <= quantity);

create unique index order_items_one_pending_item_idx
  on public.order_items (order_id, menu_item_id)
  where sent_quantity = 0;

create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);

create table public.kitchen_ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets(id) on delete restrict,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  item_name text not null,
  unit_price_tyiyn integer not null,
  quantity integer not null,
  line_total_tyiyn integer not null,
  constraint kitchen_ticket_items_quantity_positive check (quantity > 0),
  constraint kitchen_ticket_items_total_valid check (line_total_tyiyn = unit_price_tyiyn * quantity)
);

alter table public.print_jobs drop constraint if exists print_jobs_order_type_key;
alter table public.print_jobs add column kitchen_ticket_id uuid references public.kitchen_tickets(id) on delete restrict;
create unique index print_jobs_one_customer_per_order_idx on public.print_jobs (order_id) where type = 'customer';
create unique index print_jobs_one_kitchen_per_ticket_idx on public.print_jobs (kitchen_ticket_id) where type = 'kitchen';

create index kitchen_tickets_order_id_idx on public.kitchen_tickets (order_id, created_at);
create index kitchen_ticket_items_ticket_id_idx on public.kitchen_ticket_items (ticket_id);

alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_tickets force row level security;
alter table public.kitchen_ticket_items enable row level security;
alter table public.kitchen_ticket_items force row level security;
revoke all on table public.kitchen_tickets, public.kitchen_ticket_items from anon, authenticated;

create or replace function public.open_cafeline_table_order(
  p_idempotency_key uuid,
  p_cashier_name text,
  p_table_number smallint
)
returns table (order_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid;
begin
  if p_idempotency_key is null or length(btrim(coalesce(p_cashier_name, ''))) = 0 or p_table_number not between 1 and 12 then
    raise exception 'invalid open order input' using errcode = '22023';
  end if;
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if found then return query select v_order_id, false; return; end if;
  insert into public.orders (idempotency_key, total_tyiyn, cashier_name, status, table_number)
  values (p_idempotency_key, 0, btrim(p_cashier_name), 'open', p_table_number)
  returning id into v_order_id;
  return query select v_order_id, true;
end; $$;

create or replace function public.move_cafeline_table_order(p_order_id uuid, p_table_number smallint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_table_number not between 1 and 12 then raise exception 'invalid table number' using errcode = '22023'; end if;
  update public.orders set table_number = p_table_number where id = p_order_id and status = 'open';
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
end; $$;

create or replace function public.change_cafeline_open_order_item(
  p_order_id uuid,
  p_menu_item_id uuid,
  p_delta integer
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_quantity integer; v_price integer; v_name text;
begin
  if p_delta = 0 or p_delta < -1000 or p_delta > 1000 then raise exception 'invalid quantity delta' using errcode = '22023'; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  select quantity into v_quantity from public.order_items where order_id = p_order_id and menu_item_id = p_menu_item_id and sent_quantity = 0 for update;
  if p_delta > 0 then
    select mi.price_tyiyn, mi.name into v_price, v_name
    from public.menu_items mi join public.categories c on c.id = mi.category_id
    where mi.id = p_menu_item_id and mi.is_active and c.is_active;
    if not found then raise exception 'menu item unavailable' using errcode = '22023'; end if;
    if v_quantity is null then
      insert into public.order_items (order_id, menu_item_id, item_name, unit_price_tyiyn, quantity, sent_quantity, line_total_tyiyn)
      values (p_order_id, p_menu_item_id, v_name, v_price, p_delta, 0, v_price * p_delta);
    else
      update public.order_items set quantity = quantity + p_delta, line_total_tyiyn = unit_price_tyiyn * (quantity + p_delta)
      where order_id = p_order_id and menu_item_id = p_menu_item_id and sent_quantity = 0;
    end if;
  elsif v_quantity is null or v_quantity + p_delta < 0 then
    raise exception 'pending item not found' using errcode = '22023';
  elsif v_quantity + p_delta = 0 then
    delete from public.order_items where order_id = p_order_id and menu_item_id = p_menu_item_id and sent_quantity = 0;
  else
    update public.order_items set quantity = quantity + p_delta, line_total_tyiyn = unit_price_tyiyn * (quantity + p_delta)
    where order_id = p_order_id and menu_item_id = p_menu_item_id and sent_quantity = 0;
  end if;
  update public.orders set total_tyiyn = coalesce((select sum(line_total_tyiyn)::integer from public.order_items where order_id = p_order_id), 0) where id = p_order_id;
end; $$;

create or replace function public.send_cafeline_order_to_kitchen(p_order_id uuid, p_idempotency_key uuid)
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
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id and sent_quantity < quantity) then raise exception 'no pending items' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key) values (p_order_id, p_idempotency_key) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, menu_item_id, item_name, unit_price_tyiyn, quantity - sent_quantity, unit_price_tyiyn * (quantity - sent_quantity)
  from public.order_items where order_id = p_order_id and sent_quantity < quantity;
  update public.order_items set sent_quantity = quantity where order_id = p_order_id and sent_quantity < quantity;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type) values (p_order_id, v_ticket_id, 'kitchen') returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

create or replace function public.complete_cafeline_table_order(p_order_id uuid)
returns table (print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job_id uuid;
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  select id into v_job_id from public.print_jobs where order_id = p_order_id and type = 'customer';
  if found then return query select v_job_id, false; return; end if;
  if exists (select 1 from public.order_items where order_id = p_order_id and sent_quantity < quantity) then raise exception 'pending kitchen items' using errcode = '22023'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then raise exception 'order is empty' using errcode = '22023'; end if;
  update public.orders set status = 'completed', completed_at = now() where id = p_order_id and status = 'open';
  if not found then raise exception 'order already closed' using errcode = 'P0002'; end if;
  insert into public.print_jobs (order_id, type) values (p_order_id, 'customer') returning id into v_job_id;
  return query select v_job_id, true;
end; $$;

revoke all on function public.open_cafeline_table_order(uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.move_cafeline_table_order(uuid, smallint) from public, anon, authenticated;
revoke all on function public.change_cafeline_open_order_item(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.send_cafeline_order_to_kitchen(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_cafeline_table_order(uuid) from public, anon, authenticated;
grant execute on function public.open_cafeline_table_order(uuid, text, smallint) to service_role;
grant execute on function public.move_cafeline_table_order(uuid, smallint) to service_role;
grant execute on function public.change_cafeline_open_order_item(uuid, uuid, integer) to service_role;
grant execute on function public.send_cafeline_order_to_kitchen(uuid, uuid) to service_role;
grant execute on function public.complete_cafeline_table_order(uuid) to service_role;
