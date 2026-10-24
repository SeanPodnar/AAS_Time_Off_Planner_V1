-- 010 Private calendar feed links (FR-61). The link carries a random token; only its hash is
-- stored. A feed belongs to one person and shows either their own time off ('me'), their
-- team's ('team'), or, for managers, their reports' ('reports'). Resetting a link revokes it.

create table calendar_feeds (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete restrict,
  person_id    uuid not null,
  scope        text not null check (scope in ('me', 'team', 'reports')),
  token_hash   bytea not null unique check (octet_length(token_hash) = 32),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade
);
create unique index calendar_feeds_one_live on calendar_feeds (person_id, scope) where revoked_at is null;

alter table calendar_feeds enable row level security;
alter table calendar_feeds force row level security;
create policy calendar_feeds_tenant on calendar_feeds to aas_app
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, update on calendar_feeds to aas_app;
