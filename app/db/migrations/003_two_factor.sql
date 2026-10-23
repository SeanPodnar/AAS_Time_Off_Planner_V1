-- 003 Two-factor sign-in codes (TOTP authenticator apps) for HR admins and platform owners.
--
-- Secrets are encrypted by the app (AES-256-GCM, key from MFA_ENCRYPTION_KEY) before they reach
-- the database. Recovery codes are stored as SHA-256 hashes. last_step blocks reuse of a code.

create table mfa_factors (
  tenant_id     uuid not null references tenants (id) on delete restrict,
  person_id     uuid not null,
  secret_enc    bytea not null,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  last_step     bigint not null default 0,
  primary key (tenant_id, person_id),
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade
);

create table mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete restrict,
  person_id   uuid not null,
  code_hash   bytea not null check (octet_length(code_hash) = 32),
  used_at     timestamptz,
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade
);

alter table sessions add column mfa_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['mfa_factors', 'mfa_recovery_codes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t || '_tenant', t);
    execute format('grant select, insert, update, delete on %I to aas_app', t);
  end loop;
end $$;

create table platform_mfa_factors (
  owner_id      uuid primary key references platform_owners (id) on delete cascade,
  secret_enc    bytea not null,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  last_step     bigint not null default 0
);

create table platform_mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references platform_owners (id) on delete cascade,
  code_hash   bytea not null check (octet_length(code_hash) = 32),
  used_at     timestamptz
);

alter table platform_sessions add column mfa_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['platform_mfa_factors', 'platform_mfa_recovery_codes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_platform using (true) with check (true)', t || '_platform', t);
    execute format('grant select, insert, update, delete on %I to aas_platform', t);
  end loop;
end $$;
