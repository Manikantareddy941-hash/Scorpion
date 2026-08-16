# Operations Runbook

Deployment-time configuration for the supply-chain signing pipeline, the scan
runner, and the Appwrite provenance migration.

Everything here is **operator action requiring credentials or cluster access**.
None of it is enforced by CI, and most of it fails in ways that do not look like
failures — which is the reason this document exists.

---

## 1. Cosign: the three-tier configuration model

The single most common mistake is treating "cosign is configured" as one switch.
It is three independent tiers with **different variables in different places**,
and they are not interchangeable.

| Tier | Where it lives | Variables | Consumed by |
|---|---|---|---|
| **CI supply side** | GitHub repository secrets | `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD` | `.github/workflows/scanner-images.yml` |
| **Backend verification** | Mounted file + env var | `COSIGN_PUB_KEY_PATH` | `deployService` signature gate |
| **Backend signing** | Mounted file + env vars | `COSIGN_KEY_PATH`, `COSIGN_PASSWORD` | `buildService` |

The GitHub secrets are **values**. The backend variables are **filesystem paths**
to mounted keys. Setting the GitHub secrets does nothing for the backend, and
mounting keys into the backend does nothing for CI.

### Run the tiers in this order

Order matters because tier 4 hard-blocks production if tier 2 is not already in
place.

#### Step 1 — CI supply side

```bash
cosign generate-key-pair                      # produces cosign.key + cosign.pub
gh secret set COSIGN_PRIVATE_KEY < cosign.key
gh secret set COSIGN_PASSWORD                 # prompts; the passphrase from above
gh workflow run scanner-images.yml            # do not wait for the 03:00 schedule
```

Verify the **`Sign the digest`** step passes. Until it does, no signed scanner
image has ever been published and the zero-egress scanning model is theoretical.

> **A green PR check does NOT verify this.** `Log in to GHCR`, `Push`,
> `Install cosign` and the signing step are all gated
> `if: github.event_name != 'pull_request'` (scanner-images.yml:216, 225, 240).
> Pull-request runs skip the entire signing path by construction and go green
> regardless. Only a `schedule` or `workflow_dispatch` run on `main` exercises it.
>
> This is also why the open `sigstore/cosign-installer` upgrade PR cannot be
> validated by its own CI — its checks pass without ever running cosign.

#### Step 2 — Backend verification (do this BEFORE step 4)

Mount `cosign.pub` into the backend container and set:

```
COSIGN_PUB_KEY_PATH=/keys/cosign.pub
```

Safe in isolation: it declares verification intent without arming enforcement.

**Confirmation signal.** At boot, `probeSigningReadiness` logs
`[Cosign] No signing keys configured — builds will not be signed and the deploy
signature gate has nothing to check.` when neither key var is set. That line
disappearing is how you know the mount landed.

#### Step 3 — Backend signing (optional)

Only needed if the backend should sign its own builds.

```
COSIGN_KEY_PATH=/keys/cosign.key
COSIGN_PASSWORD=<passphrase>
```

`COSIGN_PASSWORD` appears **nowhere in `backend/src`** — grepping for it finds
nothing. It is read by the cosign binary itself: `cosignService` calls
`execFileAsync(cmd, args, { timeout })` with no `env:` option, so the child
inherits `process.env`. Absence from the code is not absence of requirement.

> **The 30-second stall.** No stdin is attached to that child process. If
> `COSIGN_KEY_PATH` points at a passphrase-protected key and `COSIGN_PASSWORD` is
> missing from the container environment, cosign cannot answer its own prompt. It
> does not fail cleanly with a config error — it hangs until `COSIGN_TIMEOUT_MS`
> (30s, `cosignService.ts:21`) kills it, once per signing attempt.
>
> Symptom: a build that takes 30 seconds longer than usual and then reports a
> signing failure. That is a missing `COSIGN_PASSWORD`, not a slow registry.

#### Step 4 — Enforcement and isolation

```
REQUIRE_IMAGE_SIGNATURE=true
RUNNER_MODE=kubernetes
```

> **Never set `REQUIRE_IMAGE_SIGNATURE` before step 2.** Enforcement demands a
> signature claim while there is no key to verify one with, so **every production
> deploy is blocked**. `probeSigningReadiness` detects exactly this and logs it at
> `error` on boot rather than letting it surface mid-release:
>
> `[Cosign] REQUIRE_IMAGE_SIGNATURE is set but COSIGN_PUB_KEY_PATH is not.
> Every production deploy will be BLOCKED …`
>
> Note the environment vocabulary: enforcement matches both `prod` and
> `production`, trimmed and lower-cased, so `deployService` (which passes
> `production`) and `k8sAdmission` (which passes `prod`) agree.

