# DevOps Task Tracker - System Design Interview Preparation

This document provides likely system design questions you'll encounter in interviews about this project, along with strong sample answers that demonstrate deep technical thinking.

---

## Question 1: System Design Overview

**Interviewer**: "Walk me through the architecture of your DevOps Task Tracker. How are the components organized and how do they communicate?"

### Strong Answer:

"The system follows a full-stack architecture with clear separation between management and orchestration:

**Frontend Layer:**
- React SPA built with TypeScript and Vite
- Runs in the browser, handles UI and user interactions
- Uses Supabase JavaScript client for API calls
- Stores JWT tokens securely in httpOnly cookies

**Backend Layer:**
- Node.js & Express service running on TypeScript
- Handles orchestration of security scans and GitHub repository management
- Uses Supabase (managed PostgreSQL + Auth service) for data persistence
- Authentication handled by Supabase Auth (JWT-based)
- Data access through Supabase REST API and direct backend-to-database connections with service role keys

**Communication:**
```
Frontend (React)
    ↓ HTTPS + JWT Token
Supabase API Gateway / Backend Service
    ↓ Validates Token
Row-Level Security Policies
    ↓ Enforces auth.uid() = user_id
PostgreSQL Database
```

**Data Flow for Task Creation:**
1. User fills task form in React component
2. Component calls `supabase.from('tasks').insert()`
3. Request includes JWT token in Authorization header
4. Supabase verifies token and extracts user_id
5. RLS policy checks: `auth.uid() = user_id` (enforced in database)
6. Row is inserted only if user is authenticated
7. Realtime subscription notifies frontend
8. UI updates with new task

**Key Design Decisions:**
- **Integrated Backend Service**: Node.js/Express service for background jobs and scanning
- **Database-level security**: RLS policies enforce security at data layer (defense in depth)
- **JWT tokens**: Stateless authentication, scales horizontally
- **TypeScript**: Prevents runtime errors, improves code quality
- **Vite**: Fast builds and HMR for development velocity

**Benefits:**
- Reduced operational burden via managed services
- Deep security through database-level enforcement
- Highly responsive UI via optimistic updates and realtime sync"

---

## Question 2: Authentication & Security

**Interviewer**: "How does authentication work in your system? Walk me through the flow from signup to making an API request."

### Strong Answer:

"Authentication uses JWT tokens issued by Supabase Auth:

**Signup Flow:**
1. User enters email + password in Auth.tsx
2. Call supabase.auth.signUp({ email, password })
3. Supabase Auth Service:
   - Validates email format
   - Hashes password with bcrypt + salt
   - Creates row in auth.users table
   - Returns JWT token
4. Token stored in httpOnly cookie (secure, not accessible by JS)
5. onAuthStateChange listener fires
6. AuthContext updates user state
7. App redirects to Dashboard

**Login Flow:**
1. User enters email + password
2. Call supabase.auth.signInWithPassword()
3. Supabase verifies credentials against hashed password
4. Token issued and stored
5. Automatic redirect to Dashboard
6. Automatic token refresh before expiration

**Making API Requests:**
```typescript
const { data, error } = await supabase
  .from('tasks')
  .select('*');
```

Under the hood:
1. Supabase client extracts JWT from cookie
2. Adds header: Authorization: Bearer <jwt_token>
3. POST to /rest/v1/tasks
4. Server validates JWT signature
5. Extracts user_id from token payload
6. Passes user_id to RLS policies

**Security Layers:**
1. **Credential Security**: Passwords hashed with bcrypt; Salt prevents rainbow tables.
2. **Token Security**: Signed JWTs, short-lived (1hr), httpOnly cookies to prevent XSS.
3. **Database Level**: RLS policies verify `auth.uid()` on every query.
4. **Transport Security**: HTTPS only via TLS.

**Key Security Decisions:**
- **httpOnly cookies**: Prevents XSS attacks stealing tokens.
- **Database-level enforcement**: Prevents logical errors in app code."

---

## Question 3: Scaling Strategy

