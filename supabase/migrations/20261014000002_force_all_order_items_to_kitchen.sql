create or replace function public.send_cafeline_order_to_kitchen(p_order_id uuid, p_idempotency_key uuid)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id and sent_quantity < quantity) then raise exception 'no pending items' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key) values (p_order_id, p_idempotency_key) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity - sent_quantity, unit_price_tyiyn * (quantity - sent_quantity) from public.order_items where order_id = p_order_id and sent_quantity < quantity;
  update public.order_items set sent_quantity = quantity where order_id = p_order_id and sent_quantity < quantity;
  insert into public.print_jobs (order_id, kitchen_ticket_id, type) values (p_order_id, v_ticket_id, 'kitchen') returning id into v_job_id;
  return query select v_ticket_id, v_job_id, true;
end; $$;

create or replace function public.send_cafeline_order_item_to_kitchen(p_order_id uuid, p_order_item_id uuid, p_idempotency_key uuid)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  select id into v_ticket_id from public.kitchen_tickets where idempotency_key = p_idempotency_key;
  if found then select id into v_job_id from public.print_jobs where kitchen_ticket_id = v_ticket_id; return query select v_ticket_id, v_job_id, false; return; end if;
  perform 1 from public.orders where id = p_order_id and status = 'open' for update;
  if not found then raise exception 'open order not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.order_items where id = p_order_item_id and order_id = p_order_id and sent_quantity < quantity) then raise exception 'pending item not found' using errcode = '22023'; end if;
  insert into public.kitchen_tickets (order_id, idempotency_key) values (p_order_id, p_idempotency_key) returning id into v_ticket_id;
  insert into public.kitchen_ticket_items (ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity, line_total_tyiyn)
  select v_ticket_id, menu_item_id, item_name, variant_name, unit_price_tyiyn, quantity - sent_quantity, unit_price_tyiyn * (quantity - sent_quantity) from public.order_items where id = p_order_item_id;
  update public.order_items set sent_quantity = quantity where id = p_order_item_id;
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

revoke all on function public.send_cafeline_order_to_kitchen(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_cafeline_order_item_to_kitchen(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_cafeline_table_order(uuid) from public, anon, authenticated;
grant execute on function public.send_cafeline_order_to_kitchen(uuid, uuid) to service_role;
grant execute on function public.send_cafeline_order_item_to_kitchen(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_cafeline_table_order(uuid) to service_role;
