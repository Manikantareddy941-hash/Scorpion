---
name: bullmq-job
description: Scaffold a new BullMQ queue + worker pair, following backend/src/queues/scanQueue.ts and backend/src/workers/scanWorker.ts
---

# New BullMQ job

1. Read `backend/src/queues/scanQueue.ts` and `backend/src/queues/scanQueueWorker.ts` (and `backend/src/workers/scanWorker.ts`) as templates — match Queue/Worker setup, ioredis connection reuse, job options (retries/backoff), and concurrency settings.
2. Create `backend/src/queues/<name>Queue.ts` — exports a typed `Queue<JobPayload>` plus an `add<Name>Job(payload)` helper. Define `JobPayload` as a named interface, no `any`.
3. Create `backend/src/workers/<name>Worker.ts` — `Worker` processor with the same error-handling/logging shape as `scanWorker.ts`.
4. Wire startup in wherever the existing workers are started (grep for where `scanWorker`/`scanQueueWorker` is imported in `backend/src/index.ts`).
5. Run `npx tsc --noEmit` in `backend/` to confirm types are clean.
