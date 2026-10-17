# AAS Time Off Planner: Requirements Plan (Draft 1)

Status: draft for review. Stage 1 of 5 (plan, clarify, mock-up, v1, iterate).
Date: 2026-10-17

## 1. Product summary

A multi-tenant absence management app for small and mid-sized companies. Employees request and track time off against plans assigned to them. Managers see and approve their team's absences. Tenant admins run the company's policies. A platform owner (you) manages every tenant from one console without the tenants' data ever mixing.

## 2. Benchmark against SMB time off tools

| Capability | BambooHR | Timetastic | Vacation Tracker / Leave Dates | This app (proposed v1) |
|---|---|---|---|---|
| Multiple leave policies, assigned per person/team | Yes, unlimited | Yes | Yes | Yes |
| Accrual rules (per pay period, monthly, annual grant, tenure tiers) | Yes, varies by location/department | Annual grant, pro-rata | Yes | Yes |
| Balance projection to a future date | Yes | Partial | Partial | Yes |
| Multi-step approvers | Up to 5 per policy | 1 approver plus backup | 1 to 2 | Up to 3 levels plus backup approver |
| Approver comment on deny/change | Yes | Yes | Yes | Yes |
| "Who's Out" team calendar | Yes | Yes (wallchart) | Yes | Yes |
| Calendar feed (iCal) | Limited | Yes, respects privacy settings | Yes | Yes, tokenized and privacy-filtered |
| Private leave types (details hidden from peers) | Partial | Yes, applies to feeds, Slack, API | Yes | Yes, default for sensitive types |
| Busy / Available / Out of Office per type | No | Yes | Partial | Yes |
| Public holidays by region | Yes | Yes | Yes | Yes (Canadian provinces plus US states first) |
| Payroll export / integration | Yes, marketplace incl. WorkLinks | CSV | CSV, some payroll | WorkLinks plus CSV/XLSX |
| Reporting | Strong | Basic | Basic | Strong (see section 8) |
| Multi-company console | No (one account per company) | No | No | Yes, core differentiator |

What to copy: BambooHR's policy model and balance projection, Timetastic's privacy model (private leave types that stay private everywhere, including calendar feeds and the API), the wallchart calendar.

What to avoid: BambooHR's cluttered request screen and its per-company silo. Timetastic's slow feed refresh is a constraint of iCal itself, not something we can fully fix (see section 6).

## 3. Users and roles

| Role | Scope | Can do |
|---|---|---|
| Employee | Own records in one tenant | Request, amend, cancel own time off. See own balances and history. Subscribe to own feed. See team calendar in "busy only" form (configurable). |
| Manager | Own records plus direct and assigned reports | Everything an employee can, plus approve/deny/amend for reports, team calendar with leave types for reports, team feed. |
| Tenant Admin (HR) | Whole tenant | Manage people, managers, policies, holidays, balances, adjustments, reports, exports, integrations. |
| Platform Owner (you) | All tenants, one at a time | Create tenants, switch into any tenant (every switch audited), cross-tenant usage dashboard with no employee-level data mixed. |

Rules:
- A person can hold several roles. Manager scope comes from explicit reporting lines, not from the job title.
- Managers cannot approve their own requests. Requests from a manager route to their manager or a tenant admin.
- Every read of another person's record by an admin or the platform owner is written to an audit log.

## 4. Functional requirements

### 4.1 Employee
- Home screen: balances per assigned plan (available, booked/pending, used, projected at year end), upcoming time off, primary "Request time off" button.
- Request form: plan (only plans assigned to the person), start date, end date, part-day option (AM/PM or hours), comment, optional attachment (e.g. medical note, admin only visibility).
- Live calculation before submit: working days counted after weekends and holidays, resulting balance, warning if negative or overlapping an existing request, warning if a team blackout period applies.
- Amend: edit dates or type of a pending request freely. Amending an approved request creates a change request that goes back through approval; the original stays in force until the change is approved.
- Cancel: pending requests cancel instantly. Approved future requests need approval to cancel (configurable). Past requests are locked except by admins.
- History: all own requests with status and approver comments.
- Personal calendar feed (see section 6).

