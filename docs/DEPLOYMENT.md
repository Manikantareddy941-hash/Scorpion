# Deploying Scorpion

A $0/month deployment. Render runs the API container; Postgres and Redis come
from external free tiers because Render's own free Postgres expires after 30
days and takes the database with it.

| Piece | Provider | Free tier |
|-------|----------|-----------|
| API | Render (Docker web service) | 750 hrs/mo, sleeps when idle |
| Postgres | Neon | 0.5 GB |
| Redis | Upstash | 10k commands/day |
| Auth | Appwrite Cloud | existing project |

## 1. Provision the data stores

**Neon** — create a project, copy the connection string. It must start with
`postgres://` or `postgresql://`. This matters: `isPostgresEnabled()` checks the
scheme, and a `file:` URL routes every repository to the wrong driver.

**Upstash** — create a Redis database, copy the connection URL.

## 2. Deploy the API

Render → New → Blueprint → point at this repository. It reads `render.yaml` and
prompts for each `sync: false` secret. The ones with `generateValue: true`
(`IDE_SCAN_SECRET`, `FALCO_SECRET`, `SCORPION_WEBHOOK_SECRET`,
`CI_INGEST_API_KEY`) are generated for you — read them out of the dashboard when
you configure the corresponding sender.

`preDeployCommand` runs `npm run migrate:up` before traffic shifts, so the schema
is never behind the code that expects it.

## 3. Verify

```bash
curl https://<your-service>.onrender.com/api/health
```

Expect `status: ok` and a `services` block. Check every scanner reports
available — `false` there means that tool will report `unavailable` on scans,
never "clean".

## Environment variables that change behaviour

| Variable | Effect if wrong |
|---|---|
| `NODE_ENV=production` | Set in the Dockerfile. Outside production the dev auth bypass becomes *possible* (still needs `ALLOW_DEV_AUTH_BYPASS=true`), and the IDE route stops requiring its secret. |
| `DATABASE_URL` | Must be a `postgres://` URL. Anything else silently falls back to legacy Appwrite storage for repositories and to SQLite for the scan-audit store. |
| `RUNNER_MODE=binary` | Set in the Dockerfile. There is no Docker daemon in a hosted container, so `docker` mode makes every scan fail. |
| `ALLOWED_ORIGINS` | Unset in production is how a CORS policy quietly becomes "any origin". |
| `IDE_SCAN_SECRET` | Required in production; without it `/api/scan/ide/scan` returns 503 rather than trusting a proxy-forwarded address. |
| `ALLOW_DEV_AUTH_BYPASS` | **Never set this in a deployment.** It disables authentication. It is inert while `NODE_ENV=production`, but do not rely on that alone. |

## Known limitations

**The free instance sleeps.** First request after idle takes ~50s. Fine for
evaluation, not for a customer-facing SLA.

**ZAP and Falco do not run in binary mode.** ZAP needs a JVM and browser stack;
Falco needs kernel-level eBPF and is a cluster agent, not a hosted process. Both
report `unavailable` — never a clean result. Full DAST needs a host with a
Docker daemon (`RUNNER_MODE=docker`).

**Two datastores are required.** 11 repositories read Postgres; the remaining 6
still read Appwrite, and Appwrite is also the identity provider. Both must be
reachable. This is a consequence of deploying mid-migration.

**Tenant isolation has not been audited.** Do not put two customers on one
instance until it has been. For a security product a cross-tenant leak is not a
bug report, it is the end of the business.

**Scanner versions are pinned** in `backend/setup-tools.sh`. Bump them
deliberately; an unpinned scanner changes its findings between builds, which
makes a regression impossible to attribute.
