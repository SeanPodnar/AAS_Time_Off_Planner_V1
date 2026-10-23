---
title: "AAS Time Off Planner: Product Requirements Document"
subtitle: "Version 1.1"
date: "23 October 2026"
---

# 1. Document control

| Item | Detail |
|---|---|
| Product | AAS Time Off Planner |
| Document | Product Requirements Document (PRD) |
| Version | 1.1 (see change log, section 13) |
| Date | 23 October 2026 |
| Owner | Sean, Asensean (platform owner) |
| Companion | Technical Requirements Document (TRD) v1.0 |
| Sources | Requirements plan Draft 5 (`docs/PLAN.md`), roadmap board, owner decisions to date |
| Status of build | Built and merged to `main`: company setup, company data separation, short labels, email sign-in, two-step sign-in, people management, company settings |

Requirement IDs (FR-, NFR-) are referenced by the TRD and by the roadmap board. Priorities: **M** must have for v1, **S** should have (v1.1), **C** could have (v1.2 or later).

# 2. Summary

AAS Time Off Planner is a multi-company absence management app for small and mid-sized companies. Employees request time off against plans assigned to them and see their balances. Managers see and approve their team's absences. Each company's HR admins run their own policies. The platform owner runs every company from one console, and no company ever sees another company's data.

The launch is four companies, the largest with about 20 employees, with staff across Canada and the United States. Data is hosted in Canada.

## 2.1 Problem

Small companies track leave in spreadsheets, email threads and payroll notes. Balances drift, approvals get lost, statutory minimums are missed, and payroll gets the wrong numbers. Off-the-shelf tools such as BambooHR and Timetastic solve this for one company at a time, so an operator who serves several companies pays for and logs in to several accounts, and none of them handle Canadian and US statutory rules side by side.

## 2.2 Goals

1. One place for employees to request time off and see accurate balances.
2. Approvals that follow the company's rules, including a second approval for long absences.
3. Balances that follow each company's plans and each employee's jurisdiction, with warnings before anyone falls below a legal minimum or loses protected leave.
4. Strict separation between companies, enforced by the database, with one console for the platform owner.
5. Clean hand-off to payroll (WorkLinks) and to calendars, with private leave types kept private.

## 2.3 Non-goals for v1

- Payroll calculation, vacation pay percentages or pay rates (WorkLinks owns money; salary data is a backlog item).
- Hourly booking, hourly employees and overtime eligibility (backlog).
- Native mobile apps (the web app is responsive).
- Time and attendance, scheduling or shift management.
- Blackout periods and team "maximum off at once" limits (backlog).

# 3. Benchmark

| Capability | BambooHR | Timetastic | Vacation Tracker | AAS Time Off Planner |
|---|---|---|---|---|
| Multiple plans per person | Yes | Yes | Yes | Yes, with levels |
| Accrual options | Yes | Annual grant | Yes | Lump sum, annual, semi-annual, quarterly, monthly, per hours worked |
| Statutory minimum and carryover checks | Partial (US) | No | Partial | Yes, Canadian provinces and US states, warnings and automatic overrides |
| Approvals | Up to 5 per policy | 1 plus backup | 1 to 2 | Manager, admin or automatic; second approval for long runs |
| Private leave types | Partial | Yes | Yes | Yes, applies to calendars, feeds and API |
| Multi-company console | No | No | No | Yes |

Copied on purpose: BambooHR's policy model and balance projection, Timetastic's privacy model, the wallchart calendar.

# 4. Users and roles

| Role | Scope | Summary |
|---|---|---|
| Employee | Own records, one company | Requests, amends and cancels own time off; sees balances; sees team calendar under privacy rules; personal calendar feed |
| Manager | Own records plus reports | Employee rights plus approvals for direct reports, team view, team feed. A manager is anyone with active direct reports. |
| HR admin | One company | Everything in that company: people, plans, balances, adjustments, reports, exports, integrations, branding. Must use two-step sign-in. |
| Finance (backlog) | One company | Reports and salary panel without HR rights over people |
| Platform owner | All companies, one at a time | Creates and configures companies; enters a company console (logged); sees only aggregate counts across companies. Must use two-step sign-in. |

