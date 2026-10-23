-- 009 Company holidays (FR-41). Provincial, territorial and US federal holidays come from rules
-- in code (src/lib/holidays/rules.ts). Each company adds its own days off (add) or stops observing
-- a default holiday (skip). jurisdiction null means everyone in the company.

create table company_holidays (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete restrict,
  day           date not null,
  action        text not null check (action in ('add', 'skip')),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  jurisdiction  text check (jurisdiction is null or jurisdiction ~ '^(CA|US)-[A-Z]{2}$'),
  reason        text check (reason is null or char_length(reason) <= 500),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, created_by) references people (tenant_id, id) on delete restrict
);
create unique index company_holidays_one on company_holidays (tenant_id, day, action, coalesce(jurisdiction, '*'));

alter table company_holidays enable row level security;
alter table company_holidays force row level security;
create policy company_holidays_tenant on company_holidays to aas_app
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, delete on company_holidays to aas_app;
