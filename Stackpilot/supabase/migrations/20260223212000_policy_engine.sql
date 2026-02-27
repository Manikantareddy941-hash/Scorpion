-- Policy Engine Schema

-- System-wide policy profiles
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL, -- 'strict', 'balanced', 'relaxed'
    description TEXT,
    max_critical INTEGER DEFAULT 0,
    max_high INTEGER DEFAULT 5,
    min_risk_score INTEGER DEFAULT 80,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default policies
INSERT INTO policies (name, description, max_critical, max_high, min_risk_score, is_system)
VALUES 
('strict', 'Zero tolerance for critical/high vulnerabilities.', 0, 0, 95, true),
('balanced', 'Standard protection for production environments.', 0, 5, 80, true),
('relaxed', 'Flexible policy for early development or experiments.', 2, 10, 60, true)
ON CONFLICT (name) DO NOTHING;

-- Map projects to policies or custom overrides
CREATE TABLE IF NOT EXISTS project_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE UNIQUE,
    policy_id UUID REFERENCES policies(id),
    custom_max_critical INTEGER,
    custom_max_high INTEGER,
    custom_min_risk_score INTEGER,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log of scan evaluations
CREATE TABLE IF NOT EXISTS policy_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scan_results(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    policy_name TEXT NOT NULL,
    result TEXT NOT NULL, -- 'PASS', 'WARN', 'FAIL'
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create a view for easy access to effective policy settings
CREATE OR REPLACE VIEW effective_project_policies AS
SELECT 
    r.id as repo_id,
    COALESCE(pp.policy_id, (SELECT id FROM policies WHERE name = 'balanced')) as active_policy_id,
    p.name as policy_name,
    COALESCE(pp.custom_max_critical, p.max_critical) as max_critical,
    COALESCE(pp.custom_max_high, p.max_high) as max_high,
    COALESCE(pp.custom_min_risk_score, p.min_risk_score) as min_risk_score
FROM repositories r
LEFT JOIN project_policies pp ON r.id = pp.repo_id
LEFT JOIN policies p ON pp.policy_id = p.id OR (pp.policy_id IS NULL AND p.name = 'balanced');
