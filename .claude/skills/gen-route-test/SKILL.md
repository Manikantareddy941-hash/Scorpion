---
name: gen-route-test
description: Generate a Jest/supertest test file for a backend route, following the existing *.test.ts pattern in backend/src/routes
---

# Generate route test

1. Read an existing test in `backend/src/routes/*.test.ts` (e.g. `healthRoutes.test.ts` or `gateRoutes.test.ts`) as the template — match its supertest setup, mocking style, and assertion style.
2. For the target route file, cover: happy path per endpoint, auth-missing/forbidden case, validation-error case, and one error-path (downstream failure mocked).
3. Mock external deps the same way the template does (Appwrite client, Octokit, BullMQ queue) — don't introduce a new mocking library.
4. Name the file `<routeName>.test.ts` next to the route file.
5. Run `npm test -- <routeName>` in `backend/` to confirm it passes before reporting done.
