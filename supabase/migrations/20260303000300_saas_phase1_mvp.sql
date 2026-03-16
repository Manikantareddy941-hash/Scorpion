-- StackPilot SaaS Phase 1: Solo Developer MVP
-- Focus: Lean multi-tenancy, basic repo tracking, and one-click scan results.

-- 1. Repositories (Phase 1 Lean)
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT,
    last_scan_at TIMESTAMPTZ,
    vulnerability_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, url)
);

-- 2. Scans (Phase 1 Simple)
CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'scanning', 'completed', 'failed')),
    details JSONB, -- For simple high-level results
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Vulnerabilities (Phase 1 Basic)
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    tool_source TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    title TEXT NOT NULL,
    file_path TEXT,
    line_number INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RLS Policies
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_repositories" ON repositories FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_scans" ON scans FOR ALL USING (auth.uid() = tenant_id);
CREATE POLICY "tenant_isolation_vulnerabilities" ON vulnerabilities FOR ALL USING (auth.uid() = tenant_id);

-- 5. Linking Tasks to Repositories
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
