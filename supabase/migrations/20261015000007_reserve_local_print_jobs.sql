-- A local POS print must never race the polling print station.  Customer
-- receipts that were already printed locally are recorded as submitted in the
-- same transaction that closes the order.  Kitchen jobs are claimed by the
-- originating cash register before the response is returned.

create function public.complete_cafeline_local_cart(
  p_order_id uuid,
  p_items jsonb,
  p_customer_receipt_printed boolean
)
returns table (print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job_id uuid; v_created boolean;
begin
  select result.print_job_id, result.created
  into v_job_id, v_created
  from public.complete_cafeline_local_cart(p_order_id, p_items) as result;

  if coalesce(p_customer_receipt_printed, false) then
    update public.print_jobs
    set status = 'submitted', submitted_at = now(), last_error = null
    where id = v_job_id and status = 'pending';
  end if;

  return query select v_job_id, v_created;
end; $$;

revoke all on function public.complete_cafeline_local_cart(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.complete_cafeline_local_cart(uuid, jsonb, boolean) to service_role;

create function public.print_cafeline_local_cart_to_kitchen(
  p_order_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_station_id text
)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid; v_created boolean;
begin
  if length(btrim(coalesce(p_station_id, ''))) < 8 then
    raise exception 'invalid print station' using errcode = '22023';
  end if;

  select result.ticket_id, result.print_job_id, result.created
  into v_ticket_id, v_job_id, v_created
  from public.print_cafeline_local_cart_to_kitchen(p_order_id, p_items, p_idempotency_key) as result;

  update public.print_jobs
  set status = 'processing', claimed_by = btrim(p_station_id), claimed_at = now(),
    attempts = attempts + 1, last_error = null
  where id = v_job_id and status = 'pending';

  if not found then
    raise exception 'kitchen print job is no longer available' using errcode = 'P0002';
  end if;

  return query select v_ticket_id, v_job_id, v_created;
end; $$;

revoke all on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.print_cafeline_local_cart_to_kitchen(uuid, jsonb, uuid, text) to service_role;
