# Lifecycle: Test Phase (DAST)

The Test phase runs **after a successful build**, against the deployed staging
application — dynamic analysis of the running target, not source code. It
complements the Build phase's static scanners (SAST/SCA/secrets/IaC).

## What shipped

| Capability | Engine | Backend |
|---|---|---|
| Web app scanning (spider / active / passive), auth-aware | OWASP ZAP | `services/zapService.ts`, `workers/zapWorker.ts`, `routes/dastRoutes.ts` |
| Template-based known-CVE / misconfig detection | Nuclei | `services/nucleiService.ts`, `workers/nucleiWorker.ts`, `routes/nucleiRoutes.ts` |
| Content-discovery fuzzing (hidden endpoints) | ffuf | `services/ffufService.ts`, `workers/ffufWorker.ts`, `routes/ffufRoutes.ts` |
| Suite orchestration + release gate for CI | — | `scripts/runDastSuite.ts`, `.github/workflows/dast-staging.yml` |

All three normalize findings into the **same** `ingestVulnerabilitiesDelta('dast', …)`
sink, so the existing release gate (`routes/gateRoutes.ts`,
`workers/pipelineEnforcer.ts`) scores them with no gate-side change. Findings are
tagged by `tool` (`zap` / `nuclei` / `ffuf`) for per-scanner filtering.

Each scanner runs on its own restart-safe BullMQ queue (retries, bounded by a
per-scan timeout) and marks the scan `failed` with a clear message if its binary
is missing — no silent gaps.

## API

| Method | Path | Body |
|---|---|---|
| POST | `/api/scan/dast/dast` | `target_url`, `scanMode` (spider\|active\|passive), optional `auth.bearerToken` |
| GET  | `/api/scan/dast/dast/:scanId/status` | — |
| POST | `/api/scan/nuclei` | `target_url`, optional `tags` |
| GET  | `/api/scan/nuclei/:scanId/status` | — |
| POST | `/api/scan/ffuf` | `target_url`, optional `rate` (req/s) |
| GET  | `/api/scan/ffuf/:scanId/status` | — |

Launch from the UI via the **Run DAST** button on the Scan Results page
(`components/DastScanModal.tsx`).

## Runtime requirements

- **ZAP**: a reachable ZAP daemon — `ZAP_BASE_URL`, `ZAP_API_KEY`.
- **Nuclei / ffuf**: the `nuclei` and `ffuf` binaries on the backend host/image
  (same as trivy/semgrep). ffuf uses a bundled wordlist at
  `backend/assets/ffuf-common.txt` (override with `FFUF_WORDLIST`).
- Tunables: `ZAP_POLL_TIMEOUT_MS`, `NUCLEI_TIMEOUT_MS`, `FFUF_TIMEOUT_MS`,
  `FFUF_RATE`.

## CI

`dast-staging.yml` is an **opt-in** `workflow_dispatch` job (kept out of the PR
`ci.yml` so the PR pipeline never depends on a live staging box). It runs
`runDastSuite` against staging, waits for every scan to complete, then runs
`pipelineEnforcer`, which fails closed. Arm it with repo secrets
`SCORPION_API_URL`, `SCORPION_API_TOKEN`, `DAST_TARGET_URL`.

## Deliberately deferred

- **IAST** (Contrast / Seeker). Requires an agent instrumented *inside* the
  target app's runtime (JVM/Node bytecode). That is a per-target integration
  Scorpion can't add generically from outside, and DAST + Nuclei already give
  the gate equivalent runtime coverage. Revisit when there's a specific
  instrumentable target.
- **ffuf API-mutation fuzzing** (schema-driven param mutation). Needs a wired-in
  OpenAPI/Swagger spec per target, which doesn't exist yet. Content-discovery
  mode shipped; add API-mutation when a spec source is available.
- **Ephemeral env provisioning** (Terraform/Helm spin-up/teardown). That is CI
  infrastructure, not application code — Scorpion *scans* a staging URL, it does
  not *provision* one. Belongs in pipeline YAML once a real staging cluster
  exists.
