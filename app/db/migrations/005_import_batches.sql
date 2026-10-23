-- 005 Bulk import: a parsed file waits here between preview and confirmation (one hour).
create table import_batches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete restrict,
  created_by  uuid not null,
  kind        text not null check (kind in ('people')),
  filename    text not null,
  rows        jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  foreign key (tenant_id, created_by) references people (tenant_id, id) on delete cascade
);

alter table import_batches enable row level security;
alter table import_batches force row level security;
create policy import_batches_tenant on import_batches to aas_app
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, delete on import_batches to aas_app;
