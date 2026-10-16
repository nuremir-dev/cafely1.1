alter table public.cash_shifts
  add column close_mode text not null default 'manual',
  add constraint cash_shifts_close_mode_check check (close_mode in ('manual', 'overnight_auto'));

create or replace function public.auto_close_stale_cafeline_cash_shift()
returns table (
  shift_id uuid,
  business_date date,
  opened_by text,
  opened_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  close_mode text,
  status text,
  sales_total_tyiyn integer,
  sold_item_count integer,
  outcome text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shift public.cash_shifts%rowtype;
  v_total integer;
  v_count integer;
  v_today date;
  v_midnight timestamptz;
begin
  v_today := timezone('Asia/Bishkek', now())::date;

  select * into v_shift
  from public.cash_shifts as cash_shift
  where cash_shift.status = 'open' and cash_shift.business_date < v_today
  for update;
  if not found then return; end if;

  if exists (
    select 1 from public.orders as order_row
    where order_row.shift_id = v_shift.id and order_row.status = 'open'
  ) then
    return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.close_mode, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, 'blocked'::text;
    return;
  end if;

  select coalesce(sum(order_row.total_tyiyn), 0)::integer into v_total
  from public.orders as order_row
  where order_row.shift_id = v_shift.id and order_row.status = 'completed';
  select coalesce(sum(item.quantity), 0)::integer into v_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where order_row.shift_id = v_shift.id and order_row.status = 'completed';

  v_midnight := ((v_shift.business_date + 1)::timestamp at time zone 'Asia/Bishkek');
  update public.cash_shifts as cash_shift
  set status = 'closed',
      closed_by = 'Система (автозакрытие)',
      closed_at = v_midnight,
      close_mode = 'overnight_auto',
      sales_total_tyiyn = v_total,
      sold_item_count = v_count
  where cash_shift.id = v_shift.id
  returning * into v_shift;

  return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.close_mode, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, 'closed'::text;
end;
$$;

revoke all on function public.auto_close_stale_cafeline_cash_shift() from public, anon, authenticated;
grant execute on function public.auto_close_stale_cafeline_cash_shift() to service_role;
