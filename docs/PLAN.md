# AAS Time Off Planner: Requirements Plan (Draft 5)

Status: draft for review. Stage 2 of 5 (plan, clarify, mock-up, v1, iterate).
Date: 2026-10-17
Changes in Draft 5: N1 to N7 answered (approval routing, rounding, running-total escalation with an off switch, salaried US staff, automatic overrides); backlog and roadmap moved to a separate tracking board.
Changes in Draft 4: answers to 18 to 23 (exports, report audience and format, salary data and finance role to backlog, free hosting until release, branding and theming).
Changes in Draft 3: plan levels with admin-set days and statutory warnings (5.2, 5.8); hours accrual unit and lump sum for all regions (5.3, 5.4); jurisdiction carryover overrides with warnings (5.6); Jira moved to roadmap and backlog (8.3, 11, 12).
Changes in Draft 2: owner answers to questions 1 to 8 and 10 to 17 folded in; research on accrual law, approvals, hosting and Atlassian added. Decisions marked DECIDED, recommendations marked REC, open items marked OPEN.

## 1. Product summary

A multi-tenant absence management app for small and mid-sized companies. Employees request and track time off against plans assigned to them. Managers see and approve their team's absences. Tenant admins run the company's policies. The platform owner manages every tenant from one console without tenant data ever mixing.

Launch scale (DECIDED): 4 companies, largest about 20 employees, employees across Canada (all provinces) and the US (all states). Each company gets its own login domain and branding.

## 2. Benchmark against SMB time off tools

| Capability | BambooHR | Timetastic | Vacation Tracker / Leave Dates | This app |
|---|---|---|---|---|
| Multiple leave policies, assigned per person/team | Yes, unlimited | Yes | Yes | Yes, unlimited, admin-defined |
| Accrual options | Yes | Annual grant | Yes | Lump sum, annual, semi-annual, quarterly, monthly, per hours worked |
| Accrual unit | Hours or days | Days or hours | Days or hours | Days (half days) or hours |
| Configurable plan year | Yes | Yes | Yes | Yes, per plan |
| First-year proration from hire date | Yes | Yes | Yes | Yes |
| Tenure-based increases | Yes | Yes | Yes | Yes, off by default (see 5.6) |
| Balance projection to a future date | Yes | Partial | Partial | Yes |
| Approval levels | Up to 5 per policy | 1 plus backup | 1 to 2 | Per plan: auto, manager, admin, plus threshold escalation |
| "Who's Out" team calendar | Yes | Yes (wallchart) | Yes | Yes |
| Calendar feed (iCal) | Limited | Yes, respects privacy | Yes | Yes, tokenized and privacy-filtered |
| Private leave types | Partial | Yes, applies to feeds, Slack, API | Yes | Yes, per plan visibility setting |
| Statutory minimum and carryover checks | Partial (US) | No | Partial | Yes, warnings and overrides by province/state/city |
| Payroll integration | Marketplace incl. WorkLinks | CSV | CSV, some payroll | WorkLinks plus CSV/XLSX |
| Jira integration | No | No | Some | Roadmap v1.1: absence issues plus availability API |
| Multi-company console | No | No | No | Yes |

Copied from others: BambooHR's policy model and balance projection; Timetastic's privacy model (a private plan stays private in the app, feeds and API); the wallchart calendar.

## 3. Users and roles

| Role | Scope | Can do |
|---|---|---|
| Employee | Own records in one tenant | Request, amend, cancel own time off. See own balances and history. See the team calendar with plan visibility rules applied. Personal calendar feed. |
| Manager | Own records plus assigned reports | Everything an employee can, plus approve/deny for direct reports, team calendar with leave types for reports, team feed. |
| Tenant Admin (HR) | Whole tenant | People, managers, plans, holidays, balances, adjustments, reports, exports, integrations. Can act as an approver. |
| Platform Owner | All tenants, one at a time | Create tenants and domains, switch into a tenant (audited), aggregate cross-tenant metrics only. |

