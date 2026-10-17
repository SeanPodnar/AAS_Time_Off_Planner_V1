# AAS Time Off Planner: Requirements Plan (Draft 2)

Status: draft for review. Stage 2 of 5 (plan, clarify, mock-up, v1, iterate).
Date: 2026-10-17
Changes from Draft 1: owner answers to questions 1 to 8 and 10 to 17 folded in; research on accrual law, approvals, hosting and Atlassian added. Decisions marked DECIDED, recommendations marked REC, open items marked OPEN.

## 1. Product summary

A multi-tenant absence management app for small and mid-sized companies. Employees request and track time off against plans assigned to them. Managers see and approve their team's absences. Tenant admins run the company's policies. The platform owner manages every tenant from one console without tenant data ever mixing.

Launch scale (DECIDED): 4 companies, largest about 20 employees, employees across Canada (all provinces) and the US (all states). Each company gets its own login domain and branding.

## 2. Benchmark against SMB time off tools

| Capability | BambooHR | Timetastic | Vacation Tracker / Leave Dates | This app |
|---|---|---|---|---|
| Multiple leave policies, assigned per person/team | Yes, unlimited | Yes | Yes | Yes, unlimited, admin-defined |
| Accrual frequency options | Yes | Annual grant | Yes | Annual, semi-annual, quarterly, monthly |
| Configurable plan year | Yes | Yes | Yes | Yes, per plan |
| First-year proration from hire date | Yes | Yes | Yes | Yes |
| Tenure-based increases | Yes | Yes | Yes | Yes, off by default (see 5.6) |
| Balance projection to a future date | Yes | Partial | Partial | Yes |
| Approval levels | Up to 5 per policy | 1 plus backup | 1 to 2 | Per plan: auto, manager, admin, plus threshold escalation |
| "Who's Out" team calendar | Yes | Yes (wallchart) | Yes | Yes |
| Calendar feed (iCal) | Limited | Yes, respects privacy | Yes | Yes, tokenized and privacy-filtered |
| Private leave types | Partial | Yes, applies to feeds, Slack, API | Yes | Yes, per plan visibility setting |
| Statutory minimum checks | Partial (US) | No | Partial | Yes, warnings by province/state |
| Payroll integration | Marketplace incl. WorkLinks | CSV | CSV, some payroll | WorkLinks plus CSV/XLSX |
| Jira integration | No | No | Some | Absence issues plus availability API |
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
REC: each person has exactly one primary manager, who is the approver. Secondary managers see the person's absences and balances and get notified, but do not approve. This avoids two managers approving and denying the same request. OPEN: confirm.

## 4. Functional requirements

### 4.1 Employee
- Home: balance card per assigned plan (available now, pending, used, projected at plan year end), upcoming time off, "Request time off" button.
- Request form: plan (only plans assigned to the person), start date, end date, half-day option on the first and last day (AM/PM), comment.
- Units (DECIDED): days and half days only. No hourly requests.
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

### 5.2 Allotment frequency (DECIDED)
- Annual: full entitlement granted once per plan year.
- Semi-annual: half granted every 6 months.
- Quarterly: a quarter granted every 3 months.
- Monthly: one twelfth granted every month.
- REC: credit at the start of each period (front-loaded per period). Option to credit at period end instead. Start-of-period is the BambooHR and Timetastic default and lets people book ahead.

### 5.3 First year (DECIDED: earned from start date)
- Entitlement is prorated from the employee's start date to the end of the first plan year.
- REC proration rule: count remaining months, including the start month if the start date is on or before the 15th. Example: 15 days per year, start date June 10, plan year January to December: 7 months remaining, 15 x 7/12 = 8.75 days.
- Rounding: balances are held in half days, so prorated amounts round to the nearest half day. REC: round up (8.75 becomes 9.0). Rounding down can put a Canadian employee below their statutory minimum. Configurable per plan: up, down, nearest.
- With monthly/quarterly/semi-annual frequency, the first partial period is prorated the same way, then normal periods apply.

### 5.4 Year end
Per plan (DECIDED: some plans have no carryover):
- No carryover: balance resets to zero at plan year start ("use it or lose it").
- Capped carryover: up to N days carry; option for carried days to expire on a date (e.g. must be used by March 31).
- Unlimited carryover.
- Option: allow a maximum balance cap at which accrual pauses.
- Year-end processing runs automatically, and admins get a preview report a few weeks before showing who will lose days.