**Interviewer**: "Your app is popular and you have 100,000 users. How do you scale this system?"

### Strong Answer:

"Current architecture handles 100K users with a phased scaling strategy:

**Stage 1: Current (0-10K users)**
- Automatic scaling handled by Supabase (shared instance)
- Frontend on Vercel (Edge CDN)

**Stage 2: Medium (10K-100K users)**
- Upgrade to dedicated Supabase instance
- Database read replicas for telemetry and metrics
- Caching layer (Redis) for frequently accessed task lists

**Stage 3: Large Scale (100K+ users)**
- Multi-region deployment for lower latency
- Message queues (RabbitMQ/SQS) for heavy security scans
- Sharding by `user_id` if single instance write throughput is exceeded

**Performance Optimizations:**
- **Composite Indexes**: `idx_tasks_user_status` for dashboard views.
- **Query Optimization**: Pagination, Joins instead of N+1, and archiving old tasks."

---

## Question 4: Data Model & Database Design

**Interviewer**: "Show me your database schema. How did you structure the data and why?"

### Strong Answer:

"The schema is designed for security and relational integrity:

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  repository_id UUID REFERENCES repositories(id),
  title TEXT NOT NULL,
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'completed'))
);

CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  url TEXT NOT NULL,
  last_scan_at TIMESTAMPTZ,
  vulnerability_count INT DEFAULT 0
);

CREATE TABLE code_metrics (
  id UUID PRIMARY KEY,
  scan_result_id UUID REFERENCES scan_results(id),
  tool TEXT CHECK (tool IN ('eslint', 'trivy', 'npm_audit')),
  score NUMERIC(5,2)
);
```

**Design Decisions:**
- **UUIDs**: Privacy and distributed safety.
- **CHECK Constraints**: Database-level validation.
- **Foreign Keys**: Enforced referential integrity."

---

## Question 5: Code Insights & Security Scanning

**Interviewer**: "How did you implement the Code Insights feature? How do you handle potentially heavy scanning operations?"

### Strong Answer:

"The Code Insights platform uses an orchestration-based approach to security scanning:

**Scanning Architecture:**
1. **Trigger Phase**: Users trigger a scan via the React frontend or a scheduled cron job.
2. **Orchestration**: The Node.js backend (`scanService.ts`) creates a `scan_results` record and triggers independent analysis for ESLint, Trivy, and npm audit.
3. **Simulation Logic**: Results are simulated using realistic mock data that mirrors standard tool outputs (errors, warnings, scores).
4. **Data Persistence**: Results are stored in the `code_metrics` table, linked to the specific repository and scan.

**Handling Heavy Operations:**
- **Asynchronous Execution**: Scans run as background jobs, preventing blocking the main thread.
- **Rate Limiting**: Implemented a 5-minute cooldown per repository to prevent resource exhaustion.
- **Parallelism**: Scans for different tools run in parallel to minimize total scan time.

**Key Design Decisions:**
- **Service Role Access**: Backend uses service role keys to bypass RLS for system-orchestrated scans.
- **Visual Feedback**: Gauge charts provide immediate security posture awareness."

---

## Question 6: Tradeoffs & Design Decisions

**Interviewer**: "Why did you choose a hybrid architecture with both Supabase and a custom Node.js backend?"

### Strong Answer:

"The decision centered on balancing developer velocity with custom functionality requirements:

1. **Supabase for Speed**: Used for Auth and real-time database sync to get to market faster.
2. **Node.js for Power**: Added when we needed custom logic that doesn't fit in Edge Functions, specifically:
   - Complex orchestration of multiple scanning tools.
   - Long-running background jobs that exceed serverless timeouts.
   - Aggregating data across multiple repositories using service-role access.

**Tradeoff**: Increased infrastructure complexity (managing a separate server).
**Benefit**: Full control over DevOps-specific workflows while keeping the 'serverless' ease of use for the frontend."

---

## Final Thought

"The key is explaining not just WHAT was built, but WHY. The evolution from a simple task tracker to a DevOps-integrated platform reflects a real-world shift from generic CRUD to specialized business value."