DECIDED: tenant admins never see other tenants. Only the platform owner can.

DECIDED: a person can have more than one manager (e.g. line manager plus project lead).
DECIDED: each person has exactly one primary manager, who is the approver. Secondary managers see the person's absences and balances and get notified, but do not approve. Absences over 10 working days in a row also go to the primary manager's own manager (section 6).

## 4. Functional requirements

### 4.1 Employee
- Home: balance card per assigned plan (available now, pending, used, projected at plan year end), upcoming time off, "Request time off" button.
- Request form: plan (only plans assigned to the person), start date, end date, half-day option on the first and last day (AM/PM), comment.
- Units (DECIDED): requests are in days and half days only. No hourly requests. Plans that accrue in hours (section 5.3) deduct the person's standard hours per day (e.g. 8.0 for a full day, 4.0 for a half day).
- Live check before submit: working days counted after weekends and the person's regional holidays; resulting balance; warnings for negative balance, overlap with own existing requests, and team members already off.
- Amend: pending requests edit freely. Amending an approved request creates a change request that goes through the same approval route; the original stays in force until the change is approved.
- Cancel: pending cancels instantly; approved future time needs approval to cancel (configurable per plan); past time locked except for admins.
- History with status and approver comments.

### 4.2 Manager
- Team table: each report's balances, pending requests, next absence.
- Approval inbox: approve/deny with comment, showing who else on the team is off on those dates.
- Calendar: wallchart (people x days) and month grid, filter by team, location and plan.
- Team feed for Google, Microsoft 365 and Apple.

### 4.3 Tenant Admin
- Employee directory search by name, email, employee ID, team, manager, location.
- Add or amend time off on anyone's behalf, with a required reason, logged. Admin entries can bypass approval.
- Balance adjustments (credit/debit) with reason and effective date, logged.
- Plan builder (section 5).
- Holiday calendars per province/state, preloaded, editable per tenant (company holidays added on top).
- Bulk import of employees and opening balances from CSV/XLSX.
- Exports: CSV, XLSX, Google Sheets. Reports (section 9). Integrations (section 8).

### 4.4 Platform Owner
- Tenant list: create, suspend, configure domain, logo and colours.
- "Enter tenant" switch, one tenant at a time, every switch logged.
- Aggregate metrics only (seats, request volume, integration health).

## 5. Plan and accrual engine

All settings are per plan, chosen in the plan builder. Plans are unlimited and admin-defined (DECIDED). Starter templates: Vacation, Wellbeing, Sick, Personal, Bereavement, Parental, Unpaid, Lieu time.

### 5.1 Plan year
- Plan year start: any month and day, default January 1 (DECIDED). Set per plan, so vacation can run on a calendar year while another plan runs April to March.

### 5.2 Plan levels (DECIDED: admin sets days per year)
- A plan can have several levels, each with its own annual entitlement set by the admin, e.g. Vacation Standard 15 days, Vacation Senior 20 days, Vacation Executive 25 days. Wellbeing and other plans work the same way.
- Each employee is assigned one level per plan. Moving someone to a new level takes effect on a chosen date, with the rest of that plan year prorated at the new level.
- Levels share the plan's rules (plan year, carryover, approvals, visibility) so admins do not maintain near-duplicate plans.
- Every level and every employee assignment is checked against the statutory minimum for the employee's jurisdiction and service (section 5.8).

### 5.3 Accrual unit (DECIDED: days, with an hours option)
- Days (default): balances held in days and half days.
- Hours (option, added for US requirements): balance accrues in hours, either:
  - per hours worked, at a set ratio (e.g. 1 hour per 30 hours worked, the most common US paid sick leave formula), or
  - as a fixed number of hours per period.
