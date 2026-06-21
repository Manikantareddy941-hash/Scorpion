<div align="center">

# 🛡️ SCORPION

**Enterprise-Grade AI-Powered DevSecOps Orchestration Platform**

Unified multi-engine scanning · real-time threat telemetry · policy-driven CI/CD gates · AI-powered remediation

[![CI](https://github.com/Manikantareddy941-hash/Scorpion/actions/workflows/ci.yml/badge.svg)](https://github.com/Manikantareddy941-hash/Scorpion/actions/workflows/ci.yml)
[![Scorpion Scan](https://github.com/Manikantareddy941-hash/Scorpion/actions/workflows/stackpilot-scan.yml/badge.svg)](https://github.com/Manikantareddy941-hash/Scorpion/actions/workflows/stackpilot-scan.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Core Workflows](#core-workflows)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Security Hardening](#security-hardening)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## Overview

SCORPION is a production-grade security control plane that protects applications across their entire lifecycle — from a developer's local VS Code sandbox, through GitHub pull requests, to production deployment runtimes. It unifies SAST, SCA, secrets, IaC, and DAST scanning behind one dashboard, gates releases with policy-as-code, and uses Gemini/OpenAI to generate drop-in remediation patches.

## Features

| Category | Capability |
|---|---|
| 🔍 **Scanning** | Parallel SAST (Semgrep), SCA (Trivy), secrets (Gitleaks), IaC (Checkov), Python (Bandit), DAST (OWASP ZAP) |
| 🤖 **AI Remediation** | "TONY" engine — context-aware patch generation via Gemini, applied as reviewable diffs |
| 🚪 **Policy Gates** | OPA/Rego policy-as-code blocking PR merges on GitHub commit status checks |
| 🏢 **Multi-Tenancy** | Team-scoped repos/scans/incidents, fine-grained IAM, Okta/Microsoft SSO via Appwrite OAuth2 |
| 🧵 **Async Pipeline** | Redis-backed BullMQ scan queue, decoupled from the request thread |
| 🧩 **Threat Modeling** | STRIDE-based React Flow canvas with Gemini-assisted analysis |
| 🔐 **Supply Chain** | cosign container image signing/verification, automated leaked-secret revocation |
| 🚨 **Incident Response** | Slack alerting, automated containment, Falco runtime event ingestion |
| 📋 **Compliance** | SOC 2 / ISO 27001 evidence export, hash-stamped audit ledger |
| 🧰 **Dev Integrations** | VS Code extension with inline diagnostics, GitHub App webhooks |

## Architecture

SCORPION is a decentralized, multi-tiered system: a React dashboard, an Express API gateway, a background worker fleet, and external integrations (GitHub App, VS Code extension), all synchronized through an Appwrite Cloud telemetry database.

![SCORPION Platform Architecture](./public/scorpion_platform_architecture.png)

```mermaid
flowchart TD
    subgraph ClientTier [Client & Integration Layer]
        FE[React Vite Console]
        VSCode[VS Code Extension]
        GHApp[GitHub App Webhooks]
    end

    subgraph CoreBackend [SCORPION Core Backend]
        API[Express API Router]
        Queue[BullMQ / Redis Queue]
        Worker[Background Scan Worker]
        Policy[OPA Policy Engine]
        AI[Gemini Remediation Service]
    end

    subgraph Storage [Appwrite Cloud DB]
        ScansColl[(scans collection)]
        VulnsColl[(vulnerabilities collection)]
        AuditColl[(audit_logs collection)]
    end

    FE <-->|HTTP & Appwrite Realtime| API
    VSCode <-->|Secure HTTP Tunnel| API
    GHApp -->|PR Webhooks| API

    API --> Queue --> Worker
    API --> Policy
    API --> AI

    Worker -->|Differential Delta Ingest| Storage
    Policy -->|Evaluate Scan Metrics| Storage
    AI <-->|Fetch Source Context| Storage
```

## Core Workflows

<details>
<summary><b>1. Parallel Multi-Engine Scan Pipeline</b></summary>

Scan service clones the target repo and runs five scanners in parallel under a sandboxed environment, queued via BullMQ.

**Files:** [`backend/src/workers/scanWorker.ts`](backend/src/workers/scanWorker.ts) · [`backend/src/services/scanService.ts`](backend/src/services/scanService.ts)

```mermaid
sequenceDiagram
    autonumber
    participant Router as Express Router
    participant Service as Scan Service
    participant Git as Simple-Git Utility
    participant Tools as Security Engines (CLI)
    participant DB as Appwrite Database

    Router->>Service: triggerScan(repoId, options, existingScanId)
    Service->>DB: updateDocument(status: 'running')
    Service->>Git: Clone repository branch locally to /tmp
    par SAST Scan
        Service->>Tools: semgrep scan --json --config auto
    and Secret Scan
        Service->>Tools: gitleaks detect --source <dir> -f json -r -
    and SCA Dependency Scan
        Service->>Tools: trivy fs --format json --scanners vuln,secret,misconfig
    and Infrastructure Scan
        Service->>Tools: checkov -d <dir> --output json --quiet
    and Python Analysis
        Service->>Tools: bandit -r <dir> -f json
    end
    Tools-->>Service: Return JSON outputs
    Service->>Service: Parse & Normalize findings
    Service->>DB: Ingest Findings Delta
    Service->>Git: Clean up local directory recursively
```
</details>

<details>
<summary><b>2. Differential Delta Ingestion</b></summary>

SHA-256 fingerprints compare incoming findings against stored issues to avoid duplicate alerts and enable fast writes.

**File:** [`backend/src/services/scanService.ts#L22`](backend/src/services/scanService.ts) (`ingestVulnerabilitiesDelta`)

![SCORPION Scan & Delta Ingestion](./public/scorpion_scan_and_delta_ingestion.png)

```mermaid
flowchart TD
    Start([Receive Incoming Vulnerabilities]) --> FetchDB[Fetch Open Vulnerabilities from DB]
    FetchDB --> HashDB[Compute SHA-256 signatures for DB docs]
    HashDB --> HashIncoming[Compute SHA-256 signatures for incoming items]
    HashIncoming --> DiffCheck{In Incoming but NOT in DB?}
    DiffCheck -- Yes --> CreateDoc[createDocument: status open]
    DiffCheck -- No --> ActiveCheck{In DB but MISSING from Incoming?}
    ActiveCheck -- Yes --> ResolveDoc[updateDocument: status resolved]
    ActiveCheck -- No --> Ignore[Keep status unchanged]
```
</details>

<details>
<summary><b>3. TONY: AI Remediation Engine</b></summary>

Generates context-aware drop-in patches and git-compliant diffs via Gemini Pro.

**Files:** [`backend/src/services/aiService.ts`](backend/src/services/aiService.ts) · [`backend/src/routes/remediate.ts`](backend/src/routes/remediate.ts)

```mermaid
flowchart LR
    DeveloperRemediate["Developer clicks Remediate"] --> LoadRecord["Load vulnerability record"]
    LoadRecord --> BuildPrompt["Build Gemini prompt"]
    BuildPrompt --> GeminiReturn["Gemini Pro returns JSON fix"]
    GeminiReturn --> ShowExpl["Show explanation and patch diff"]
    ShowExpl --> DevApprove["Developer approves"]
    DevApprove --> ApplyFix["Apply fix to file"]
```
</details>

<details>
<summary><b>4. GitHub PR Policy Enforcement Gate (OPA)</b></summary>

Checks repo vulnerabilities against OPA/Rego policy and posts results to GitHub commit status checks.

**Files:** [`backend/src/services/opaService.ts`](backend/src/services/opaService.ts) · [`backend/src/services/policyService.ts`](backend/src/services/policyService.ts) · [`backend/src/github/policyEngine.ts`](backend/src/github/policyEngine.ts)

```mermaid
flowchart TD
    ScanEnd([Scan Process Completed]) --> PullScan[Retrieve Scan severity counts]
    PullScan --> CheckRule{OPA policy evaluation}
    CheckRule -- Passed --> PassState[Gate Status: PASSED]
    CheckRule -- Violated --> FailState[Gate Status: BLOCKED]
    PassState --> PostPass[Post GitHub PR Commit Status: success]
    FailState --> PostFail[Post GitHub PR Commit Status: failure]
    PostPass --> MergeOK([Allow Pull Request Merge])
    PostFail --> MergeBlocked([Block Pull Request Merge])
```
</details>

<details>
<summary><b>5. VS Code Extension Workspace Loop</b></summary>

Embeds SCORPION intelligence directly into the local dev environment.

**Files:** [`scorpion-vscode/src/diagnosticProvider.ts`](scorpion-vscode/src/diagnosticProvider.ts) · [`scorpion-vscode/src/sidebarProvider.ts`](scorpion-vscode/src/sidebarProvider.ts)

```mermaid
flowchart TD
    VSActivate([Activate Extension]) --> Connect[Initialize scorpionClient]
    Connect --> Watch[Watch open workspace text files]
    Watch --> FetchVulns[HTTP Fetch vulnerabilities for current file]
    FetchVulns --> SetSquiggles[Draw Diagnostic Squiggles on error lines]
    Watch --> SidebarPanel[Render Webview Sidebar showing metrics]
    SetSquiggles --> RemediateCmd[Trigger scorpion.remediate on code action]
    RemediateCmd --> DiffView[Show side-by-side split code review and apply]
```
</details>

<details>
<summary><b>6. Multi-Tenancy, Threat Modeling & Incident Response</b></summary>

Repos/scans/incidents/compliance are team-scoped (closing cross-tenant IDOR); STRIDE threat modeling runs on a React Flow canvas; critical incidents trigger Slack alerts and automated containment, feeding the hash-stamped Audit Ledger.

**Files:** [`backend/src/services/tenancyService.ts`](backend/src/services/tenancyService.ts) · [`backend/src/services/threatModelService.ts`](backend/src/services/threatModelService.ts) · [`backend/src/services/slackService.ts`](backend/src/services/slackService.ts) · [`src/pages/AuditLedger.tsx`](src/pages/AuditLedger.tsx)

```mermaid
flowchart TD
    ScanCompleted["Scan completed"] --> AuditLedger["Audit Ledger"]
    PRGate["PR gate evaluated"] --> AuditLedger
    AIFix["AI fix applied"] --> AuditLedger
    AuditLedger --> HashStamped["Hash-stamped log entry"]
    HashStamped --> SOCTrail["SOC 2 and ISO 27001 trail"]

    FalcoEvent["Falco Kubernetes event"] --> IncidentCommand["Incident Command"]
    IncidentCommand --> SlackAlert["Slack alert + containment"]
    SlackAlert --> OnCallTeam["On-call team notified"]
```
</details>

## Tech Stack

<table>
<tr><td valign="top">

**Frontend**
- React `18` · Vite `8` · TypeScript `5.5`
- Tailwind CSS · Lucide React
- Appwrite SDK (realtime)
- Recharts · React Markdown · React Flow
- `@google/generative-ai`

</td><td valign="top">

**Backend**
- Express · TypeScript · Node.js
- BullMQ + ioredis · socket.io
- Octokit / `@octokit/auth-app` · simple-git · dockerode
- zod · helmet · express-rate-limit · bcrypt · jsonwebtoken
- openai · pdfkit · json2csv · archiver
- winston + winston-loki · prom-client · OpenTelemetry

</td></tr>
</table>

## Getting Started

### Prerequisites

```bash
# Installs Semgrep, Trivy, Gitleaks, Checkov, Bandit
npm run install
```

### 1. Configure environment

Create `backend/.env`:

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_API_KEY=your_appwrite_api_key
APPWRITE_DATABASE_ID=scorpion_db
GEMINI_API_KEY=your_gemini_generative_key
GITHUB_APP_ID=your_github_app_id
GITHUB_PRIVATE_KEY=your_github_pem_key
```

### 2. Run the backend

```bash
cd backend
npm install
npm run dev
```

### 3. Run the UI

```bash
npm install
npm run dev
```

### 4. Run the VS Code extension

```bash
cd scorpion-vscode
npm install
# Press F5 in VS Code to launch in debug extension mode
```

## Security Hardening

- **Argument sanitization** — all scanner subprocess spawns use arg arrays with `shell: false`, eliminating injection.
- **Tenant isolation** — repos, scans, vulnerabilities, builds, deployments, incidents, compliance, and policy entities are team-scoped; IDOR closed across multiple hardening passes.
- **Auth & secrets** — dev-auth bypass removed, `RESET_TOKEN_SECRET` fails fast if unset in prod, email verification enforced, webhook secrets never logged, leaked API keys auto-revoked at source.
- **Request hardening** — baseline + endpoint-specific rate limiting, correct `trust proxy`, HSTS, structured auth logging, Zod validation on high-risk writes.
- **Upload & SSRF defense** — uploads validated by content (not extension) with zip-bomb guards; outbound webhook URLs checked against SSRF.
- **Supply chain** — container images signed/verified with cosign; release gates evaluated via OPA/Rego instead of hardcoded thresholds.
- **Tamper-proof audit trail** — deterministic cryptographic hashing on all scanner inputs feeding the Audit Ledger.

## Project Structure

```
Scorpion/
├── backend/            Express API, workers, scanners, services
├── src/                React dashboard (Vite + TypeScript)
├── scorpion-vscode/    VS Code extension
├── functions/          Appwrite serverless functions (e.g. trivy-scanner)
├── public/             Architecture diagrams, static assets
├── docs/               Additional documentation
└── scripts/            Tooling install scripts
```

## Contributing

Issues and PRs welcome. Run `npm run lint && npm run typecheck && npm test` before submitting.