### 4.2 Manager
- Team view: table of reports with each plan balance, pending requests count, next absence.
- Approval inbox with one-click approve/deny and comment. Shows overlap with other team members on the same dates.
- Calendar: month wallchart (rows = people, columns = days) and a standard month grid. Filters by team, location, plan type.
- Team feed for Google/M365/Apple.
- Email notifications; Slack/Teams in a later phase.

### 4.3 Tenant Admin
- Employee directory with search by name, email, employee ID, team, manager.
- Add or edit time off on behalf of anyone, with a required reason. Logged.
- Balance adjustments (credit/debit) with reason, effective date. Logged.
- Policy builder: plan name, unit (days or hours), accrual method, accrual frequency, cap, carryover limit and expiry, waiting period, tenure tiers, negative balance allowed or not, requires approval or auto-approve, private or public, calendar display (Busy/Free/Out of Office).
- Holiday calendars per location, preloaded for Canadian provinces and US states, editable.
- Bulk import of employees and opening balances from CSV/XLSX.
- Exports: CSV, XLSX, Google Sheets (push to a sheet via OAuth).
- Reports (section 8).
- Integrations: WorkLinks, Jira, Confluence, API keys, webhooks.

### 4.4 Platform Owner
- Tenant list, create/suspend tenant, branding per tenant (logo, colour, subdomain).
- "Enter tenant" switch. You see one tenant's data at a time; there is no screen that blends employees across tenants.
- Cross-tenant metrics only at aggregate level (seat counts, request volumes, integration health).

## 5. Security and privacy

- Tenant isolation: every table carries `tenant_id`. PostgreSQL Row Level Security enforces it in the database, not only in application code. Each request sets the tenant context; a query without one returns nothing. Integration tests attempt cross-tenant reads and must fail.
- Optional stronger isolation for a tenant that demands it contractually: separate database per tenant. More cost and ops; not recommended unless a client requires it.
- Authentication: SSO via Google Workspace and Microsoft Entra ID (OIDC), plus email magic link for companies without either. MFA required for Tenant Admin and Platform Owner.
- Authorization: role plus relationship checks on every endpoint (is this person my report?), enforced server side.
- Sensitive leave: wellbeing, sick, bereavement, medical and similar types are private by default. Peers and calendar feeds see "Out of office" only. Attachments visible to tenant admins only.
- Encryption: TLS everywhere, encryption at rest, comments and attachments encrypted at the field/object level.
- Data residency: host in Canada if any tenant is Canadian and WorkLinks-connected (WorkLinks hosts in Canada and is SOC 2 Type II). Quebec Law 25 and PIPEDA apply to Canadian staff; health-adjacent leave reasons count as sensitive personal information.
- Audit log: immutable record of logins, approvals, admin edits, balance adjustments, exports, tenant switches, API key use.
- Retention: configurable per tenant (e.g. 7 years for payroll-relevant records), with deletion on employee offboarding where law allows.
- API security: scoped, per-tenant API keys and OAuth for integrations, hashed at rest, rotatable, rate limited, IP allow list optional, outgoing webhooks signed with HMAC.

## 6. Calendar sync (Google, Microsoft 365, Apple)

Two mechanisms, and the difference matters for "real time":

1. ICS subscription feed (v1). A private, revocable URL per person and per team. Works in Google Calendar, Outlook/M365 and Apple Calendar with no OAuth. Events carry only name, dates, half-day marker and "Out of office". No leave type for private plans, no comments, no balances. Limitation: the calendar app decides how often to refresh. Google typically refreshes every 8 to 24 hours; Outlook roughly every few hours; Apple lets the user choose (as often as every 5 minutes). This is not real time.
2. Direct push (v1.1). Per-user OAuth to Google Calendar API and Microsoft Graph. When a request is approved, changed or cancelled, the app writes the event into the person's own calendar (and an optional shared team calendar) within seconds, and can set Outlook's Out-of-Office status. Apple has no equivalent server push API; Apple users stay on ICS.