- Requests stay in days and half days. Each employee has standard hours per day (default 8.0; 7.5 common in Canada), and a full day deducts that many hours. Fractional hours left over stay on the balance and show as both hours and days ("22.5 h, about 2.8 days").
- Hours worked source: salaried exempt employees are assumed to work their standard week (40 hours unless set otherwise), which most state laws accept. Hourly or non-exempt employees need actual hours: from WorkLinks payroll data once the integration exists, or a per-pay-period CSV import until then. DECIDED: all US employees are salaried and not overtime-eligible, so hours-worked accrual runs automatically on each person's standard week. Hourly employees and overtime eligibility are in the backlog.

### 5.4 Accrual method and frequency (DECIDED)
- Lump sum (front-load): the full period entitlement is granted at once. Available for every plan and every region. Grant point options:
  - at plan year start (prorated in the first year),
  - on the hire date, then at each plan year start,
  - on the work anniversary.
- Periodic grant: annual, semi-annual (every 6 months), quarterly (every 3 months) or monthly (one twelfth). REC: credit at the start of each period, with an option to credit at period end.
- Per hours worked (hours unit only): credited each pay period from hours worked.
- One-off manual grants by admins (e.g. a bonus wellbeing day), with reason, logged.

### 5.5 First year (DECIDED: earned from start date)
- Entitlement is prorated from the employee's start date to the end of the first plan year.
- REC proration rule: count remaining months, including the start month if the start date is on or before the 15th. Example: 15 days per year, start date June 10, plan year January to December: 7 months remaining, 15 x 7/12 = 8.75 days.
- Rounding to half days (days unit), DECIDED: nearest half day (8.75 becomes 9.0, 8.2 becomes 8.0). Configurable per plan: nearest, up, down. Because nearest can round down, the statutory check (5.8) runs on the rounded figure and warns if it lands below a minimum. Hours-unit plans round to 0.25 hours.
- With periodic grants, the first partial period is prorated the same way, then normal periods apply.

### 5.6 Year end and carryover
Plan-level rule, set by the admin (DECIDED: some plans have no carryover):
- No carryover: balance resets to zero at plan year start ("use it or lose it").
- Capped carryover: up to N days (or hours) carry; option for carried amounts to expire on a date (e.g. use by March 31).
- Unlimited carryover.
- Maximum balance cap: accrual pauses when the balance reaches the cap and restarts once time is used. This is the lawful alternative to forfeiture in states that ban use-it-or-lose-it.
- Payout flag: unused amount is reported for payout instead of forfeited (reported to payroll; the app does not calculate pay).

Jurisdiction overrides (DECIDED: account for state-level differences, with warnings):
- Each employee has a work jurisdiction (province, state, and city where a city ordinance applies). The app keeps a rules table per jurisdiction and leave category (vacation, sick).
- At year end, the effective rule for each employee is the plan rule, made stricter where their jurisdiction requires. Examples the table will hold (to be verified against state sources before launch):
  - Vacation forfeiture prohibited: California, Colorado, Montana, Nebraska. The plan's "no carryover" becomes full carryover for those employees; the admin is told to use a maximum balance cap instead.
  - Vacation forfeiture conditional: e.g. Illinois (allowed only with reasonable notice and opportunity to use), Massachusetts. Allowed with a warning and a required notice date.
  - Paid sick leave carryover: state-specific caps on carryover or on total balance, e.g. California, Colorado (up to 48 hours), Connecticut (up to 40 hours); New Mexico and Washington prohibit accrual caps. Front-loaded (lump sum) sick plans meet many states' carryover rules, but not all; some cities (e.g. San Francisco) require carryover even when front-loaded.
  - Canada: statutory vacation cannot simply expire in any province; untaken statutory vacation must be scheduled or paid out. Amounts above the statutory minimum follow the plan rule.
- DECIDED: jurisdiction overrides apply automatically at year end. Admins still see every override in the year-end preview and the audit log.
- Warnings appear in three places: when a plan is saved, in the year-end preview report (sent to admins 30 days before year end, listing each employee, the plan rule, the override and the days affected), and on the employee's record.
- The rules table is data, versioned and dated, so a law change is a data update with an effective date, not a code change. It needs a yearly review, and an HR or legal check at launch.

