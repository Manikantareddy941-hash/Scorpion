# 🛡️ StackPilot

### One Platform. Unified Security. Total Governance.

StackPilot is a modern Security Orchestration, Automation, and Response (SOAR) platform designed specifically for developer-first organizations. We turn disparate security scanning tools into a unified, policy-driven security posture.

---

## ✨ Key Features

### 🔍 Multi-Tool Orchestration
Scan your codebases with **Semgrep (SAST)**, **Gitleaks (Secrets)**, and **Trivy (SCA)** simultaneously. Standardized results provide a "single source of truth" for your security health.

### ⚖️ Governance-as-Code
Define global and per-project security policies. Use pre-defined profiles (**Strict**, **Balanced**, **Relaxed**) to decide when builds should pass or break.

### 👥 Team-Based RBAC
Secure by design. Manage multiple teams, repository access, and user roles (Admin, Developer, Viewer) through a centralized governance dashboard.

### 📊 Strategic Reporting
Executive-level visibility with trend analysis and compliance mapping (OWASP Top 10). Export professional PDF reports for stakeholders in one click.

### ⚡ CI/CD Integration
Seamlessly integrate into your development workflow with the StackPilot CLI and built-in webhook support for GitHub Actions and GitLab CI.

---

## 🛠️ Tech Stack

- **Frontend**: React (TS) + Vite + Tailwind CSS + Recharts
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL + RLS)
- **Scanning Engine**: Dockerized Orchestration (Semgrep, Gitleaks, Trivy)
- **Reporting**: PDFKit Engine

---

## 🚀 Quick Start

### 1. Prerequisites
- Docker (for scanning engine)
- Supabase account & project
- Node.js (v18+)

### 2. Installation
```bash
git clone https://github.com/your-org/stackpilot.git
cd stackpilot/project

# Install dependencies
npm install

# Setup Environment
cp .env.example .env

# Run development servers
npm run dev
```

### 3. Trigger Your First Scan
```bash
./scripts/stackpilot-ci.sh --repo-id [YOUR_REPO_ID] --token [YOUR_API_KEY]
```

---

## 🗺️ User Journey

| Role | Responsibility | Key Flow |
| :--- | :--- | :--- |
| **Developer** | Remediation | Scan locally → Fix findings before PR |
| **Security Team** | Policy Design | Define thresholds → Review Alerts Hub |
| **Executive** | Risk Oversight | Monitor Trends → Export Reporting |

---

## 📜 License
Distribute under the MIT License. See `LICENSE` for more information.
# Stackpilot