### 5.5 Other plan settings
- Approval mode: auto, manager, or admin (DECIDED, section 6).
- Negative balance allowed, with a limit (e.g. down to -2 days).
- Waiting period: accrues from start date but cannot be booked until N days of service.
- Visibility to coworkers: show plan name, show as "Out of office", or hidden (DECIDED: ability to hide). Managers and admins always see it.
- Calendar status in feeds: Busy, Free, Out of office.
- Counts against working days only, or calendar days (for plans like parental leave).
- Tracked only (no balance), for plans like unpaid or bereavement.

### 5.6 Tenure increases (DECIDED: available, default off)
- Tiers by completed years of service, e.g. 15 days at 0 years, 20 at 5, 25 at 10.
- Effective on the work anniversary (prorated for the rest of that plan year) or at the next plan year start. Per plan choice.

### 5.7 Compliance guardrails (REC, new)
"Default off" for tenure increases conflicts with Canadian law if the base vacation entitlement is two weeks. Most provinces require a third week after 5 years of service, Quebec after 3 years and a fourth after 10, Saskatchewan gives 3 weeks from the start and 4 after 10, and the Atlantic provinces move to 3 weeks at 8 years (15 in Newfoundland and Labrador). Federally regulated employers follow the Canada Labour Code tiers (2, 3, 4 weeks at 1, 5, 10 years).

Similarly, "no carryover" on a vacation plan is unlawful or restricted in some places. California, Colorado, Montana and Nebraska prohibit forfeiting earned vacation. In Canada, statutory vacation must be taken or paid out; it cannot simply expire.

The app will not block admins, but it will:
- Store each employee's work province/state.
- On plan setup and on each year-end preview, warn when an employee's entitlement falls below the statutory floor for their jurisdiction and service, or when a no-carryover rule would forfeit statutory vacation.
- Ship the statutory table as data, reviewed annually. Confidence in the figures above: moderate; they come from secondary sources that partly conflict (Alberta, PEI, Yukon) and must be checked against provincial and state sources before launch.

Sick leave: US paid sick leave laws (about 20 states plus DC in 2026) mostly accrue at 1 hour per 30 hours worked, which does not fit a days-only design. REC: run US sick plans as an annual front-loaded grant that meets the strictest applicable state (e.g. California requires 5 days/40 hours front-loaded). Front-loading avoids hour tracking and, in most states, satisfies carryover rules. Some cities (e.g. San Francisco) still require carryover. Canadian paid sick days vary (federal 10, BC 5, Quebec 2, Ontario 0 paid), so sick plans need per-province variants or a generous single plan.

The app tracks time, not money. Canadian vacation pay percentages (4%, 6%, 8%) are WorkLinks' job.

## 6. Approval workflow

DECIDED:
- Per plan, approval mode is one of: auto-approve, primary manager, or tenant admin.
- Escalation threshold: if a request exceeds N working days (default 10), a second approval step is added after the first. The second approver is either the approver's own manager (next level) or a tenant admin, chosen per plan. The second approver is notified when step one is approved.

Rules and edge cases (REC):
- Request is pending until all required steps approve. Any denial ends it.
- If the requester has no manager (top of the tree) or is their own manager's manager, the request goes to a tenant admin.
- If a step has no next-level manager, it falls back to a tenant admin.
- An approver cannot approve their own request.
- Backup approver: a manager can delegate approvals for a date range (e.g. while on leave). Requests pending more than N days send a reminder, then escalate to an admin.
- Amendments and cancellations of approved time follow the same route, judged on the new length.
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

### 7.5 Other controls
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

### 8.3 Jira (DECIDED: a, b, d yes; Confluence page no)
(b) Absence issues in Jira:
- Per tenant, connect a Jira Cloud site via OAuth 2.0 (3LO) with least-privilege scopes.
- On approval, create an issue in a designated project (issue type "Absence"), assigned to the employee (matched by email), with start and due dates set to the absence dates. Title "Name: Out of office". Plan type included only for non-private plans. Updated or cancelled when the request changes.

