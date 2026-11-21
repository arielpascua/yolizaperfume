-- Yoliza: card payment (Hexacorp) columns on yz_orders.
-- Applied by scripts/migrate.mjs after 0001.

alter table yz_orders
  add column if not exists payment_provider text,
  -- Hexacorp's own `reference_number`. Transaction Inquiry is keyed on it.
  add column if not exists payment_id text,
  -- Authorises the buyer's own status polling after they return from the payment page.
  add column if not exists callback_token text,
  add column if not exists updated_at timestamptz not null default now(),
  -- When the sweeper last looked at the order. It sweeps least-recently-checked first (never-checked first),
  -- so abandoned orders cannot starve newer ones.
  add column if not exists last_checked_at timestamptz;

-- `failed`: the gateway could not take the order. Nothing in the application writes `paid` except
-- the payment reconcile, from an authenticated Transaction Inquiry.
alter table yz_orders drop constraint if exists yz_orders_status_check;
alter table yz_orders
  add constraint yz_orders_status_check
  check (status in ('pending', 'invoiced', 'paid', 'failed', 'shipped', 'cancelled'));

-- UNIQUE: one Hexacorp transaction belongs to exactly one order. A duplicate would let two orders claim
-- the same payment, and the webhook's fallback lookup by reference_number could then pick the wrong one.
create unique index if not exists yz_orders_payment_id_uidx on yz_orders (payment_id) where payment_id is not null;
-- The sweeper's query: unpaid orders on one gateway, oldest first.
create index if not exists yz_orders_sweep_idx on yz_orders (payment_provider, last_checked_at nulls first, created_at) where status in ('pending', 'failed');
