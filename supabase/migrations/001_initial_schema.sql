-- ============================================================
-- Portal Meditatii Mate – Initial Schema
-- Run this in your Supabase SQL editor (or via supabase db push)
-- ============================================================

-- ----------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------
create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ----------------------------------------------------------------
-- PAYMENT SETTINGS  (single-row config table for the tutor)
-- ----------------------------------------------------------------
create table if not exists payment_settings (
  id          integer primary key default 1,          -- enforces single row
  iban        text    not null default '',
  revolut     text    not null default '',
  bt_pay      text    not null default '',
  price_per_hour integer not null default 50,
  updated_at  timestamptz not null default now(),

  constraint single_row check (id = 1)
);

-- seed the single config row
insert into payment_settings (id) values (1)
  on conflict (id) do nothing;

-- ----------------------------------------------------------------
-- STUDENTS
-- ----------------------------------------------------------------
create table if not exists students (
  id          uuid        primary key default gen_random_uuid(),
  student_name text       not null,
  parent_name  text       not null,
  phone        text       not null,
  notes        text        not null default '',
  deleted_at   timestamptz,            -- soft delete
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists students_phone_unique
  on students (phone)
  where deleted_at is null;            -- only unique among active students

create index if not exists students_phone_idx on students (phone);

-- ----------------------------------------------------------------
-- SLOTS  (recurring weekly schedule)
-- ----------------------------------------------------------------
create table if not exists slots (
  id          uuid        primary key default gen_random_uuid(),
  day         text        not null,    -- 'Luni'..'Vineri'
  time        text        not null,    -- '13:00' etc.
  status      text        not null default 'free',
  student_id  uuid        references students (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint slots_status_check check (status in ('free', 'booked')),
  constraint slots_day_check check (day in ('Luni','Marti','Miercuri','Joi','Vineri','Sambata','Duminica'))
);

create unique index if not exists slots_day_time_unique on slots (day, time);
create index if not exists slots_student_idx on slots (student_id);

-- ----------------------------------------------------------------
-- PAYMENTS  (audit log of every payment confirmation)
-- ----------------------------------------------------------------
create table if not exists payments (
  id          uuid        primary key default gen_random_uuid(),
  student_id  uuid        not null references students (id) on delete restrict,
  hours       integer     not null,
  amount_lei  integer     not null,
  method      text        not null,    -- 'bank' | 'revolut' | 'btpay'
  status      text        not null default 'pending',
  notes       text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint payments_hours_positive  check (hours  > 0),
  constraint payments_amount_positive check (amount_lei > 0),
  constraint payments_method_check    check (method  in ('bank','revolut','btpay')),
  constraint payments_status_check    check (status  in ('pending','confirmed','cancelled'))
);

create index if not exists payments_student_idx on payments (student_id);
create index if not exists payments_status_idx  on payments (status);
create index if not exists payments_created_idx on payments (created_at desc);

-- ----------------------------------------------------------------
-- AUTO-UPDATE updated_at via trigger
-- ----------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_payment_settings before update on payment_settings
  for each row execute function touch_updated_at();

create trigger touch_students before update on students
  for each row execute function touch_updated_at();

create trigger touch_slots before update on slots
  for each row execute function touch_updated_at();

create trigger touch_payments before update on payments
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------
alter table payment_settings enable row level security;
alter table students         enable row level security;
alter table slots            enable row level security;
alter table payments         enable row level security;

-- ────────────────────────────────────────────────────────────────
-- payment_settings
--   • anyone can read (needed for parent payment page)
--   • only authenticated admin can write
-- ────────────────────────────────────────────────────────────────
create policy "public read payment_settings"
  on payment_settings for select
  using (true);

create policy "admin write payment_settings"
  on payment_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- students
--   • authenticated admin: full access
--   • anonymous: read only non-deleted (for phone lookup)
--     BUT only name + phone exposed — no notes, no parent details
--     We handle column-level exposure in the API layer (not here),
--     but the RLS ensures anon can only SELECT at all.
-- ────────────────────────────────────────────────────────────────
create policy "admin full access students"
  on students for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "anon read active students"
  on students for select
  using (auth.role() = 'anon' and deleted_at is null);

-- ────────────────────────────────────────────────────────────────
-- slots
--   • anyone can read (public calendar)
--   • only admin can write
-- ────────────────────────────────────────────────────────────────
create policy "public read slots"
  on slots for select
  using (true);

create policy "admin write slots"
  on slots for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- payments
--   • admin sees everything
--   • anon cannot read payments at all (sensitive financial data)
-- ────────────────────────────────────────────────────────────────
create policy "admin full access payments"
  on payments for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- anon INSERT allowed only for creating a pending payment (parent flow)
create policy "anon insert pending payment"
  on payments for insert
  with check (
    auth.role() = 'anon'
    and status = 'pending'
  );

-- ----------------------------------------------------------------
-- SEED DEFAULT SLOTS  (Mon–Fri, 13:00–21:00)
-- ----------------------------------------------------------------
do $$
declare
  days text[]  := array['Luni','Marti','Miercuri','Joi','Vineri'];
  times text[] := array['13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];
  d text;
  t text;
begin
  foreach d in array days loop
    foreach t in array times loop
      insert into slots (day, time, status)
      values (d, t, 'free')
      on conflict (day, time) do nothing;
    end loop;
  end loop;
end;
$$;
