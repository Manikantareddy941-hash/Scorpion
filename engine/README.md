# Self-Hosted Security Scanning Engine

A production-grade, asynchronous security scanning engine using Gitleaks, Trivy, and Semgrep.

## Prerequisites
- Docker & Docker Compose
- Node.js (for local development)

## Getting Started

1. **Environmental Variables**
   The services expect `DATABASE_URL` and `REDIS_URL`. These are pre-configured in `docker-compose.yml`.

2. **Run with Docker Compose**
   ```bash
   docker-compose up --build
   ```

3. **Initialize Database**
   Connect to Postgres and run `migrations/001_init.sql`.

4. **Trigger a Scan**
   ```bash
   curl -X POST http://localhost:3000/scan \
     -H "Content-Type: application/json" \
     -d '{"repo_url": "https://github.com/vulnerable-repo/test"}'
   ```

5. **Check Status**
   ```bash
   curl http://localhost:3000/scan/<scan_id>
   ```

## Architecture
- **API**: Handles requests and queues jobs.
- **Worker**: Processes jobs by cloning repos and running tools in Docker sandboxes.
- **Sandboxing**: Every tool runs in a `--network none` container with memory/CPU limits.
- **Atomic Operations**: State transitions use conditional updates to prevent race conditions.
