-- Keep the original atomic creator for fresh sales. The wrapper serializes a
-- given idempotency key and returns a prior order without relying on a UUID
-- aggregate, which PostgreSQL does not provide.
alter function public.create_cafeline_order(uuid, text, jsonb)
  rename to create_cafeline_order_legacy;

create function public.create_cafeline_order(
  p_idempotency_key uuid,
  p_cashier_name text,
  p_items jsonb
)
returns table (
  order_id uuid,
  order_number bigint,
  total_tyiyn integer,
  customer_print_job_id uuid,
  kitchen_print_job_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_total_tyiyn integer;
  v_customer_job_id uuid;
  v_kitchen_job_id uuid;
begin
  if p_idempotency_key is null then
    return query select * from public.create_cafeline_order_legacy(
      p_idempotency_key, p_cashier_name, p_items
    );
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  select o.id, o.order_number, o.total_tyiyn
    into v_order_id, v_order_number, v_total_tyiyn
  from public.orders as o
  where o.idempotency_key = p_idempotency_key;

  if found then
    select pj.id into v_customer_job_id
    from public.print_jobs as pj
    where pj.order_id = v_order_id and pj.type = 'customer';
    select pj.id into v_kitchen_job_id
    from public.print_jobs as pj
    where pj.order_id = v_order_id and pj.type = 'kitchen';

    return query select
      v_order_id,
      v_order_number,
      v_total_tyiyn,
      v_customer_job_id,
      v_kitchen_job_id,
      false;
    return;
  end if;

  return query select * from public.create_cafeline_order_legacy(
    p_idempotency_key, p_cashier_name, p_items
  );
end;
$$;

revoke all on function public.create_cafeline_order(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_cafeline_order(uuid, text, jsonb) to service_role;
