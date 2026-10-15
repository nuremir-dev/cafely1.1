alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check check (status in ('open', 'completed', 'cancelled'));

create or replace function public.cancel_cafeline_completed_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.orders set status = 'cancelled'
  where id = p_order_id and status = 'completed';
  if not found then
    raise exception 'completed order not found' using errcode = 'P0002';
  end if;
end; $$;

create or replace function public.clear_cafeline_order_history()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted_count integer;
begin
  delete from public.kitchen_ticket_items
  where ticket_id in (
    select ticket.id from public.kitchen_tickets ticket
    join public.orders order_row on order_row.id = ticket.order_id
    where order_row.status in ('completed', 'cancelled')
  );
  delete from public.print_jobs
  where order_id in (select id from public.orders where status in ('completed', 'cancelled'));
  delete from public.kitchen_tickets
  where order_id in (select id from public.orders where status in ('completed', 'cancelled'));
  delete from public.order_items
  where order_id in (select id from public.orders where status in ('completed', 'cancelled'));
  delete from public.orders where status in ('completed', 'cancelled');
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end; $$;

revoke all on function public.cancel_cafeline_completed_order(uuid) from public, anon, authenticated;
revoke all on function public.clear_cafeline_order_history() from public, anon, authenticated;
grant execute on function public.cancel_cafeline_completed_order(uuid) to service_role;
grant execute on function public.clear_cafeline_order_history() to service_role;
