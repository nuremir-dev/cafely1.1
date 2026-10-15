alter table public.menu_items add column if not exists requires_service_location boolean not null default false;
