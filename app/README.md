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
5. `npm run dev`, then open http://localhost:3000/platform and http://northwind.localhost:3000

## Checks
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. The database tests need `DATABASE_URL_ADMIN`, `DATABASE_URL_APP` and `DATABASE_URL_PLATFORM` pointing at a throwaway database, which they wipe.

## Not yet
Sign-in (roadmap item now-03) comes next. Until then the platform console only runs when `ENABLE_DEV_PLATFORM=true` outside production.
