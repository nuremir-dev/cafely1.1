create function public.report_cafeline_print_job(p_job_id uuid, p_status text, p_last_error text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('submitted', 'failed') then raise exception 'invalid print status' using errcode = '22023'; end if;
  update public.print_jobs set status = p_status, attempts = attempts + 1,
    last_error = case when p_status = 'failed' then coalesce(p_last_error, 'Ошибка печати') else null end,
    submitted_at = case when p_status = 'submitted' then now() else null end
  where id = p_job_id;
  if not found then raise exception 'print job not found' using errcode = 'P0002'; end if;
end; $$;
revoke all on function public.report_cafeline_print_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_cafeline_print_job(uuid, text, text) to service_role;
