# AAS Time Off Planner: application

Next.js (TypeScript) on PostgreSQL 16. See `../docs/PLAN.md` for requirements and `../docs/BRANCHING.md` for the branch and release process.

## Company data separation
- Every company-owned table has `tenant_id` and PostgreSQL row-level security, forced on.
- The app connects as `aas_app` and reaches company data only through `withTenant(id, fn)` in `src/lib/tenancy.ts`, which sets `app.tenant_id` for one transaction. With no company set, queries return nothing.
- `aas_app` cannot read the companies table; it can only look up one company's public branding by host.
- The platform console connects as `aas_platform`, which can manage companies but cannot read any company data.
- `tests/db/isolation.test.ts` checks all of this against a real database and runs in CI on every pull request.

## Run locally
1. Start PostgreSQL 16 and create a database (for example `aas_dev`).
2. `cp .env.example .env.local` and set the three connection URLs. Use made-up passwords for development.
3. `npm ci`
4. `set -a; . ./.env.local; set +a; npm run db:migrate && npm run db:seed` (synthetic sample data only)
5. `npm run dev`, then open http://localhost:3000/platform (sign in as `owner@aas.example`) or http://northwind.localhost:3000 (sign in as `maya@northwind.example`, `daniel@northwind.example`, or `priya@northwind.example` for HR admin). Sign-in emails print in the terminal.
6. To add a real platform owner: `npm run platform:add-owner -- you@example.com "Your Name"`

## Checks
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. The database tests need `DATABASE_URL_ADMIN`, `DATABASE_URL_APP` and `DATABASE_URL_PLATFORM` pointing at a throwaway database, which they wipe.

## Sign-in
- Email sign-in link: single use, 15 minutes, stored only as a SHA-256 hash. The emailed link opens a page with a Continue button, so email scanners that open links cannot use it up.
- The same "check your email" answer is shown whether or not an address is known.
- Sessions last 12 hours, use a host-only, HttpOnly cookie (one company's session is never sent to another company's address) and are revoked on sign-out.
- Platform owners sign in at the root address with separate tables, cookie and database role.
- Limits: 5 links per address and 30 per network address every 15 minutes (in memory; moves to shared storage when there is more than one server).

## Two-step sign-in
- Required for HR admins and the platform owner after the email link: a 6-digit code from an authenticator app (RFC 6238), with 10 one-time recovery codes shown once at set-up.
- Keys are encrypted with AES-256-GCM using `MFA_ENCRYPTION_KEY` (never stored in the database); recovery codes are stored as hashes. A code can't be used twice, and 5 wrong codes lock the session out for 15 minutes.
- Employees and managers are not asked for a code yet.

## People and settings (HR admin)
- `/people`: directory with search (name, email, team, location, manager, job title) and active, inactive or all.
- Add or edit: name, email, job title, employee number, start date, province or state, team and location (created by typing a new name), primary manager (approves), other managers (see and get notified), role, hours per day, work days for part-time staff.
- Rules: managers must be active and in the same company; no one manages themselves and no management loops; at least one active HR admin stays; deactivating signs the person out everywhere. Every change is audit-logged with what changed.
- `/settings`: company time zone and the second-approval threshold (default 10 working days in a row).
- Employees and managers get a 404 on these pages.

## Not yet
Google and Microsoft 365 sign-in is the next branch. Production email (Amazon SES in Canada) comes with the release item.