### 5.7 Other plan settings
- Approval mode: auto, manager, or admin (DECIDED, section 6).
- Negative balance allowed, with a limit (e.g. down to -2 days).
- Waiting period: accrues from start date but cannot be booked until N days of service.
- Visibility to coworkers: show plan name, show as "Out of office", or hidden (DECIDED: ability to hide). Managers and admins always see it.
- Calendar status in feeds: Busy, Free, Out of office.
- Counts against working days only, or calendar days (for plans like parental leave).
- Tracked only (no balance), for plans like unpaid or bereavement.

### 5.8 Tenure increases and statutory minimums (DECIDED)
Tenure tiers (available, default off):
- Tiers by completed years of service, e.g. 15 days at 0 years, 20 at 5, 25 at 10. Tiers can move someone to a higher plan level automatically.
- Effective on the work anniversary (prorated for the rest of that plan year) or at the next plan year start. Per plan choice.

Statutory minimums (DECIDED: build in, keep warnings; current entitlements are all above minimum):
- The jurisdiction rules table holds the minimum vacation entitlement by province/state and years of service. Canada: most provinces 2 weeks rising to 3 after 5 years; Quebec 3 weeks after 3 years and 4 after 10; Saskatchewan 3 weeks from the start and 4 after 10; New Brunswick, Nova Scotia and PEI 3 weeks after 8 years; Newfoundland and Labrador 3 weeks after 15 years; federally regulated employers 2, 3 and 4 weeks at 1, 5 and 10 years. Most US states have no vacation minimum. Paid sick leave minimums are held for the roughly 20 states plus DC that require it, and for each province (federal 10 days, BC 5, Quebec 2, Ontario none paid).
- Admins can set any number of days per level above the minimum. The app does not block a lower figure, but warns:
  - when a plan level is saved below the minimum for any jurisdiction it is assigned in,
  - ahead of time, when an employee's coming anniversary will put them below the minimum for their level (e.g. a Nova Scotia employee on 10 days reaching 8 years of service), giving the admin time to move them up a level,
  - in a compliance report listing every employee below a minimum.
- Confidence in the figures: moderate. Sources conflict on Alberta, PEI and Yukon; every value is checked against the provincial or state source before launch.

The app tracks time, not money. Canadian vacation pay percentages (4%, 6%, 8%) are WorkLinks' job.

## 6. Approval workflow

DECIDED:
- Per plan, approval mode is one of: auto-approve, primary manager, or tenant admin.
- Second approval: when an absence runs more than 10 working days in a row, the request also needs the primary manager's own manager (next level). The next-level manager is notified when step one is approved. If there is no next-level manager, the step falls back to a tenant admin.
- Running total: the 10-day test counts the new request plus any of the person's existing approved or pending bookings, in any plan, that join it with no working day in between (weekends and public holidays do not break a run). Example: a Friday wellbeing day followed by two weeks of vacation is 11 days in a row and needs the second approval.
- Off switch: the second approval can be turned off per plan, and the threshold (default 10) is set per company.

Rules and edge cases:
- A request is pending until every required step approves. Any denial ends it, and a denial needs a comment.
- If the requester has no manager, the request goes to a tenant admin.
- An approver cannot approve their own request.
- HR admins see every open request and can decide on behalf of a manager who is away; the decision is logged as an override.
- Backup approver: a manager can delegate approvals for a date range. Requests pending more than N days send a reminder, then escalate to an admin.
- Amendments and cancellations of approved time off follow the same route, judged on the new dates and the new running total.
- Every approval action is logged with time, actor and comment.

## 7. Security, privacy and tenancy

