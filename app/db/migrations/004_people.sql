-- 004 People management: company settings, teams, locations, work schedules and
-- secondary managers. Everything here is company data under row-level security.

create table tenant_settings (
  tenant_id                 uuid primary key references tenants (id) on delete restrict,
  time_zone                 text not null,
  second_approval_threshold integer not null default 10 check (second_approval_threshold between 1 and 60),
  updated_at                timestamptz not null default now()
);

create table teams (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete restrict,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  unique (tenant_id, id)
);
create unique index teams_name_per_tenant on teams (tenant_id, lower(btrim(name)));

create table locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete restrict,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  unique (tenant_id, id)
);
create unique index locations_name_per_tenant on locations (tenant_id, lower(btrim(name)));

alter table people
  add column team_id         uuid,
  add column location_id     uuid,
  add column employee_number text check (employee_number is null or char_length(employee_number) between 1 and 40),
  add column hours_per_day   numeric(4,2) not null default 8 check (hours_per_day > 0 and hours_per_day <= 24),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday. Part-time staff list only the days they work.
  add column work_days       smallint[] not null default '{1,2,3,4,5}'
                             check (cardinality(work_days) between 1 and 7 and work_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add column updated_at      timestamptz not null default now(),
  add constraint people_not_own_manager check (manager_id is null or manager_id <> id),
  add foreign key (tenant_id, team_id) references teams (tenant_id, id) on delete restrict,
  add foreign key (tenant_id, location_id) references locations (tenant_id, id) on delete restrict;
create unique index people_employee_number on people (tenant_id, employee_number) where employee_number is not null;

-- Secondary managers see a person's time off and are notified; only the primary manager approves.
create table person_managers (
  tenant_id   uuid not null references tenants (id) on delete restrict,
  person_id   uuid not null,
  manager_id  uuid not null,
  primary key (tenant_id, person_id, manager_id),
  check (person_id <> manager_id),
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, manager_id) references people (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['tenant_settings', 'teams', 'locations', 'person_managers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t || '_tenant', t);
    execute format('grant select, insert, update, delete on %I to aas_app', t);
  end loop;
end $$;