Rules:

- Each person has exactly one **primary manager**, who approves. A person may also have secondary managers, who see and are notified but do not approve.
- Nobody approves their own request. A person with no manager goes to HR.
- HR admins can decide on behalf of an absent manager; the decision is logged as an override.

# 5. Release scope

| Release | Theme | Contents (board items) |
|---|---|---|
| v1 "Now" | First working version | Company setup and short labels; data separation; sign-in (email link, Google, Microsoft 365) and two-step for admins; people and managers; plan builder with levels; accrual engine; year-end with jurisdiction overrides; statutory minimums; requests, amend, cancel; approvals with second step; team calendar with privacy; calendar feed links; email notifications; core reports; XLSX and CSV export; WorkLinks pay period file; holiday calendars; audit log; security review; move to paid Canadian hosting |
| v1.1 "Next" | Connected | Direct Google and Microsoft 365 calendar push; Jira absence issues; availability API and webhooks for Jira Automation; utilisation and payroll reconciliation reports; API keys; dark and light mode switch with dark default; multiple time zones (home time zone per person) |
| v1.2 "Later" | Chat | Slack and Microsoft Teams notifications and approvals |
| Backlog | Not scheduled | Salary data and dollar liability; finance role; hourly employees and overtime; Google Sheets export; blackout periods; maximum off per team; hourly requests; mobile apps; dedicated database per company; Jira Forge app; MCP server for AI assistants |
| Blocked | Outside dependency | WorkLinks live API (partner documentation); native Jira capacity (no Atlassian API) |
| Declined | | Confluence "Who's out" page; Bradford Factor report |

# 6. Functional requirements

## 6.1 Companies and branding

| ID | Requirement | Pri | Acceptance criteria | Status |
|---|---|---|---|---|
| FR-01 | The platform owner can create a company with full legal name, short label, sign-in address, optional custom domain, brand colour and country. | M | Company appears in the console; invalid or duplicate values are refused with a message on the field. | Built |
| FR-02 | Each company has a short label (required, unique ignoring case and spaces, 24 characters or fewer). The short label is used in the company selector and every notification; the full legal name is used on reports, exports and the audit log. | M | Duplicate "northwind" vs "Northwind" refused; email subjects use the label; reports show the legal name. | Built (selector and notification use grow with features) |
| FR-03 | Each company is reached at its own sign-in address (`name.<platform domain>`) or its own custom domain. Unknown addresses show "not found". | M | Company page shows its label and colour; unknown address returns 404. | Built |
| FR-04 | HR admins can upload a logo and pick brand colours; the app checks text contrast against WCAG AA and adjusts button text automatically. | M | Low-contrast colour flagged; buttons stay readable. | Partly built (colour set at creation; upload and editing pending) |
| FR-05 | Company selector for the platform owner is a dropdown of short labels, searchable when long. | M | Matches mock-up. | Pending |
| FR-06 | Each company has a time zone used for "today", approval deadlines and year-end processing (default America/Toronto in Canada, America/New_York in the US). | M | Year-end runs at midnight company time. | Built (setting); used by the accrual engine when built |

## 6.2 Sign-in and access

| ID | Requirement | Pri | Acceptance criteria | Status |
|---|---|---|---|---|
| FR-10 | Email sign-in link: single use, 15 minutes, same answer whether or not the address is known, opens a Continue page so scanners cannot use it up. | M | Reused, expired or other-company links refused. | Built |
| FR-11 | Google Workspace and Microsoft 365 sign-in for companies that use them. Email must match an active person in that company. | M | Sign-in works from any company address through one fixed return address. | Pending owner app registrations and platform domain |
| FR-12 | Two-step sign-in (authenticator app) required for HR admins and the platform owner, with 10 recovery codes. | M | Admin pages unreachable until the code is entered. | Built |
| FR-13 | Sessions last 12 hours, are limited to the company's address, and end on sign-out. | M | Copied session rejected on another company's address. | Built |
| FR-14 | People marked inactive cannot sign in. | M | | Built |
| FR-15 | Platform owner "enter company" visits are recorded in that company's audit log. | M | | Pending |

