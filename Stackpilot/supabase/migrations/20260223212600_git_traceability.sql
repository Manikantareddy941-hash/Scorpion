-- Git Traceability & Resolution Tracking Schema

-- Link scans to specific Git commits/PRs
CREATE TABLE IF NOT EXISTS scan_commits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_results(id) ON DELETE CASCADE UNIQUE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    branch TEXT,
    pr_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Track manual resolutions for findings
CREATE TABLE IF NOT EXISTS finding_resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id UUID REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    state TEXT NOT NULL, -- 'fixed', 'accepted_risk'
    reason TEXT,
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Update vulnerabilities table to track current status and resolution
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'vulnerabilities' AND COLUMN_NAME = 'resolution_status') THEN
        ALTER TABLE vulnerabilities ADD COLUMN resolution_status TEXT DEFAULT 'open'; -- 'open', 'fixed', 'accepted_risk', 'auto_closed'
        ALTER TABLE vulnerabilities ADD COLUMN resolution_id UUID REFERENCES finding_resolutions(id);
        ALTER TABLE vulnerabilities ADD COLUMN fingerprint TEXT; -- Used to identify same finding across scans
    END IF;
END $$;

-- Create an index on fingerprint for faster reconciliation
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_fingerprint ON vulnerabilities(fingerprint);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_repo_status ON vulnerabilities(repo_id, resolution_status);
