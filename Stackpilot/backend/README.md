# DevOps Task Tracker - Backend Orchestration Service

This custom Node.js service handles the "Heavy Lifting" for the DevOps Task Tracker, specifically focusing on security scanning orchestration, GitHub integration, and background jobs.

## 🚀 Core Responsibilities

1. **Security Scan Orchestration**: 
   - Triggers and manages parallel scans using ESLint, Trivy, and npm audit logic.
   - Calculates security scores based on severity breakdowns.
   - Persists results to the `scan_results` and `code_metrics` tables in Supabase.

2. **GitHub Repository Management**:
   - Handles the linking of repositories to tasks.
   - (Future) Webhook processing for automated scans on push.

3. **Background Jobs & Cron**:
   - Uses `node-cron` to schedule periodic security posture refreshes.
   - Maintains system-wide metrics independently of user sessions.

## 🛠️ Technical Stack

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Language**: TypeScript (Strict Mode)
- **Database Access**: Supabase Service Role (bypasses RLS for orchestration)
- **Scheduling**: `node-cron`

## 📂 Project Structure

```
backend/
├── src/
│   ├── jobs/           # Scheduled background tasks (scan jobs)
│   ├── services/       # Business logic (scanService.ts)
│   └── index.ts        # API entry point & health checks
├── package.json        # Dependencies (typescript, express, supabase)
└── tsconfig.json       # Strict TypeScript configuration
```

## ⚡ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/health` | Service health & database connectivity |
| **GET** | `/api/repos` | List managed repositories |
| **POST** | `/api/repos/:id/scan` | Trigger immediate security scan |
| **GET** | `/api/metrics` | Aggregate security scores across repos |

## ⚙️ Configuration

Requires the following environment variables in `backend/.env`:

```env
PORT=3001
SUPABASE_URL=your_project_url
SUPABASE_SERVICE_ROLE_KEY=your_high_privilege_key
```

> [!IMPORTANT]
> This service uses the **Service Role Key** to perform system-level operations. Never expose this key in the frontend application.

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
