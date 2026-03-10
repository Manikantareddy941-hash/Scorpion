# 🛡️ StackPilot: Unified Security Orchestration

StackPilot is a modern **Security Orchestration, Automation, and Response (SOAR)** platform. It integrates multiple security scanning tools into a single, cohesive dashboard, providing developer-first organizations with a unified view of their security posture.

---

## ✨ Key Features
- **Centralized Orchestration**: Run **Semgrep**, **Gitleaks**, and **Trivy** in parallel.
- **Governance-as-Code**: Define and enforce security policies across all repositories.
- **RBAC & Project Management**: Manage teams, permissions (Admin/Developer/Viewer), and repository access.
- **AI-Powered Insights**: Get automated remediation suggestions for detected vulnerabilities.
- **Integrated Health Diagnostics**: Real-time monitoring of backend, database, and security tool availability.

---

## 🏗️ Project Structure

```text
Stackpilot/
├── backend/                # Node.js + Express Backend
│   ├── src/
│   │   ├── lib/            # Centralized Supabase & Third-party clients
│   │   ├── routes/         # Express API Routes (Auth, Projects, Health)
│   │   ├── services/       # Business Logic (Scanning, Reporting, RBAC)
│   │   ├── utils/          # Universal Utilities (Tool Check, Logging)
│   │   └── index.ts        # Server Entry Point & Middleware
│   ├── scripts/            # Database maintenance & migration scripts
│   └── package.json        # Backend dependencies & scripts
├── src/                    # Vite + React Frontend
│   ├── components/         # Reusable UI Components (Auth, Dashboards, Tables)
│   ├── pages/              # Main Application Pages (Security, Reports, Settings)
│   ├── contexts/           # React Context Providers (AuthContext)
│   ├── lib/                # Frontend Supabase client
│   └── App.tsx             # Main Routing & Layout
├── tools/                  # Portable security tool binaries
│   ├── gitleaks/           # Gitleaks executable
│   └── trivy/              # Trivy executable
├── supabase/               # Database migrations & configuration
├── package.json            # Frontend dependencies & scripts
└── README.md               # You are here
```

---

## 🛠️ Tech Stack
- **Frontend**: React 18, Vite, Tailwind CSS, Recharts, Lucide Icons.
- **Backend**: Node.js, Express, TypeScript, `ts-node-dev`.
- **Database**: Supabase (PostgreSQL, Auth, Row Level Security).
- **Security Scanners**: 
  - **Gitleaks**: Secret detection and prevention.
  - **Trivy**: Vulnerability and misconfiguration scanner.
  - **Semgrep**: Lightweight static analysis (SAST) for 30+ languages.

---

## 🚀 Setup & Installation

### 1. Prerequisites
- **Node.js**: v18 or higher.
- **Python 3.12**: Required for Semgrep (Backend).
- **Supabase**: Active project with URL and Service Role Key.

### 2. Environment Configuration
Create a `.env` file in the `backend/` directory:
```env
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
FRONTEND_URL=http://localhost:5173
```

### 3. Installation
```bash
# Install root/frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
```

### 4. Running the Application
**Frontend (Root):**
```bash
npm run dev
```
**Backend (backend/):**
```bash
npm run dev
```

---

## 🛡️ Security Toolchain Verification
The backend includes a built-in diagnostic suite to ensure all security tools are operational.
Root to: `GET /api/health/auth` returns the status of:
- **Service Role** connectivity.
- **Gitleaks** binary detection.
- **Trivy** binary detection.
- **Semgrep** Python package detection.

---

## ⚠️ Troubleshooting (Known Issues)
### DNS Redirection (ISP Specific)
If you encounter a "Connection Timeout" or "404" specifically from Supabase domains (`supabase.co`), your ISP may be redirecting traffic. 
**Solution**: Change your system DNS to:
- **Google DNS**: 8.8.8.8 | 8.8.4.4
- **Cloudflare DNS**: 1.1.1.1

---

## 📜 License
Distribute under the MIT License.
