-- A business day can contain several sequential shifts, while still allowing
-- only one open shift at a time.
alter table public.cash_shifts
  drop constraint if exists cash_shifts_business_date_key;

create unique index if not exists cash_shifts_one_open_shift_idx
  on public.cash_shifts ((status))
  where status = 'open';

create or replace function public.open_cafeline_cash_shift(p_opened_by text)
returns table (shift_id uuid, business_date date, opened_by text, opened_at timestamptz, closed_by text, closed_at timestamptz, status text, sales_total_tyiyn integer, sold_item_count integer, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shift public.cash_shifts%rowtype; v_business_date date;
begin
  if length(btrim(coalesce(p_opened_by, ''))) = 0 or length(btrim(p_opened_by)) > 100 then
    raise exception 'invalid shift opener' using errcode = '22023';
  end if;

  v_business_date := timezone('Asia/Bishkek', now())::date;
  select * into v_shift
  from public.cash_shifts as cash_shift
  where cash_shift.business_date = v_business_date and cash_shift.status = 'open'
  for update;
  if found then
    return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, false;
    return;
  end if;

  insert into public.cash_shifts (business_date, opened_by)
  values (v_business_date, btrim(p_opened_by))
  returning * into v_shift;
  return query select v_shift.id, v_shift.business_date, v_shift.opened_by, v_shift.opened_at, v_shift.closed_by, v_shift.closed_at, v_shift.status, v_shift.sales_total_tyiyn, v_shift.sold_item_count, true;
end; $$;

revoke all on function public.open_cafeline_cash_shift(text) from public, anon, authenticated;
grant execute on function public.open_cafeline_cash_shift(text) to service_role;
