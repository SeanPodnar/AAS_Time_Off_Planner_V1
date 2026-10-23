-- 006 Plans, levels, assignments, the accrual ledger and statutory reference rules.
--
-- Balances are never stored as totals. Every movement (grant, accrual, proration,
-- carryover, forfeiture, override, adjustment, opening balance, booking) is a dated
-- row in accrual_ledger, so any balance can be explained line by line. source_key
-- makes posting idempotent: a job that runs twice cannot credit twice.

create table plans (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants (id) on delete restrict,
  name                   text not null check (char_length(btrim(name)) between 1 and 80),
  category               text not null check (category in ('vacation','sick','personal','wellbeing','bereavement','parental','unpaid','lieu','other')),
  unit                   text not null default 'days' check (unit in ('days','hours')),
  accrual_method         text not null check (accrual_method in ('lump_sum','periodic','hours_worked','none')),
  lump_sum_timing        text check (lump_sum_timing in ('plan_year_start','hire_date','anniversary')),
  frequency              text check (frequency in ('annual','semi_annual','quarterly','monthly')),
  credit_timing          text not null default 'start' check (credit_timing in ('start','end')),
  hours_worked_ratio     numeric(6,2) check (hours_worked_ratio is null or hours_worked_ratio > 0),
  plan_year_start_month  smallint not null default 1 check (plan_year_start_month between 1 and 12),
  plan_year_start_day    smallint not null default 1 check (plan_year_start_day between 1 and 28),
  first_year_proration   boolean not null default true,
  rounding               text not null default 'nearest' check (rounding in ('nearest','up','down')),
  carryover              text not null default 'none' check (carryover in ('none','capped','unlimited','max_balance')),
  carryover_cap          numeric(7,2) check (carryover_cap is null or carryover_cap >= 0),
  carryover_expiry_month smallint check (carryover_expiry_month between 1 and 12),
  carryover_expiry_day   smallint check (carryover_expiry_day between 1 and 31),
  max_balance            numeric(7,2) check (max_balance is null or max_balance > 0),
  payout_unused          boolean not null default false,
  approval_mode          text not null default 'manager' check (approval_mode in ('auto','manager','admin')),
  second_approval        boolean not null default true,
  negative_limit         numeric(7,2) not null default 0 check (negative_limit >= 0),
  waiting_period_days    integer not null default 0 check (waiting_period_days between 0 and 730),
  visibility             text not null default 'name' check (visibility in ('name','out_of_office','hidden')),
  calendar_status        text not null default 'out_of_office' check (calendar_status in ('busy','free','out_of_office')),
  counts                 text not null default 'working_days' check (counts in ('working_days','calendar_days')),
  tenure_enabled         boolean not null default false,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tenant_id, id),
  check (accrual_method <> 'lump_sum' or lump_sum_timing is not null),
  check (accrual_method <> 'periodic' or frequency is not null),
  check (accrual_method <> 'hours_worked' or (hours_worked_ratio is not null and unit = 'hours')),
  check (carryover <> 'capped' or carryover_cap is not null),
  check (carryover <> 'max_balance' or max_balance is not null)
);
create unique index plans_name_per_tenant on plans (tenant_id, lower(btrim(name)));

-- Levels: a plan's entitlement tiers (Vacation Standard 15, Senior 20). annual_amount is in the plan's unit.
-- tenure_tiers: [{"years": 5, "amount": 20}, ...] used only when the plan has tenure_enabled.
create table plan_levels (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete restrict,
  plan_id        uuid not null,
  name           text not null check (char_length(btrim(name)) between 1 and 60),
  annual_amount  numeric(7,2) not null check (annual_amount >= 0 and annual_amount <= 2000),
  tenure_tiers   jsonb not null default '[]'::jsonb check (jsonb_typeof(tenure_tiers) = 'array'),
  sort_order     smallint not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, plan_id) references plans (tenant_id, id) on delete cascade
);
create unique index plan_levels_name_per_plan on plan_levels (plan_id, lower(btrim(name)));

-- One level per person per plan at a time. effective_to is exclusive; null = open-ended.
create table plan_assignments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete restrict,
  person_id       uuid not null,
  plan_id         uuid not null,
  level_id        uuid not null,
  effective_from  date not null,
  effective_to    date,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references plans (tenant_id, id) on delete cascade,
  foreign key (tenant_id, level_id) references plan_levels (tenant_id, id) on delete restrict
);
create index plan_assignments_person on plan_assignments (tenant_id, person_id, plan_id, effective_from);

create table accrual_ledger (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete restrict,
  person_id       uuid not null,
  plan_id         uuid not null,
  effective_date  date not null,
  plan_year       date not null,
  kind            text not null check (kind in ('grant','accrual','proration','carryover_in','forfeit','expire','override',
                                                'adjustment','opening_balance','booking','booking_reversal','payout')),
  amount          numeric(9,3) not null,
  source_key      text not null,
  reason          text,
  rule_ref        text,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  unique (tenant_id, source_key),
  foreign key (tenant_id, person_id) references people (tenant_id, id) on delete cascade,
  foreign key (tenant_id, plan_id) references plans (tenant_id, id) on delete cascade
);
create index accrual_ledger_balance on accrual_ledger (tenant_id, person_id, plan_id, effective_date);

