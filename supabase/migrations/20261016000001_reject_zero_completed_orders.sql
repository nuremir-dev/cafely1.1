create or replace function public.reject_cafeline_zero_value_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and new.total_tyiyn <= 0 then
    raise exception 'completed order total must be positive' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_cafeline_zero_value_completion on public.orders;
create trigger reject_cafeline_zero_value_completion
  before insert or update of status, total_tyiyn on public.orders
  for each row
  when (new.status = 'completed')
  execute function public.reject_cafeline_zero_value_completion();