Recommendation: ship ICS first, add Google/M365 push in the next increment.

## 7. Integrations

### 7.1 WorkLinks payroll
WorkLinks does not publish a public developer API. It advertises API integrations, secure file transfer and custom data flows, and is a BambooHR marketplace partner, so a partner channel exists. We need partner access and documentation from WorkLinks before committing to a design.

Design either way:
- Map each plan to a WorkLinks earning/absence code per tenant.
- Send approved absences per pay period, with corrections for changes after a period has closed.
- Pull employee IDs and, if available, balances to reconcile.
- Fallback until API access is confirmed: a WorkLinks-formatted import file (CSV) generated per pay period, delivered by SFTP or download.

### 7.2 Jira and Confluence
Interpretation: absences should feed delivery planning in Atlassian. Options, in order of value:
1. Push approved absences into Jira as availability data: e.g. a Jira issue or calendar entry per absence in a "Team Absence" project, or as a capacity input to Jira Plans (Advanced Roadmaps) team schedules.
2. Confluence: a live "Who's out" macro or a page per team updated on change.
3. Expose our own REST API plus signed webhooks so Jira Automation can call in ("is X out on these dates?") and react to events.

Security: OAuth 2.0 (3LO) app with least-privilege scopes, per-tenant connection, no leave type or comment sent for private plans, all calls logged. A Forge app is the more native long-term route.

### 7.3 Exports and public API
- CSV, XLSX (formatted, with a summary tab), Google Sheets push.
- REST API (read-only in v1): people, absences, balances. Scoped keys per tenant.

## 8. Reports

Built to the standards used in HR analytics, each with filters (tenant, location, team, manager, plan, date range), on-screen chart plus table, and export to PDF/XLSX:

1. Who's out (today, this week, date range).
2. Balance summary per employee and plan, with year-end projection.
3. Accrued leave liability (balance x daily rate) for finance. Requires pay rate data; optional.
4. Absence rate and days lost by team, month, plan (absence days / scheduled working days).
5. Utilisation: percent of entitlement used to date versus expected pace. Flags people at risk of losing carryover or of burnout from not taking leave.
6. Approval metrics: volume, average time to approve, denial rate per manager.
7. Payroll reconciliation: absences per pay period by payroll code, with post-close corrections highlighted.
8. Audit report: admin edits and adjustments.

Caution on the Bradford Factor: many HR tools offer it, but it penalises short repeated absences and can produce discriminatory outcomes for staff with disabilities or chronic conditions. Leave it off by default; if included, restrict to sick-type plans and add a warning.

## 9. Proposed technical stack

- Web app: Next.js (React, TypeScript), responsive for mobile browsers. Native mobile apps out of scope for v1.
- Database: PostgreSQL with Row Level Security; Prisma or Drizzle ORM.
- Auth: Auth.js or a managed provider (Clerk/WorkOS) for OIDC SSO and MFA. WorkOS is the stronger fit for multi-tenant SSO.
- Jobs: background queue for accruals, feed rebuilds, payroll pushes, calendar pushes.
- Hosting: managed Postgres and app hosting in a Canadian region (e.g. AWS ca-central-1 or Azure Canada Central) if residency matters.
- Email: transactional provider (Postmark or SES).

## 10. Phasing

- Stage 3, mock-up: clickable HTML prototype of the employee, manager, admin and platform screens with sample data for two fake tenants. No backend.
- Stage 4, v1: auth, tenants, people, plans, accruals, requests/approvals/amendments, balances, team calendar, ICS feeds, CSV/XLSX export, core reports 1, 2, 4, 6, audit log.
- v1.1: Google/M365 direct push, Google Sheets export, WorkLinks (API or file), remaining reports.
- v1.2: Jira/Confluence, public API and webhooks, Slack/Teams notifications.

## 11. Open questions

See the numbered list in the chat reply; answers will be folded into Draft 2 of this document.
