---
name: remove-any-types
description: Replace 'any' with proper types in a backend route/file, following this repo's established pattern from recent commits (fix(backend): remove 'any' types from X)
---

# Remove any types

Given a target file (usually `backend/src/routes/*.ts`):

1. Grep the file for `: any`, `as any`, `any[]`, `Record<string, any>`.
2. For each, infer the real type from usage:
   - Express handlers: use `Request`/`Response` generics or the repo's existing typed request helpers if present.
   - DB/Appwrite results: type from the Appwrite SDK's document/model types.
   - Octokit responses: use Octokit's generated response types.
3. If no clean type exists, define a local interface next to the usage — don't import from unrelated files just to avoid `any`.
4. Run `npm run lint` and `npx tsc --noEmit` (or `npm run build`) in `backend/` to confirm no new errors.
5. Commit message style matches recent history: `fix(backend): remove 'any' types from <fileA>, <fileB>`.

Do not refactor unrelated logic in the same pass — type-only changes, one file group per commit.
