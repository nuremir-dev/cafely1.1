create function public.claim_cafeline_print_job_by_id(p_job_id uuid, p_station_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_job_id is null or length(btrim(coalesce(p_station_id, ''))) < 8 then
    raise exception 'invalid print job claim' using errcode = '22023';
  end if;
  update public.print_jobs
  set status = 'processing', claimed_by = btrim(p_station_id), claimed_at = now(),
    attempts = attempts + 1, last_error = null
  where id = p_job_id and status = 'pending';
  return found;
end; $$;

revoke all on function public.claim_cafeline_print_job_by_id(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_cafeline_print_job_by_id(uuid, text) to service_role;
