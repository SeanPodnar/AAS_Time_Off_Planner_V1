-- 008 Approval reminders, escalation to HR, and backup approvers (FR-55).

alter table tenant_settings
  add column reminder_after_days integer not null default 2 check (reminder_after_days between 1 and 30),
  add column escalate_after_days integer not null default 5 check (escalate_after_days between 1 and 60),
  add constraint escalate_after_reminder check (escalate_after_days > reminder_after_days);

-- When each step started waiting on its approver, and which follow-ups have gone out.
alter table approval_steps
  add column pending_since timestamptz,
  add column reminded_at   timestamptz,
  add column escalated_at  timestamptz;
update approval_steps set pending_since = now() where status = 'pending';

-- A backup decides an approver's steps while they are away (dates inclusive).
create table approval_backups (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete restrict,
  approver_id  uuid not null,
  backup_id    uuid not null,
  start_date   date not null,
  end_date     date not null,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date),
  check (backup_id <> approver_id),
  foreign key (tenant_id, approver_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, backup_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references people (tenant_id, id) on delete restrict
);
create index approval_backups_active on approval_backups (tenant_id, approver_id, start_date, end_date);

alter table approval_backups enable row level security;
alter table approval_backups force row level security;
create policy approval_backups_tenant on approval_backups to aas_app
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert, delete on approval_backups to aas_app;
