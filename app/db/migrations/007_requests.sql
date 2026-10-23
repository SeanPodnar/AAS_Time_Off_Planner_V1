-- 007 Requests, the days they cover, and approval steps.
--
-- A request is one ask: new time off, a change to approved time off, or the cancellation
-- of approved time off. Changes and cancellations point at the approved request they
-- affect (target_id); the original stays booked until the change is approved.
-- Balances move only through accrual_ledger: approval writes a booking row, and a
-- later change or cancellation writes a booking_reversal row.

alter table plans add column cancel_needs_approval boolean not null default true;

create table requests (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete restrict,
  person_id            uuid not null,
  plan_id              uuid not null,
  kind                 text not null default 'new' check (kind in ('new', 'change', 'cancel')),
  target_id            uuid,
  start_date           date not null,
  end_date             date not null,
  -- Part of the first and last day taken: full, am (morning only) or pm (afternoon only).
  start_part           text not null default 'full' check (start_part in ('full', 'am', 'pm')),
  end_part             text not null default 'full' check (end_part in ('full', 'am', 'pm')),
  days                 numeric(6,1) not null check (days > 0),
  amount               numeric(9,3) not null check (amount > 0),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'superseded')),
  comment              text check (comment is null or char_length(comment) <= 1000),
  requester_time_zone  text not null,
  created_by           uuid not null,
  admin_reason         text check (admin_reason is null or char_length(admin_reason) <= 500),
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  check (end_date >= start_date),
  check (start_date < end_date or start_part = end_part),
  check (start_date = end_date or (start_part in ('full', 'pm') and end_part in ('full', 'am'))),
  check ((kind = 'new') = (target_id is null)),
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references plans (tenant_id, id) on delete restrict,
  foreign key (tenant_id, target_id) references requests (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references people (tenant_id, id) on delete restrict
);
create index requests_person on requests (tenant_id, person_id, start_date);
-- Only one open change or cancellation per approved request.
create unique index requests_one_open_followup on requests (target_id) where status = 'pending' and target_id is not null;

-- One row per date the request covers that counts against the plan (working days, or every
-- day for calendar-day plans). part is full, am or pm.
create table request_days (
  tenant_id   uuid not null references tenants (id) on delete restrict,
  request_id  uuid not null,
  day         date not null,
  part        text not null check (part in ('full', 'am', 'pm')),
  primary key (request_id, day),
  foreign key (tenant_id, request_id) references requests (tenant_id, id) on delete cascade
);
create index request_days_by_day on request_days (tenant_id, day);

create table approval_steps (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete restrict,
  request_id   uuid not null,
  step_no      smallint not null check (step_no between 1 and 5),
  -- manager: the requester's primary manager; next_manager: that manager's manager;
  -- admin: any HR admin other than the requester.
  role         text not null check (role in ('manager', 'next_manager', 'admin')),
  approver_id  uuid,
  status       text not null check (status in ('waiting', 'pending', 'approved', 'declined', 'cancelled')),
  decided_by   uuid,
  override     boolean not null default false,
  comment      text check (comment is null or char_length(comment) <= 1000),
  decided_at   timestamptz,
  unique (request_id, step_no),
  check ((role = 'admin') = (approver_id is null)),
  foreign key (tenant_id, request_id) references requests (tenant_id, id) on delete cascade,
  foreign key (tenant_id, approver_id) references people (tenant_id, id) on delete restrict,
  foreign key (tenant_id, decided_by) references people (tenant_id, id) on delete restrict
);
create index approval_steps_open on approval_steps (tenant_id, approver_id) where status = 'pending';

do $$
declare t text;
begin
  foreach t in array array['requests', 'request_days', 'approval_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update, delete on requests, request_days, approval_steps to aas_app;
