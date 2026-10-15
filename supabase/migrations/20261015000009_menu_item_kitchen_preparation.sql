alter table public.menu_items
  add column if not exists prepares_in_kitchen boolean not null default false;

-- Preserve the existing category-level setup for every current dish. New
-- dishes are configured independently in menu administration.
update public.menu_items as item
set prepares_in_kitchen = (category.fulfillment_type = 'kitchen')
from public.categories as category
where category.id = item.category_id;
