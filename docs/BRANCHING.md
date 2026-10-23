# Branching and release process

## Branches
- `main` is the default branch. It must always build and pass checks. No direct pushes once branch protection is on.
- Work happens on short-lived branches cut from `main`, one per roadmap board item:
  - `feature/<board-id>-<short-name>`, for example `feature/now-01-company-setup`
  - `fix/<short-name>` for bug fixes
  - `chore/<short-name>` for tooling, dependencies, docs
- Each branch is merged through a pull request, squash-merged so `main` gets one commit per change, then deleted.

## Pull requests
- Link the roadmap board item (board id, e.g. `now-21`).
- Required before merge: automated checks green (lint, type check, unit tests, cross-company data isolation tests) and owner approval.
- Never commit secrets, API keys or real employee data. Secrets live in the hosting provider's secret store.

## Documentation
- After each feature pull request is merged, `docs/PRD.md` and `docs/TRD.md` are updated (status, decisions, design changes, change log) in a small `docs/` pull request, and the Word and PDF copies in `docs/files/` are rebuilt with `python3 docs/tools/build_docs.py`.

## Releases and environments
- Development: deploys automatically from `main` to the free tier. Synthetic data only.
- Production: deploys only from release tags (`v1.0.0` for the Now column, `v1.1.0` for Next, and so on), and only after the security review and the move to paid Canadian hosting are done.
- Hotfix: branch from the release tag as `fix/<name>`, merge to `main` through a pull request, tag a patch release (`v1.0.1`).

## Repository layout
- `app/` application code (added when v1 development starts)
- `docs/` requirements plan and process docs
- `mockup/` clickable prototype (reference only)
- `roadmap/` source of the roadmap board page; the board's items live in its claude.ai database: https://claude.ai/artifact/YE4qrkARfucrRoSDgnRD1e
