-- Migration: Remediation AI System
-- Created: 2026-02-23

CREATE TABLE IF NOT EXISTS vulnerability_fixes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vulnerability_id UUID REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    suggestion_text TEXT NOT NULL,
    code_diff TEXT, -- Diff format or suggested code block
    confidence_score FLOAT DEFAULT 0.0,
    explanation TEXT,
    feedback JSONB DEFAULT '{"status": "none"}'::jsonb, -- e.g. {"status": "accepted", "helpful": true}
    llm_model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE vulnerability_fixes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view fixes for vulnerabilities in projects they have access to
CREATE POLICY "Users can view fixes for accessible vulns" 
ON vulnerability_fixes FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM vulnerabilities v
        JOIN repositories r ON v.repo_id = r.id
        LEFT JOIN project_access pa ON r.id = pa.repo_id
        LEFT JOIN team_members tm ON pa.team_id = tm.team_id
        WHERE v.id = vulnerability_fixes.vulnerability_id
        AND (r.user_id = auth.uid() OR tm.user_id = auth.uid())
    )
);

CREATE POLICY "Users can create fixes (triggered via API)" 
ON vulnerability_fixes FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Users can update feedback" 
ON vulnerability_fixes FOR UPDATE
TO authenticated
USING (true);

-- Add updated_at trigger
CREATE TRIGGER update_vulnerability_fixes_timestamp
BEFORE UPDATE ON vulnerability_fixes
FOR EACH ROW
EXECUTE FUNCTION update_reports_timestamp(); -- Reusing trigger function
