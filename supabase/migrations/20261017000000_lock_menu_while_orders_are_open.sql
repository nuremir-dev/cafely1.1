-- A local POS cart keeps a selected variant until the order is completed.
-- Replacing menu variants while an order is open would invalidate that local
-- selection, so block the change at the database boundary as well as in UI.
create or replace function public.prevent_cafeline_menu_edit_while_orders_are_open()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.orders where status = 'open') then
    raise exception 'menu editing is locked while open orders exist' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists menu_items_prevent_edits_while_orders_open on public.menu_items;
create trigger menu_items_prevent_edits_while_orders_open
before update or delete on public.menu_items
for each row execute function public.prevent_cafeline_menu_edit_while_orders_are_open();

create or replace function public.replace_cafeline_menu_item_variants(p_menu_item_id uuid, p_variants jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.orders where status = 'open') then
    raise exception 'menu editing is locked while open orders exist' using errcode = '55000';
  end if;
  if p_menu_item_id is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) < 1 then
    raise exception 'invalid variants input' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_variants) as value(name text, price_tyiyn integer, sort_order integer, is_active boolean)
    where length(btrim(coalesce(value.name, ''))) = 0
      or length(value.name) > 100
      or value.price_tyiyn is null
      or value.price_tyiyn < 0
      or value.sort_order is null
      or value.sort_order < 0
      or value.is_active is null
  ) then
    raise exception 'invalid variant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.menu_items where id = p_menu_item_id) then
    raise exception 'menu item not found' using errcode = 'P0002';
  end if;

  delete from public.menu_item_variants where menu_item_id = p_menu_item_id;
  insert into public.menu_item_variants (menu_item_id, name, price_tyiyn, sort_order, is_active)
  select p_menu_item_id, btrim(value.name), value.price_tyiyn, value.sort_order, value.is_active
  from jsonb_to_recordset(p_variants) as value(name text, price_tyiyn integer, sort_order integer, is_active boolean);
end;
$$;

revoke all on function public.prevent_cafeline_menu_edit_while_orders_are_open() from public, anon, authenticated;
grant execute on function public.replace_cafeline_menu_item_variants(uuid, jsonb) to service_role;
