# StackPilot DevOps - Backend Orchestration Service

This custom Node.js service handles the "Heavy Lifting" for StackPilot, specifically focusing on security scanning orchestration, GitHub integration, and background jobs.

## 🚀 Core Responsibilities

1. **Security Scan Orchestration**: 
   - Triggers and manages parallel scans using Semgrep, Gitleaks, Trivy, and npm audit logic.
   - Calculates security scores based on severity breakdowns.
   - Persists results to Appwrite Databases.

2. **GitHub Repository Management**:
   - Handles the linking of repositories to projects and tasks.
   - Manages repository metadata and CI/CD scan triggering via API Keys.

3. **Background Jobs & Cron**:
   - Uses `node-cron` to schedule periodic security posture refreshes and scans.
   - Maintains system-wide metrics independently of user sessions.

## 🛠️ Technical Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript (Strict Mode)
- **Backend Service**: Appwrite (Node-Appwrite SDK)
- **Scheduling**: `node-cron`

## 📂 Project Structure

```
backend/
├── src/
│   ├── jobs/           # Scheduled background tasks
│   ├── services/       # Business logic (scanService, reportingService, etc.)
│   ├── lib/            # Appwrite client configuration
│   └── index.ts        # API entry point & health checks
├── package.json        # Dependencies (typescript, express, node-appwrite)
└── tsconfig.json       # Strict TypeScript configuration
```

## ⚡ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/health` | Service health & database connectivity |
| **GET** | `/api/repos` | List managed repositories |
| **POST** | `/api/repos/:id/scan` | Trigger immediate security scan |
| **GET** | `/api/dashboard/stats` | Global security stats summary |

## ⚙️ Configuration

Requires the following environment variables in `backend/.env`:

```env
PORT=3001
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_API_KEY=your_api_key
APPWRITE_DATABASE_ID=your_database_id
FRONTEND_URL=http://localhost:5173
```

> [!IMPORTANT]
> This service uses the **Appwrite API Key** to perform system-level operations. Never expose this key in the frontend application.

## 🔨 Development

```bash
# Install dependencies
npm install

# Start development server (with hot-reload)
npm run dev

# Build for production
npm run build
```

---
© 2026 StackPilot DevOps Backend