---

## 2. Runner mode: the silent gate

`RUNNER_MODE=kubernetes` is the **only** way to get isolated, zero-egress
execution. `getRunner()` auto-probes between `docker` and `binary` and can never
select `kubernetes` on its own.

The failure mode is silent: with `RUNNER_MODE` unset, scans keep succeeding —
just outside isolation. Nothing turns red. Contrast the cosign gap on the same
pipeline, which fails a workflow visibly every day.

Binary mode additionally runs scanners as host processes, so **ZAP and Falco are
simply absent** while the scan still reports success.

### Detection

Every boot emits one structured event:

```json
{
  "event": "RUNNER_MODE_SELECTED",
  "mode": "docker",
  "configuredMode": null,
  "isFallback": true,
  "isolated": false,
  "zapAvailable": true,
  "falcoAvailable": true
}
```

**Alert on `isolated == false`, scoped to staging and production.**

Do not alert on `isFallback == true` alone. It is true whenever the mode was not
explicitly requested — an unset `RUNNER_MODE` included — so it fires on every
default-configured developer machine. `isolated` is the field that matches the
actual requirement, and it stays correct if a fourth runner mode is ever added.

#### Loki

```logql
{app="scorpion-backend", env=~"staging|production"}
  | json
  | event = "RUNNER_MODE_SELECTED"
  | isolated = "false"
```

#### Datadog

```
@event:RUNNER_MODE_SELECTED @isolated:false env:(staging OR production)
```

---

## 3. Appwrite provenance migration

Provisions the `provenance` attribute on `pipeline_runs` and `build_pipelines`.
**Must run before deploying the image that writes provenance** — until the
attribute exists, those writes fail.

```bash
cd backend && npm run check:provenance-attribute   # read-only inspection
cd backend && npm run migrate:build-provenance     # only if unapplied
```

### Must be run from `backend/`

`dotenv` resolves `.env` from `process.cwd()`
(`check_provenance_attribute.ts:30`). Run from the repository root and it loads
zero variables.

Required in `backend/.env`:

```
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
APPWRITE_API_KEY
APPWRITE_DATABASE_ID
```

Missing any of them produces an explicit `[FATAL] missing env var(s): …` naming
each one. That message is deliberate: these scripts previously resolved `.env`
relative to `__dirname`, which worked under `ts-node` but pointed at
`dist/backend/.env` once compiled, so `node dist/...` loaded nothing and died
inside node-appwrite with an opaque *"Endpoint must be a valid string"*.

### The attribute size is permanent

`PROVENANCE_SIZE = 4096` (`migrate_build_provenance.ts:101`).

**Appwrite does not shrink a string attribute in place.** Editing that constant
has no effect anywhere the migration has already run; recovering it means
dropping and recreating the column, which discards every stored statement. Check
per environment whether the migration has already run rather than assuming the
current value is what is deployed.

Oversize is the real risk: Appwrite rejects the whole write, and provenance is
written alongside the build record — so the write path treats provenance as
best-effort rather than losing the build record to save the metadata about it.

---

## 4. Credential rotation

Repository clone tokens were written to logs in cleartext before the
`utils/git.ts` fix: `pipelineService` builds `https://<token>@…` for private
repos, and both the success and error paths logged the full URL.

The code fix stops new leakage. It does nothing about tokens already shipped to a
SIEM or retained log store. **Any machine PAT used for cloning while that code
was live should be treated as compromised and rotated.**

---

## Quick reference: what fails how

| Missing | Failure shape | Where you see it |
|---|---|---|
| `COSIGN_PRIVATE_KEY` / `COSIGN_PASSWORD` (CI) | Loud | `scanner-images.yml` fails daily at `Sign the digest` |
| `COSIGN_PUB_KEY_PATH` **with** `REQUIRE_IMAGE_SIGNATURE` | Loud, total | Every production deploy blocked; `error` at boot |
| `COSIGN_PASSWORD` (backend, protected key) | Slow | 30s stall per signing attempt, then failure |
| `RUNNER_MODE` | **Silent** | Nothing. Scans succeed outside isolation — alert on `isolated == false` |
| Appwrite env vars | Loud | `[FATAL] missing env var(s): …` |
