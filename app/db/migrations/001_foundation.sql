-- 001 Foundation: companies (tenants), people, audit log, and company data separation.
--
-- Separation model
--   * Every company-owned table has tenant_id and row-level security (RLS) forced on.
--   * The app connects as role aas_app. Before touching company data it sets
--     app.tenant_id for the current transaction (see src/lib/tenancy.ts).
--     With no tenant set, every policy compares against NULL and returns no rows.
--   * aas_app has no direct access to the tenants table. It can only look up the
--     branding for one host through resolve_tenant_by_host().
--   * The platform console connects as aas_platform. It can manage the tenants
--     table but has no grants on any company data table.
--   * Primary keys are UUIDs (no shared sequences) so a company can later be
--     copied into its own database without key clashes.

create extension if not exists pgcrypto;

-- Roles are created by scripts/migrate.ts (it knows their passwords). Make sure they
-- cannot bypass RLS even if someone alters them later.
alter role aas_app nobypassrls;
alter role aas_platform nobypassrls;

create function app_tenant_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Companies ---------------------------------------------------------------------

create table tenants (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null check (char_length(btrim(legal_name)) between 1 and 200),
  short_label   text not null check (char_length(btrim(short_label)) between 1 and 24),
  subdomain     text not null unique
                check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'),
  custom_domain text unique
                check (custom_domain is null or custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  brand_color   text not null default '#2f7fd8' check (brand_color ~ '^#[0-9a-f]{6}$'),
  country       text not null check (country in ('CA', 'US')),
  status        text not null default 'setup' check (status in ('setup', 'live', 'suspended')),
  created_at    timestamptz not null default now()
);
create unique index tenants_short_label_ci on tenants (lower(btrim(short_label)));

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_platform_all on tenants to aas_platform using (true) with check (true);
grant select, insert, update on tenants to aas_platform;
-- No grant to aas_app on purpose.

-- Branding lookup for the sign-in page: one row, safe columns only, only live or
-- setup companies.
create function resolve_tenant_by_host(p_subdomain text, p_custom_domain text)
  returns table (id uuid, short_label text, brand_color text, country text)
  language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select t.id, t.short_label, t.brand_color, t.country
      from tenants t
     where t.status <> 'suspended'
       and ((p_subdomain is not null and t.subdomain = lower(p_subdomain))
         or (p_custom_domain is not null and t.custom_domain = lower(p_custom_domain)))
     limit 1
  $$;
revoke all on function resolve_tenant_by_host(text, text) from public;
grant execute on function resolve_tenant_by_host(text, text) to aas_app;

-- People ------------------------------------------------------------------------

create table people (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete restrict,
  full_name     text not null check (char_length(btrim(full_name)) between 1 and 200),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  job_title     text,
  jurisdiction  text not null check (jurisdiction ~ '^(CA|US)-[A-Z]{2}$'),
  hire_date     date not null,
  manager_id    uuid,
  created_at    timestamptz not null default now(),
  primary key (id),
  unique (tenant_id, id),
  -- A manager must belong to the same company.
  foreign key (tenant_id, manager_id) references people (tenant_id, id) on delete restrict
);
create unique index people_email_per_tenant on people (tenant_id, lower(email));

alter table people enable row level security;
alter table people force row level security;
create policy people_tenant on people to aas_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on people to aas_app;

-- Audit log (append-only) ---------------------------------------------------------

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete restrict,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index audit_log_tenant_at on audit_log (tenant_id, at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_tenant on audit_log to aas_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on audit_log to aas_app;

create function audit_log_immutable() returns trigger
  language plpgsql as $$
  begin
    raise exception 'audit_log is append-only';
  end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
