---
name: new-scan-route
description: Scaffold a new backend scan/compliance route following the existing pattern in backend/src/routes (dastRoutes, dockerScanRoutes, complianceRoutes, etc.)
---

# New scan route

1. Read one existing similar route file in `backend/src/routes/` (e.g. `dockerScanRoutes.ts`) as the template — match its structure: router setup, auth middleware, typed request/response, error handling.
2. Create `backend/src/routes/<name>Routes.ts` mirroring that structure. No `any` types — see [[remove-any-types]] conventions.
3. Register the router in the main app entry (wherever the other `*Routes` are mounted — grep for `app.use(` in `backend/src/index.ts`).
4. Add a Jest test file alongside, following the existing `*.test.ts` pattern in the same routes folder if one exists.
5. Run `npm run lint && npm test` in `backend/` before reporting done.
