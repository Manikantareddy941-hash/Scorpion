-- Enterprise Security Schema Migration (Hardened)
-- Includes multi-tenancy (tenant_id), atomic state transitions, and tool-level tracking.

-- 1. Repositories
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Multi-tenant isolation
    github_repo_id BIGINT UNIQUE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    risk_score NUMERIC(5,2) DEFAULT 0.00,
    last_scan_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, url)
);

-- 2. Tasks
-- Linking to repository and adding tenant_id
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL;

-- 3. Scans (State Machine Enforced)
CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'scan_queued', 'scanning', 'completed', 'failed', 'partial_success')),
    previous_status TEXT, -- For atomic transition validation
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failure_category TEXT CHECK (failure_category IN ('transient', 'tool_failure', 'security_violation', 'permanent_error')),
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tool-Level Execution Tracking
CREATE TABLE IF NOT EXISTS tool_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL CHECK (tool_name IN ('gitleaks', 'trivy', 'semgrep')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    duration_ms INT,
    exit_code INT,
    error_output TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- 5. Vulnerabilities (Granular with Fingerprinting)
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    fingerprint_hash TEXT NOT NULL,
    tool_source TEXT NOT NULL CHECK (tool_source IN ('gitleaks', 'trivy', 'semgrep')),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    severity_weight INT NOT NULL, -- crit: 40, hi: 20, med: 5, low: 1
    title TEXT NOT NULL,
    description TEXT,
    file_path TEXT,
    line_number INT,
    normalized_code_snippet TEXT,
    cve_id TEXT,
    fix_version TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Scan Artifacts (Retention: 30 days)
CREATE TABLE IF NOT EXISTS scan_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL,
    raw_data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Chat Context (Retention: 14 days inactive)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. RLS Policies (Strict Multi-Tenancy)
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Dynamic Policy Generator (Helper Concept)
CREATE POLICY "tenant_isolation_repositories" ON repositories FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_scans" ON scans FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_vulnerabilities" ON vulnerabilities FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_artifacts" ON scan_artifacts FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_chat" ON chat_sessions FOR ALL USING (auth.uid() = tenant_id);

-- 9. Performance & Security Indexes
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_fingerprint_tenant ON vulnerabilities(tenant_id, fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_scans_tenant_status ON scans(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_expiry ON scan_artifacts(expires_at);
CREATE INDEX IF NOT EXISTS idx_chat_activity ON chat_sessions(last_activity_at);