### 7.1 Tenant isolation (DECIDED: shared DB now, separable later, DB must block cross-company reads)
- One PostgreSQL database. Every tenant-owned table has a `tenant_id` column and PostgreSQL Row Level Security policies keyed to a per-connection tenant setting. If the app forgets to set it, queries return nothing (fails closed). The app's database role cannot bypass RLS.
- Automated tests in CI attempt cross-tenant reads and writes and must fail.
- Built for later separation:
  - UUID primary keys (no shared number sequences), no foreign keys between tenants.
  - A tenant registry maps each tenant to a database connection. Today all point to the shared database.
  - Files stored under a per-tenant prefix.
  - Moving a tenant: copy that tenant's rows into a new database, verify counts and checksums, switch the registry entry, delete from the shared database. Scripted, with no code changes.

### 7.2 Domains and branding (DECIDED)
- Each tenant gets a subdomain on our domain (e.g. acme.<ourdomain>) and can add its own custom domain (e.g. timeoff.acme.com) via a DNS CNAME record, with certificates issued automatically.
- The domain identifies the tenant before login; the login page shows that tenant's logo and colours.
- Session cookies scoped to the tenant's domain, so a session for one company is never valid on another.

### 7.3 Authentication (DECIDED: mix of Google and Microsoft; email link acceptable)
- Sign-in options per tenant: Google Workspace, Microsoft Entra ID (365), and email magic link.
- MFA required for tenant admins and the platform owner.
- REC: run authentication inside our own Canadian-hosted stack (Auth.js or a self-hosted identity server) instead of a US SaaS auth vendor. I could not confirm a Canadian data region for Clerk, WorkOS or Auth0, and the user directory is personal data.

### 7.4 Hosting in Canada (DECIDED: data must be hosted in Canada)
- REC: AWS Canada (Central), Montreal (ca-central-1), for the app, managed PostgreSQL, file storage and email sending. Backups copied to AWS Canada West (Calgary) so disaster recovery stays in Canada.
- Not recommended for this requirement: Vercel (sources conflict on whether it offers Canadian-only hosting; its global edge network caches outside Canada) and Neon (no Canadian region found). Supabase does document a Canada (Central) region and is an acceptable alternative for the database.
- Note: PIPEDA does not itself require Canadian hosting, so this is your contractual or policy choice, and a sound one for HR data. Quebec Law 25 requires a privacy impact assessment before personal information leaves Quebec; Canadian hosting keeps that simple.

### 7.5 Branding and theming (DECIDED)
- Default theme: light blues in the family of the Asensean logo, kept light in tone, with dark text for contrast.
- Per tenant: upload a logo, pick a primary and accent colour (or a preset). The app derives hover, border and tint shades and checks text contrast against WCAG AA; a colour that fails is adjusted or refused with a message.
- Light and dark mode for every theme.

### 7.6 Other controls
- Sensitive plans (sick, wellbeing, medical) private by default: coworkers and feeds see "Out of office" only.
- TLS everywhere, encryption at rest, comments encrypted at the field level.
- Immutable audit log: logins, approvals, admin edits, balance adjustments, exports, tenant switches, API key use.
- Retention configurable per tenant (default 7 years for payroll-relevant records).
- API keys scoped per tenant and purpose, hashed at rest, rotatable, rate limited. Webhooks signed (HMAC).

## 8. Integrations

### 8.1 Calendar sync (Google, Microsoft 365, Apple)
1. ICS subscription feed (v1): private, revocable URL per person and per team. Name, dates, half-day marker and status only; private plans show "Out of office". Refresh timing is controlled by the calendar app (Google often 8 to 24 hours).
2. Direct push (v1.1): per-user OAuth to Google Calendar and Microsoft Graph, writing events within seconds of approval and optionally setting Outlook's out-of-office status. Apple has no push API, so Apple stays on ICS.

