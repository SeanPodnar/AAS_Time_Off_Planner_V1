-- 002 Sign-in: roles, email sign-in links and sessions for company users, and a
-- separate set of tables for the platform owner.
--
-- Tokens are stored only as SHA-256 hashes, so a database leak cannot be replayed
-- as a sign-in. Company sign-in tables follow the same row-level security rule as
-- all company data; the platform tables are reachable only by aas_platform.

alter table people
  add column role   text not null default 'employee' check (role in ('employee', 'admin')),
  add column status text not null default 'active' check (status in ('active', 'inactive'));

-- Company users -----------------------------------------------------------------

create table login_tokens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete restrict,
  person_id   uuid not null,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade
);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete restrict,
  person_id   uuid not null,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  method      text not null check (method in ('email_link', 'google', 'microsoft')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text,
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade
);
create index sessions_person on sessions (tenant_id, person_id);

do $$
declare t text;
begin
  foreach t in array array['login_tokens', 'sessions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t || '_tenant', t);
    execute format('grant select, insert, update on %I to aas_app', t);
  end loop;
end $$;

-- Platform owner ------------------------------------------------------------------

create table platform_owners (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name   text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index platform_owners_email on platform_owners (lower(email));

create table platform_login_tokens (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references platform_owners (id) on delete cascade,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table platform_sessions (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references platform_owners (id) on delete cascade,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text
);

do $$
declare t text;
begin
  foreach t in array array['platform_owners', 'platform_login_tokens', 'platform_sessions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_platform using (true) with check (true)', t || '_platform', t);
    execute format('grant select, insert, update on %I to aas_platform', t);
  end loop;
end $$;