do $$
declare t text;
begin
  foreach t in array array['plans', 'plan_levels', 'plan_assignments', 'accrual_ledger'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I to aas_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t || '_tenant', t);
  end loop;
end $$;
grant select, insert, update, delete on plans, plan_levels, plan_assignments to aas_app;
-- The ledger is append-only for the app: corrections are new rows, never edits.
grant select, insert on accrual_ledger to aas_app;

-- Statutory reference rules (not company data, so no tenant_id). Versioned by effective_from.
-- amount_unit 'weeks' is converted to days using the person's work days per week.
-- Figures come from secondary sources and MUST be checked by an employment law reviewer before launch (verified = false).
create table jurisdiction_rules (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction    text not null check (jurisdiction ~ '^(CA|US)-[A-Z]{2}$'),
  category        text not null check (category in ('vacation','sick')),
  rule_kind       text not null check (rule_kind in ('min_entitlement','no_forfeit','forfeit_conditional')),
  min_years       numeric(4,1) not null default 0,
  amount          numeric(7,2),
  amount_unit     text check (amount_unit in ('weeks','days','hours')),
  effective_from  date not null default '2026-01-01',
  verified        boolean not null default false,
  source          text,
  notes           text
);
create index jurisdiction_rules_lookup on jurisdiction_rules (jurisdiction, category, rule_kind, effective_from);
grant select on jurisdiction_rules to aas_app;

insert into jurisdiction_rules (jurisdiction, category, rule_kind, min_years, amount, amount_unit, source) values
  ('CA-AB','vacation','min_entitlement',1,2,'weeks','Employment Standards Code (AB)'), ('CA-AB','vacation','min_entitlement',5,3,'weeks','Employment Standards Code (AB)'),
  ('CA-BC','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (BC)'), ('CA-BC','vacation','min_entitlement',5,3,'weeks','Employment Standards Act (BC)'),
  ('CA-MB','vacation','min_entitlement',1,2,'weeks','Employment Standards Code (MB)'), ('CA-MB','vacation','min_entitlement',5,3,'weeks','Employment Standards Code (MB)'),
  ('CA-NB','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (NB)'), ('CA-NB','vacation','min_entitlement',8,3,'weeks','Employment Standards Act (NB)'),
  ('CA-NL','vacation','min_entitlement',1,2,'weeks','Labour Standards Act (NL)'),    ('CA-NL','vacation','min_entitlement',15,3,'weeks','Labour Standards Act (NL)'),
  ('CA-NS','vacation','min_entitlement',1,2,'weeks','Labour Standards Code (NS)'),   ('CA-NS','vacation','min_entitlement',8,3,'weeks','Labour Standards Code (NS)'),
  ('CA-NT','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (NT)'), ('CA-NT','vacation','min_entitlement',6,3,'weeks','Employment Standards Act (NT)'),
  ('CA-NU','vacation','min_entitlement',1,2,'weeks','Labour Standards Act (NU)'),    ('CA-NU','vacation','min_entitlement',6,3,'weeks','Labour Standards Act (NU)'),
  ('CA-ON','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (ON)'), ('CA-ON','vacation','min_entitlement',5,3,'weeks','Employment Standards Act (ON)'),
  ('CA-PE','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (PE)'), ('CA-PE','vacation','min_entitlement',8,3,'weeks','Employment Standards Act (PE)'),
  ('CA-QC','vacation','min_entitlement',1,2,'weeks','Act respecting labour standards (QC)'), ('CA-QC','vacation','min_entitlement',3,3,'weeks','Act respecting labour standards (QC)'),
  ('CA-QC','vacation','min_entitlement',10,4,'weeks','Act respecting labour standards (QC)'),
  ('CA-SK','vacation','min_entitlement',1,3,'weeks','Saskatchewan Employment Act'),  ('CA-SK','vacation','min_entitlement',10,4,'weeks','Saskatchewan Employment Act'),
  ('CA-YT','vacation','min_entitlement',1,2,'weeks','Employment Standards Act (YT)');

-- Statutory vacation in Canada must be taken or paid out; it cannot simply expire.
insert into jurisdiction_rules (jurisdiction, category, rule_kind, source, notes)
select 'CA-' || p, 'vacation', 'no_forfeit', 'Provincial employment standards', 'Up to the statutory minimum; amounts above it follow the plan rule'
  from unnest(array['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']) as p;

-- US states that prohibit forfeiting earned vacation, and states that allow it only with conditions.
insert into jurisdiction_rules (jurisdiction, category, rule_kind, source, notes) values
  ('US-CA','vacation','no_forfeit','Cal. Labor Code 227.3','Use a maximum balance cap instead'),
  ('US-CO','vacation','no_forfeit','Nieto v. Clark''s Market (2021)','Use a maximum balance cap instead'),
  ('US-MT','vacation','no_forfeit','Montana case law','Use a maximum balance cap instead'),
  ('US-NE','vacation','no_forfeit','Neb. Rev. Stat. 48-1229','Use a maximum balance cap instead'),
  ('US-IL','vacation','forfeit_conditional','Illinois Wage Payment and Collection Act','Allowed only with reasonable notice and opportunity to use'),
  ('US-MA','vacation','forfeit_conditional','Massachusetts Wage Act guidance','Allowed only with advance notice and opportunity to use');