### 8.2 WorkLinks payroll (DECIDED: all four companies use it)
- No public WorkLinks API documentation found. WorkLinks advertises API integrations and secure file transfer and is a BambooHR marketplace partner, so a partner channel exists. ACTION for you: request API or partner documentation through your WorkLinks account manager.
- Design: map each plan to a WorkLinks earning/absence code per tenant; send approved absences per pay period; send corrections for changes after a period closes; match employees by WorkLinks employee number.
- Fallback built first: a per-pay-period import file in WorkLinks' format, downloadable or sent by SFTP. This works on day one and becomes the test fixture for the API later.

### 8.3 Jira (DECIDED: on the roadmap, not in v1; Confluence page declined)
All Jira work sits in the roadmap and backlog (sections 11 and 12). v1 builds the pieces Jira will later use (the availability service and the event log), so no rework is needed when it is switched on.

Roadmap v1.1, buildable now on documented Atlassian APIs:
- (b) Absence issues. Per tenant, connect a Jira Cloud site via OAuth 2.0 (3LO) with least-privilege scopes. On approval, create an issue in a designated project (issue type "Absence"), assigned to the employee (matched by email), start and due dates set to the absence dates, title "Name: Out of office", plan type only for non-private plans. Updated or cancelled when the request changes. Each issue carries an original estimate (days x hours per day), so it uses up capacity wherever Jira counts estimates (sprints, Plans). This is the interim answer to (a).
- (d) Availability API. Read-only endpoint: given an email and date range, returns "available" or "out" per day with a half-day marker; no plan type, comments or balances. Per-tenant key with an availability-only scope, optional IP allow list, rate limited, every call logged. Works with Jira Automation's "Send web request" action. Signed webhooks (approved, changed, cancelled) let Jira Automation react to events.

