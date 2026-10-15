-- `shift_id` is also an OUT column of this function.  Always qualify the
-- orders column so PL/pgSQL does not confuse it with the return variable.
create or replace function public.close_cafeline_cash_shift(p_shift_id uuid, p_closed_by text)
returns table (shift_id uuid, business_date date, opened_by text, opened_at timestamptz, closed_by text, closed_at timestamptz, status text, sales_total_tyiyn integer, sold_item_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shift public.cash_shifts%rowtype; v_total integer; v_count integer;
begin
  if p_shift_id is null or length(btrim(coalesce(p_closed_by, ''))) = 0 or length(btrim(p_closed_by)) > 100 then
    raise exception 'invalid shift close input' using errcode = '22023';
  end if;

  select * into v_shift
  from public.cash_shifts as cash_shift
  where cash_shift.id = p_shift_id
  for update;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if v_shift.status = 'closed' then
    return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count;
    return;
  end if;

  if exists (
    select 1
    from public.orders as order_row
    where order_row.shift_id = p_shift_id and order_row.status = 'open'
  ) then
    raise exception 'open orders remain' using errcode = '22023';
  end if;

  select coalesce(sum(order_row.total_tyiyn), 0)::integer into v_total
  from public.orders as order_row
  where order_row.shift_id = p_shift_id and order_row.status = 'completed';
  select coalesce(sum(item.quantity), 0)::integer into v_count
  from public.order_items as item
  join public.orders as order_row on order_row.id = item.order_id
  where order_row.shift_id = p_shift_id and order_row.status = 'completed';

  update public.cash_shifts as cash_shift
  set status = 'closed', closed_by = btrim(p_closed_by), closed_at = now(), sales_total_tyiyn = v_total, sold_item_count = v_count
  where cash_shift.id = p_shift_id
  returning * into v_shift;
  return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count;
end; $$;

revoke all on function public.close_cafeline_cash_shift(uuid, text) from public, anon, authenticated;
grant execute on function public.close_cafeline_cash_shift(uuid, text) to service_role;
