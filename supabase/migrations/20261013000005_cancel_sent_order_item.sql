create or replace function public.cancel_cafeline_open_order_item(
  p_order_id uuid,
  p_order_item_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;

  delete from public.order_items
  where id = p_order_item_id and order_id = p_order_id;
  if not found then raise exception 'order item not found' using errcode = 'P0002'; end if;

  update public.orders
  set total_tyiyn = coalesce((select sum(line_total_tyiyn)::integer from public.order_items where order_id = p_order_id), 0)
  where id = p_order_id;
end; $$;

revoke all on function public.cancel_cafeline_open_order_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_cafeline_open_order_item(uuid, uuid) to service_role;
