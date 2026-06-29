---
name: pr-check
description: Pre-PR checklist for this repo - lint, typecheck, test, no 'any', no secrets in diff
---

# PR check

Run before opening a PR. Report pass/fail per step, don't auto-fix unless asked.

1. `git diff main...HEAD --stat` — confirm scope matches intent.
2. Frontend (repo root): `npm run lint`, `npm run typecheck`, `npm run test`.
3. Backend (`backend/`): `npm run lint`, `npx tsc --noEmit`, `npm test`.
4. `git diff main...HEAD` — grep for `: any`, `as any` in touched files.
5. `git diff main...HEAD --name-only` — flag any of: `.env`, `*.pem`, `*.key`, `password_resets.sql`.
6. Summarize: green/red per step, list of blocking items only.
