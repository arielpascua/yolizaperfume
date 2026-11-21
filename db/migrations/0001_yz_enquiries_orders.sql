-- Yoliza: trade enquiries and private-link orders.
-- Applied by scripts/migrate.mjs (npm run migrate), which Railway runs before every deploy. Plain Postgres: the
-- application connects as the database owner through DATABASE_URL, and nothing else is ever given access.

create table if not exists yz_enquiries (
  id            uuid primary key,
  reference     text not null unique check (reference ~ '^YZE-[0-9A-F]{10}$'),
  status        text not null default 'new' check (status in ('new', 'contacted', 'approved', 'closed')),
  company       text not null,
  contact_name  text not null,
  email         text not null,
  phone         text,
  city          text,
  business_type text not null,
  store_website text,
  wants_samples boolean not null default false,
  message       text,
  created_at    timestamptz not null default now()
);

create table if not exists yz_enquiry_items (
  id            bigint generated always as identity primary key,
  enquiry_id    uuid not null references yz_enquiries (id) on delete cascade,
  fragrance_id  text not null,
  fragrance_name text not null,
  volume_id     text not null,
  volume_label  text not null,
  cases         integer not null check (cases between 1 and 200)
);

create table if not exists yz_orders (
  id               uuid primary key,
  reference        text not null unique check (reference ~ '^YZ-[0-9A-F]{10}$'),
  -- Nothing in the application ever sets 'paid'. A person changes status by hand.
  status           text not null default 'pending' check (status in ('pending', 'invoiced', 'paid', 'shipped', 'cancelled')),
  link_id          text not null,
  company          text not null,
  contact_name     text not null,
  email            text not null,
  phone            text not null,
  tax_id           text,
  ship_line1       text not null,
  ship_line2       text,
  ship_city        text not null,
  ship_region      text,
  ship_postal_code text not null,
  ship_country     text not null,
  po_number        text,
  notes            text,
  total_cases      integer not null check (total_cases > 0),
  total_bottles    integer not null check (total_bottles > 0),
  subtotal         integer not null check (subtotal > 0),
  discount_percent integer not null check (discount_percent between 0 and 100),
  discount         integer not null check (discount >= 0),
  total            integer not null check (total > 0),
  created_at       timestamptz not null default now()
);

create table if not exists yz_order_items (
  id             bigint generated always as identity primary key,
  order_id       uuid not null references yz_orders (id) on delete cascade,
  fragrance_id   text not null,
  fragrance_name text not null,
  volume_id      text not null,
  volume_label   text not null,
  cases          integer not null check (cases between 1 and 200),
  case_pack      integer not null check (case_pack > 0),
  bottles        integer not null check (bottles > 0),
  unit_price     integer not null check (unit_price > 0),
  line_total     integer not null check (line_total > 0)
);

create index if not exists yz_orders_link_id_idx on yz_orders (link_id);
create index if not exists yz_orders_created_idx on yz_orders (created_at desc);
create index if not exists yz_enquiries_created_idx on yz_enquiries (created_at desc);
