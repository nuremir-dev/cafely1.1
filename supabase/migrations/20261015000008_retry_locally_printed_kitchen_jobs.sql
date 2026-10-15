-- A lost HTTP response must not make a locally printed kitchen ticket fail its
-- idempotent background retry.  The existing job remains the source of truth.
create or replace function public.print_cafeline_local_cart_to_kitchen(
  p_order_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_station_id text
)
returns table (ticket_id uuid, print_job_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ticket_id uuid; v_job_id uuid; v_created boolean; v_status text; v_claimed_by text;
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
    select status, claimed_by into v_status, v_claimed_by from public.print_jobs where id = v_job_id;
    if v_status = 'submitted' or (v_status = 'processing' and v_claimed_by = btrim(p_station_id)) then
      return query select v_ticket_id, v_job_id, v_created;
    end if;
    raise exception 'kitchen print job is no longer available' using errcode = 'P0002';
  end if;

  return query select v_ticket_id, v_job_id, v_created;
end; $$;