## 6.3 People

| ID | Requirement | Pri | Acceptance criteria | Status |
|---|---|---|---|---|
| FR-20 | HR admins can add, edit and deactivate people: name, email, job title, team, location, jurisdiction (province or state, and city where a local law applies), start date, primary and secondary managers, role, standard hours per day, work days. | M | A manager must be active and belong to the same company; no one manages themselves; no management loops; at least one active HR admin remains; deactivation signs the person out. | Built (city-level jurisdiction pending) |
| FR-21 | Bulk import of people and opening balances from CSV or XLSX, with a preview and row-level errors before anything is saved. | M | | In progress (people); opening balances follow the plan engine |
| FR-22 | Directory search by name, email, team, manager, location or job title, with active, inactive or all. | M | | Built |

## 6.4 Plans and accrual

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-30 | Unlimited admin-defined plans (starter templates: Vacation, Wellbeing, Sick, Personal, Bereavement, Parental, Unpaid, Lieu). | M | |
| FR-31 | Plan levels: each plan can have levels with their own days per year; each person has one level per plan; a mid-year level change prorates the rest of the plan year. | M | |
| FR-32 | Plan year starts on any date (default 1 January), set per plan. | M | |
| FR-33 | Units: days and half days (default) or hours. Requests are always in days and half days; hours plans deduct the person's standard hours per day. | M | |
| FR-34 | Accrual methods: lump sum (at plan year start, on hire, or on anniversary), periodic (annual, semi-annual, quarterly, monthly; credited at period start, or end if chosen), per hours worked (salaried staff on their standard week), manual grants with reason. | M | |
| FR-35 | First year prorated from the start date by remaining months (start month counts if on or before the 15th), rounded to the nearest half day; configurable per plan. | M | 15 days, start 10 June: 8.75 rounds to 9.0. |
| FR-36 | Year end per plan: no carryover, capped carryover with optional expiry date, unlimited, or maximum balance cap; payout flag for reporting. | M | |
| FR-37 | Jurisdiction overrides apply automatically at year end (for example, no forfeiture of earned vacation in California, Colorado, Montana and Nebraska; statutory vacation in Canada cannot simply expire). Each override is shown in the year-end preview and the audit log. | M | |
| FR-38 | Statutory minimum table by province and state and years of service. Warnings on plan save, ahead of service anniversaries, and in a compliance report. The app warns; it does not block. | M | |
| FR-39 | Tenure increases per plan, off by default. | M | |
| FR-40 | Other plan settings: approval mode, negative balance limit, waiting period, coworker visibility (plan name, Out of office, hidden), calendar status, working days or calendar days, tracked only. | M | |
| FR-41 | Holiday calendars per province and state, preloaded and editable, plus company holidays. | M | |
| FR-42 | Balance projection to plan year end and to any future date. | M | |

## 6.5 Requests and approvals

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-50 | Request form: plan (only assigned plans), first and last day, half day on first or last day, comment. Live summary: working days after weekends and holidays, balance after, overlap with own requests, team members already off, who approves. | M | |
| FR-51 | Approval mode per plan: automatic, primary manager, or HR admin. | M | |
| FR-52 | Second approval: when an absence runs more than 10 working days in a row, the primary manager's own manager also approves (falls back to HR admin). The run counts joined-up bookings in any plan; weekends and holidays do not break it. Threshold set per company; can be turned off per plan. | M | Friday wellbeing day plus two weeks vacation = 11 days, two approvals. |
| FR-53 | Amend: pending requests edit freely; changes to approved time off go back through approval while the original dates stay booked. | M | |
| FR-54 | Cancel: pending cancels at once; approved future time needs approval (per plan); past time admin only. | M | |
| FR-55 | Decline needs a comment. Reminders for pending approvals, then escalation to HR. Backup approver for a date range. | M | |
| FR-56 | HR admins can add or amend time off for anyone with a required reason, optionally approved immediately and optionally overriding the negative balance limit; logged. | M | |
| FR-57 | Balance adjustments (credit or debit) with reason and effective date; logged. | M | |