(a) Capacity in Jira:
- Finding: I found no public API for time off in Jira Plans or in the new Capacity view Atlassian released in its 2026 Summer Release. That view records time off manually, needs Jira Premium or Enterprise, and uses a fixed 40-hour week. Confidence: moderate.
- REC for v1: the absence issues from (b) carry an original estimate (days x hours per day), so they consume the person's capacity wherever Jira counts estimates (sprints, Plans). This is the common workaround.
- REC for later: a Forge app (Atlassian's native app platform) that reads our availability API and shows availability inside Jira, plus a check every quarter on whether Atlassian opens a Capacity API.

(d) Availability API for Jira workflows:
- Read-only endpoint: given an email and date range, returns "available" or "out" per day with a half-day marker. No plan type, no comments, no balances.
- Per-tenant API key with an availability-only scope, IP allow list optional, rate limited, every call logged.
- Works with Jira Automation's "Send web request" action, e.g. warn when an issue is assigned to someone who is out, or block a sprint start.
- Signed webhooks (request approved, changed, cancelled) so Jira Automation can react to events.

### 8.4 Exports
- CSV, XLSX (formatted, with summary tab), Google Sheets push (OPEN, question 18).

## 9. Reports

Each with filters (location, team, manager, plan, date range), chart plus table, and PDF/XLSX export:
1. Who's out (today, week, range).
2. Balance summary per employee and plan, with plan year end projection.
3. Year-end forfeiture preview (days at risk of loss, statutory warnings).
4. Absence rate and days lost by team, month, plan.
5. Utilisation: entitlement used to date versus expected pace; flags people not taking leave.
6. Approval metrics: volume, time to approve, denial rate per approver.
7. Payroll reconciliation: absences per pay period by WorkLinks code, post-close corrections highlighted.
8. Audit report.
9. Accrued leave liability in dollars: only if pay rates are supplied (OPEN, question 19).

Bradford Factor excluded by default: it penalises short repeated absences and can produce discriminatory outcomes for people with disabilities or chronic conditions.

## 10. Proposed technical stack
- Next.js (React, TypeScript), responsive web; no native mobile apps in v1.
- PostgreSQL with RLS on AWS RDS, ca-central-1; Drizzle ORM (first-class RLS support).
- Auth.js (or self-hosted identity server) with Google, Microsoft Entra ID and email link; TOTP MFA.
- Background jobs for accruals, year-end, feeds, payroll files, calendar pushes, Jira sync.
- AWS SES (ca-central-1) for email; S3 (ca-central-1) for files.
- OPEN: confirm budget and any preferred provider (question 21).

## 11. Phasing
- Stage 3, mock-up: clickable prototype of employee, manager, admin and platform screens with two sample tenants. No backend.
- Stage 4, v1: tenants and domains, auth, people and managers, plan and accrual engine, requests/approvals/amendments with escalation, balances, team calendar, ICS feeds, CSV/XLSX export, WorkLinks file export, reports 1 to 4 and 6, audit log, statutory warnings.
- v1.1: Google/M365 direct calendar push, Jira absence issues (b) and availability API (d), Google Sheets export, remaining reports, WorkLinks API if access is granted.
- v1.2: Jira capacity (a) via Forge app, Slack/Teams notifications.

## 12. Future features log
- Blackout periods (dates when requests are blocked or need admin approval).
- Maximum number of people off at once per team.
- Slack and Microsoft Teams notifications and approvals.
- Hourly requests.
- Confluence "Who's out" page (declined for now).
- Bradford Factor report (excluded by default, see section 9).
- Native mobile apps.
- Per-tenant dedicated database (architecture ready, section 7.1).

## 13. Open questions
Carried over: 9 (partly answered by 6), 18 to 23.
New:
- N1. Primary manager approves; secondary managers view only. Confirm.
- N2. Are any of the four companies federally regulated (banking, telecom, interprovincial transport)? That switches Canadian rules to the Canada Labour Code.
- N3. Jira: is each company on its own Jira Cloud site, and on Standard or Premium? Capacity features need Premium.
- N4. Rounding: round first-year proration up to the nearest half day (recommended) or nearest?
- N5. Escalation default of 10 working days for a second approval step: confirm the number and whether it counts the whole request or a rolling total.
