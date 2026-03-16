-- Initial Migration: Self-Hosted Scanning Engine

CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created', 'scan_queued', 'scanning', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vulnerabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    tool_source TEXT NOT NULL CHECK (tool_source IN ('gitleaks', 'trivy', 'semgrep')),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    title TEXT NOT NULL,
    description TEXT,
    file_path TEXT,
    line_number INT,
    cve_id TEXT,
    fix_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for status performance
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_id ON vulnerabilities(scan_id);