## 6.6 Calendars

| ID | Requirement | Pri |
|---|---|---|
| FR-60 | Team calendar (wallchart and month grid) with filters by team, location and plan. Coworkers see the plan name, "Out of office", or nothing, by plan setting; managers see types for their reports; HR sees all. | M |
| FR-61 | Private, resettable calendar feed links (ICS) for each person and each team, for Google, Outlook and Apple. Names and dates only; no comments or balances. | M |
| FR-62 | Direct Google Calendar and Microsoft 365 connection (events within seconds; optional Outlook out-of-office). | S |
| FR-63 | Dark and light mode switch, dark by default, saved per person. | S |
| FR-64 | Multiple time zones. Each person has a home time zone (default: company time zone). Requests are recorded against the requester's home time zone: dates, "today", past and future rules, half days, deadlines and escalations use it. Managers, HR and teammates see requests localized to their own zone, with the requester's zone shown when it differs. Calendar entries, reminders and notifications go out in each recipient's zone; reminders at a sensible local hour. Reports state the time zone in the run label. | S |

## 6.7 Reports and exports

All reports are HR admin only. Each shows title, company legal name, filters and a "Run on <date, time, time zone> by <name>" label on screen and in every export, with sortable columns, filters, plain labels with units and a totals row.

| ID | Report | Pri |
|---|---|---|
| FR-70 | Who's out (today, week, range) | M |
| FR-71 | Balance summary with projection | M |
| FR-72 | Year-end forfeiture preview (30 days before year end, with overrides) | M |
| FR-73 | Absence rate and days lost | M |
| FR-74 | Approval metrics | M |
| FR-75 | Untaken leave liability in hours | M |
| FR-76 | Compliance (below a minimum now or within 90 days) | M |
| FR-77 | Audit report | M |
| FR-78 | Utilisation; payroll reconciliation | S |
| FR-79 | XLSX and CSV export of every report (run label, frozen header, filters on) | M |
| FR-80 | Liability in dollars from an admin-only salary table; finance role; Google Sheets export | C |

## 6.8 Integrations

| ID | Requirement | Pri |
|---|---|---|
| FR-90 | WorkLinks pay period import file: plan to WorkLinks code mapping per company; corrections after a period closes; download or SFTP. | M |
| FR-91 | WorkLinks live API once partner documentation is available. | Blocked |
| FR-92 | Jira absence issues per approved absence, with time estimates. | S |
| FR-93 | Availability API (out or available by date, no plan type) and signed webhooks for Jira Automation and other systems; scoped API keys. | S |
| FR-94 | Slack and Microsoft Teams notifications and approvals. | C |
| FR-95 | MCP server so people can use the app from AI assistants under their own role and company. | C |

## 6.9 Notifications

| ID | Requirement | Pri |
|---|---|---|
| FR-100 | Email for: request submitted, needs your approval, approved, declined, changed, cancelled, reminder, second approval needed, year-end preview, statutory warning. Subjects start with the company short label. Private plan names never appear in emails to anyone but the person, their approvers and HR. | M |

## 6.10 Audit

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-110 | Append-only audit log of sign-ins, approvals, admin edits, adjustments, exports, plan changes, platform owner visits. Entries cannot be edited or deleted. | M | Built (log and first events) |

