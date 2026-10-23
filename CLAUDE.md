# Working notes for Claude on this repository

## Model delegation (owner's instruction, 23 Oct 2026)
- Delegate simpler, low-complexity tasks and builds to lower models; the orchestrating session reviews every result (diff, tests, checks) before it becomes a pull request.
  - **Haiku**: documentation and README updates, PRD/TRD status and change-log edits, rebuilding `docs/files` with `python3 docs/tools/build_docs.py`, PR and CI status checks.
  - **Sonnet**: moderate work such as standard screens and forms, simple service functions with tests, small bug fixes.
- **Ask the owner before escalating to a higher model (Opus)**. Expected for: accrual and statutory logic, the approval engine, sign-in and security, company data separation, and anything where a mistake affects pay, legal compliance or data privacy.
- State which model did each piece of work in the pull request description.

## Process
- Follow `docs/BRANCHING.md`: one branch per roadmap item, pull request with the template, CI green, owner merges.
- Update `docs/PRD.md` and `docs/TRD.md` (status, decisions, change log) and rebuild `docs/files` only when the owner asks, with the phrase "update trd prd docs" (or close variants such as "update trd pad docs"). The update then covers everything merged since the last document version. Owner's instruction, 23 Oct 2026; replaces updating after every merge.
- Never commit secrets or real employee data. Development uses synthetic data only.

## App
- Code is in `app/` (Next.js 15, TypeScript, PostgreSQL 16). See `app/README.md` for running, checks and the separation model.
- Company data access goes only through `withTenant` (`app/src/lib/tenancy.ts`); every new company table needs forced row-level security (the guard test in `app/tests/db/isolation.test.ts` enforces it).
