alter table public.print_jobs
  add column claimed_by text,
  add column claimed_at timestamptz;

alter table public.print_jobs
  drop constraint if exists print_jobs_status_check,
  add constraint print_jobs_status_check check (status in ('pending', 'processing', 'submitted', 'failed'));

create index print_jobs_station_queue_idx on public.print_jobs (status, id) where status in ('pending', 'processing');

create or replace function public.claim_cafeline_print_job(p_station_id text)
returns table (job_id uuid, job_type text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.print_jobs%rowtype;
begin
  if length(btrim(coalesce(p_station_id, ''))) < 8 then raise exception 'invalid print station' using errcode = '22023'; end if;
  select * into v_job
  from public.print_jobs
  where status = 'pending' or (status = 'processing' and claimed_at < now() - interval '2 minutes')
  order by id
  for update skip locked
  limit 1;
  if not found then return; end if;
  update public.print_jobs
  set status = 'processing', claimed_by = btrim(p_station_id), claimed_at = now(), attempts = attempts + 1, last_error = null
  where id = v_job.id;
  return query select v_job.id, v_job.type;
end; $$;

revoke all on function public.claim_cafeline_print_job(text) from public, anon, authenticated;
grant execute on function public.claim_cafeline_print_job(text) to service_role;

create function public.report_cafeline_station_print_job(p_job_id uuid, p_station_id text, p_status text, p_last_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('submitted', 'failed') or length(btrim(coalesce(p_station_id, ''))) < 8 then raise exception 'invalid print station result' using errcode = '22023'; end if;
  update public.print_jobs
  set status = p_status, last_error = case when p_status = 'failed' then coalesce(p_last_error, 'Ошибка печати') else null end,
    submitted_at = case when p_status = 'submitted' then now() else null end
  where id = p_job_id and status = 'processing' and claimed_by = btrim(p_station_id);
  if not found then raise exception 'print job is not claimed by this station' using errcode = 'P0002'; end if;
end; $$;

revoke all on function public.report_cafeline_station_print_job(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.report_cafeline_station_print_job(uuid, text, text, text) to service_role;