# 7. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-01 | Separation | No company can read or change another company's data, enforced by the database. Automated tests prove it on every change. |
| NFR-02 | Residency | All production data, backups, email and logs in Canada. |
| NFR-03 | Privacy | Sensitive plans (sick, wellbeing, medical) private by default. Quebec Law 25 and PIPEDA observed; privacy impact assessment before launch for Quebec staff. |
| NFR-04 | Security | OWASP ASVS level 2 as the target; two-step sign-in for privileged roles; encryption in transit and at rest; secrets outside code; dependency audit on every change; penetration test before real data. |
| NFR-05 | Accessibility | WCAG 2.2 AA for all screens, in light and dark mode, including company brand colours. |
| NFR-06 | Performance | Pages under 1 second at the 95th percentile for up to 100 concurrent users; reports under 3 seconds for 500 employees. |
| NFR-07 | Availability | 99.5% monthly during business hours (Canada and US time zones) after release. |
| NFR-08 | Recovery | Point-in-time recovery; lose no more than 15 minutes of data; restore within 4 hours. |
| NFR-09 | Retention | Configurable per company, default 7 years for payroll-relevant records; deletion on request where law allows. |
| NFR-10 | Responsiveness | Works at phone width (390 px) without sideways scrolling. |
| NFR-11 | Cost | Free during build with synthetic data only; reassess at release. |

# 8. Success measures

| Measure | Target, 90 days after release |
|---|---|
| Requests made in the app rather than email or spreadsheets | 95% or more |
| Median time from request to decision | Under 1 business day |
| Payroll corrections caused by leave data | Zero in two consecutive pay periods |
| Employees below a statutory minimum without a warning | Zero |
| Cross-company data incidents | Zero |

# 9. Assumptions and dependencies

- All four companies use WorkLinks. US staff are salaried and not overtime-eligible. No company is federally regulated.
- Each company has its own Jira Cloud site (Standard or Premium).
- Owner provides: platform domain; Google and Microsoft app registrations; WorkLinks partner contact; GitHub Pro (to enforce branch protection) before real code merges at scale.
- Statutory figures are checked by an HR or employment law reviewer before launch.

# 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WorkLinks API never available | Medium | Medium | File export works on day one |
| Statutory table wrong or out of date | Medium | High | Legal review at launch; yearly review; dated rules table |
| Cross-company data leak | Low | Severe | Database-enforced separation, guard tests, penetration test |
| Branch protection not enforced on free GitHub plan | High (today) | Medium | Upgrade to GitHub Pro; pull-request discipline meanwhile |
| Single owner and single developer | High | Medium | Documented process, CI, this PRD and TRD |
| Scope growth before v1 | Medium | Medium | Roadmap board with explicit promotion |

# 11. Open decisions for the owner

| # | Decision | Needed by |
|---|---|---|
| D1 | Platform domain (for example aas-timeoff.ca) | Google and Microsoft sign-in |
| D2 | Google and Microsoft app registrations (instructions sent separately) | Google and Microsoft sign-in |
| D3 | ~~Part-time and non-standard work weeks~~ Resolved: in v1 (work days and hours per day per person, built) | |
| D4 | ~~Company time zones~~ Resolved: one per company in v1 (built); home time zone per person in v1.1 (FR-64) | |
| D5 | WorkLinks file format and partner contact | Payroll export |
| D6 | GitHub Pro upgrade | Before more contributors |
| D7 | Legal reviewer for statutory tables | Before release |
| D8 | Should employees and managers also be offered (optional) two-step sign-in? | Before release |
| D9 | Release budget for Canadian hosting (estimate in TRD) | Release |

# 12. Glossary

| Term | Meaning |
|---|---|
| Company (tenant) | One customer organisation with its own people, plans and data |
| Short label | Display name used in the selector and notifications |
| Plan | A type of time off with its own rules (Vacation, Sick) |
| Level | A version of a plan with its own days per year (Vacation Senior 20) |
| Run | Consecutive working days off, joined across bookings |
| Jurisdiction | Province or state (and city) whose employment law applies to a person |

# 13. Change log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 23 Oct 2026 | First full scope. |
| 1.1 | 23 Oct 2026 | D3 and D4 resolved (part-time work weeks and company time zone in v1, both built). FR-06, FR-20 and FR-22 built. FR-21 in progress. Added FR-64, multiple time zones, to v1.1. These documents are now updated after each merged feature. |
