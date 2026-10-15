create table public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  opened_by text not null,
  opened_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  status text not null default 'open',
  sales_total_tyiyn integer not null default 0,
  sold_item_count integer not null default 0,
  constraint cash_shifts_status_check check (status in ('open', 'closed')),
  constraint cash_shifts_opened_by_not_blank check (length(btrim(opened_by)) > 0),
  constraint cash_shifts_closed_fields_check check ((status = 'open' and closed_by is null and closed_at is null) or (status = 'closed' and closed_by is not null and closed_at is not null)),
  constraint cash_shifts_totals_nonnegative check (sales_total_tyiyn >= 0 and sold_item_count >= 0)
);

alter table public.orders add column shift_id uuid references public.cash_shifts(id) on delete restrict;
create index orders_shift_id_idx on public.orders (shift_id, status, completed_at);

alter table public.cash_shifts enable row level security;
alter table public.cash_shifts force row level security;
revoke all on table public.cash_shifts from anon, authenticated;

create or replace function public.open_cafeline_cash_shift(p_opened_by text)
returns table (shift_id uuid, business_date date, opened_by text, opened_at timestamptz, closed_by text, closed_at timestamptz, status text, sales_total_tyiyn integer, sold_item_count integer, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shift public.cash_shifts%rowtype; v_business_date date;
begin
  if length(btrim(coalesce(p_opened_by, ''))) = 0 or length(btrim(p_opened_by)) > 100 then
    raise exception 'invalid shift opener' using errcode = '22023';
  end if;
  v_business_date := timezone('Asia/Bishkek', now())::date;
  select * into v_shift from public.cash_shifts where cash_shifts.business_date = v_business_date for update;
  if found then
    return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, false;
    return;
  end if;
  insert into public.cash_shifts (business_date, opened_by) values (v_business_date, btrim(p_opened_by)) returning * into v_shift;
  return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, true;
end; $$;

create or replace function public.close_cafeline_cash_shift(p_shift_id uuid, p_closed_by text)
returns table (shift_id uuid, business_date date, opened_by text, opened_at timestamptz, closed_by text, closed_at timestamptz, status text, sales_total_tyiyn integer, sold_item_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shift public.cash_shifts%rowtype; v_total integer; v_count integer;
begin
  if p_shift_id is null or length(btrim(coalesce(p_closed_by, ''))) = 0 or length(btrim(p_closed_by)) > 100 then
    raise exception 'invalid shift close input' using errcode = '22023';
  end if;
  select * into v_shift from public.cash_shifts where id = p_shift_id for update;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if v_shift.status = 'closed' then
    return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count;
    return;
  end if;
  if exists (select 1 from public.orders where shift_id = p_shift_id and status = 'open') then
    raise exception 'open orders remain' using errcode = '22023';
  end if;
  select coalesce(sum(total_tyiyn), 0)::integer into v_total from public.orders where shift_id = p_shift_id and status = 'completed';
  select coalesce(sum(item.quantity), 0)::integer into v_count from public.order_items item join public.orders order_row on order_row.id = item.order_id where order_row.shift_id = p_shift_id and order_row.status = 'completed';
  update public.cash_shifts set status = 'closed', closed_by = btrim(p_closed_by), closed_at = now(), sales_total_tyiyn = v_total, sold_item_count = v_count where id = p_shift_id returning * into v_shift;
  return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count;
end; $$;

create or replace function public.open_cafeline_table_order(p_idempotency_key uuid, p_cashier_name text, p_table_number smallint default null)
returns table (order_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid; v_shift_id uuid;
begin
  if p_idempotency_key is null or length(btrim(coalesce(p_cashier_name, ''))) = 0 or (p_table_number is not null and p_table_number not between 1 and 12) then raise exception 'invalid open order input' using errcode = '22023'; end if;
  select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
  if found then return query select v_order_id, false; return; end if;
  select id into v_shift_id from public.cash_shifts where business_date = timezone('Asia/Bishkek', now())::date and status = 'open';
  if v_shift_id is null then raise exception 'cash shift is not open' using errcode = '22023'; end if;
  insert into public.orders (idempotency_key, total_tyiyn, cashier_name, status, table_number, shift_id)
  values (p_idempotency_key, 0, btrim(p_cashier_name), 'open', p_table_number, v_shift_id)
  returning id into v_order_id;
  return query select v_order_id, true;
end; $$;

revoke all on function public.open_cafeline_cash_shift(text) from public, anon, authenticated;
revoke all on function public.close_cafeline_cash_shift(uuid, text) from public, anon, authenticated;
revoke all on function public.open_cafeline_table_order(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.open_cafeline_cash_shift(text) to service_role;
grant execute on function public.close_cafeline_cash_shift(uuid, text) to service_role;
grant execute on function public.open_cafeline_table_order(uuid, text, smallint) to service_role;
