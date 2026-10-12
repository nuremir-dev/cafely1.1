insert into public.categories (name, sort_order)
values
  ('Основные блюда', 10),
  ('Напитки', 20)
on conflict (name) do update
set sort_order = excluded.sort_order,
    is_active = true;

insert into public.menu_items (category_id, name, price_tyiyn, sort_order)
select categories.id, items.name, items.price_tyiyn, items.sort_order
from (
  values
    ('Основные блюда', 'Лагман', 25000, 10),
    ('Основные блюда', 'Плов', 28000, 20),
    ('Основные блюда', 'Манты', 22000, 30),
    ('Напитки', 'Чай', 4000, 10)
) as items(category_name, name, price_tyiyn, sort_order)
join public.categories on categories.name = items.category_name
on conflict (category_id, name) do update
set price_tyiyn = excluded.price_tyiyn,
    sort_order = excluded.sort_order,
    is_active = true;