Backlog, not addressable now:
- (a) Native Jira capacity. Blocked: no public API found for time off in Jira Plans or in the Capacity view from Atlassian's 2026 Summer Release (manual entry only, Premium or Enterprise, fixed 40-hour week). Confidence: moderate. Trigger to pick up: Atlassian publishes a Capacity or Plans time-off API. Review quarterly.
- Forge app (Atlassian's native app platform) that shows availability inside Jira issues and boards, reading the (d) API. Trigger: (b) and (d) in use and teams asking for in-Jira views.

### 8.4 Exports (DECIDED)
- v1: CSV and XLSX download (formatted, with a summary tab).
- Google Sheets push: backlog.

## 9. Reports (DECIDED)

Audience: each company's HR team and finance. Reports are admin-only in v1; managers and employees never see them. A separate finance access level is in the backlog.

Design rules for every report (best practice, no house template):
- Title, company name, filters applied, and "Run on <date time, time zone> by <name>" at the top of the screen, the PDF and the XLSX.
- Plain column labels with units ("Days remaining", "Hours accrued"), no codes or abbreviations.
- Every column sortable; filters for location, team, manager, plan, level and date range; a search box.
- Totals row; numbers right-aligned; consistent date format (e.g. 17 Oct 2026).
- One chart only where it helps, always with the table beneath.
- XLSX exports keep the run label, freeze the header row, and turn on filters.

Reports:
1. Who's out (today, week, range).
2. Balance summary per employee and plan, with plan year end projection.
3. Year-end forfeiture preview (days at risk of loss, jurisdiction overrides, statutory warnings).
4. Absence rate and days lost by team, month, plan.
5. Utilisation: entitlement used to date versus expected pace; flags people not taking leave.
6. Approval metrics: volume, time to approve, denial rate per approver.
7. Payroll reconciliation: absences per pay period by WorkLinks code, post-close corrections highlighted.
8. Audit report.
9. Untaken leave liability in hours (DECIDED): unused balance per employee and plan, converted to hours at each person's standard hours per day, with totals by team, location and company. Dollar values are in the backlog.
10. Compliance: employees below a statutory minimum now or within 90 days (coming anniversaries), and jurisdiction overrides applied at the last year end.

Bradford Factor excluded by default: it penalises short repeated absences and can produce discriminatory outcomes for people with disabilities or chronic conditions.

## 10. Proposed technical stack
- Next.js (React, TypeScript), responsive web; no native mobile apps in v1.
- PostgreSQL 16 with RLS. Plain SQL migrations and the postgres.js driver (changed from Drizzle during v1: the separation rules are easier to review as SQL).
- Auth.js (or self-hosted identity server) with Google, Microsoft Entra ID and email link; TOTP MFA.
- Background jobs for accruals, year-end, feeds, payroll files, calendar pushes.
- Email and file storage in Canada.

Cost and hosting by phase (DECIDED: free until a working version is ready, then reassess):
- Build phase (free): develop locally and on a free managed Postgres tier in Canada (Supabase free plan, Canada Central region). Free tiers pause idle projects and have small storage limits, which is fine for building.
- Rule for the free phase: synthetic data only. No real employee names, dates or balances go into any free or non-Canadian service. This keeps the data residency promise intact without paying for it yet.
- Security is the same in the free phase as in production: RLS, MFA, encrypted secrets, audit log. Only scale and uptime differ.
- At release: move to paid Canadian hosting (REC: AWS Montreal with Calgary backups, section 7.4), then load real data. Expected cost for 4 companies and under 100 people is modest, roughly the price of a small database and app server per month; to be priced at reassessment.

## 11. Roadmap
- Stage 3, mock-up: clickable prototype of employee, manager, admin and platform screens with two sample tenants. No backend.
- Stage 4, v1: tenants and domains, auth, people and managers, plan levels and accrual engine (days and hours units, lump sum and periodic, jurisdiction overrides), requests/approvals/amendments with escalation, balances, team calendar, ICS feeds, CSV/XLSX export, WorkLinks file export (including hours-worked import for hours-based plans), reports 1 to 4, 6, 9 (liability in hours) and 10 (compliance), audit log.
- v1.1: Google/M365 direct calendar push; Jira absence issues (b) and availability API with webhooks (d); remaining reports; WorkLinks API if access is granted (replaces the hours-worked CSV import).
- v1.2: Slack/Teams notifications and approvals.

## 12. Backlog
Blocked on an outside dependency:
- Jira native capacity (a). Waiting on an Atlassian API. See 8.3.
- Jira Forge app. After (b) and (d) are in use. See 8.3.
- WorkLinks live API. Waiting on WorkLinks partner documentation; file export covers it until then.

Deferred by choice:
- Google Sheets export (v1 has CSV and XLSX download).
- Salary data: a separate admin-only table and panel holding pay rates, used to show leave liability in dollars. Admin access only, never visible to managers or employees, encrypted at the field level, every view logged.
- Finance access level: a role that can see reports and the salary panel without HR permissions over people and requests.
- Blackout periods (dates when requests are blocked or need admin approval).
- Maximum number of people off at once per team.
- Hourly requests (hours accrual is in v1; booking stays in days and half days).
- Hourly employees and overtime eligibility (actual hours worked from payroll, overtime-eligible flag per person).
- Native mobile apps.
- Per-tenant dedicated database (architecture ready, section 7.1).

Declined:
- Confluence "Who's out" page.
- Bradford Factor report (see section 9).

## 13. Decisions log (N1 to N7)
- N1: primary manager approves; over 10 working days in a row adds the next-level manager.
- N2: no company is federally regulated; provincial rules apply.
- N3: each company has its own Jira Cloud site, Standard or Premium. Design for both; capacity features only where Premium.
- N4: first-year proration rounds to the nearest half day.
- N5: second approval above 10 working days, counted as a running total of joined-up bookings; can be turned off.
- N6: US staff are salaried and not overtime-eligible. Hourly and overtime eligibility are in the backlog.
- N7: jurisdiction overrides apply automatically at year end.

## 14. Backlog and roadmap
The roadmap and backlog now live on a separate tracking board, where items can be added, reprioritised and promoted between stages: https://claude.ai/artifact/YE4qrkARfucrRoSDgnRD1e. Sections 11 and 12 above are a snapshot as of Draft 5; the board is the source of truth from here on.
