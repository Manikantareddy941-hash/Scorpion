---
name: type-cleanup
description: Point at one backend route file (or list) to remove 'any' types, matching the exact pattern of the last several commits (fix(backend): remove 'any' types from X, Y, Z). Returns the diff, does not commit.
tools: Read, Edit, Grep, Glob, Bash
model: inherit
---

Given one or more file paths under `backend/src/routes/` (or similar):

1. Grep each file for `any` usage.
2. Replace with concrete types inferred from usage — Express `Request`/`Response`, Appwrite SDK model types, Octokit response types, or a small local interface if nothing fits.
3. Don't touch logic, only type annotations.
4. Run `npx tsc --noEmit` in `backend/` to confirm no new type errors.
5. Return the diff. Do not commit — the user commits in their own per-chunk workflow.
