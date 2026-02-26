-- Migration: AI Impact Metrics
-- Created: 2026-02-23

CREATE TABLE IF NOT EXISTS ai_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID REFERENCES vulnerabilities(id) ON DELETE CASCADE,
    suggestion_id UUID REFERENCES vulnerability_fixes(id) ON DELETE CASCADE,
    action TEXT CHECK (action IN ('viewed', 'accepted', 'ignored')),
    confidence_score FLOAT,
    time_to_resolution INTERVAL, -- NULL if not resolved or before resolved
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb -- Additional context like tool, severity etc.
);

-- Enable RLS
ALTER TABLE ai_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view metrics for findings they have access to
CREATE POLICY "Users can view metrics for accessible findings"
ON ai_metrics FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM vulnerabilities v
        JOIN repositories r ON v.repo_id = r.id
        LEFT JOIN project_access pa ON r.id = pa.repo_id
        LEFT JOIN team_members tm ON pa.team_id = tm.team_id
        WHERE v.id = ai_metrics.finding_id
        AND (r.user_id = auth.uid() OR tm.user_id = auth.uid())
    )
);

CREATE POLICY "Users can insert metric events"
ON ai_metrics FOR INSERT
TO authenticated
WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_ai_metrics_finding ON ai_metrics(finding_id);
CREATE INDEX idx_ai_metrics_suggestion ON ai_metrics(suggestion_id);
CREATE INDEX idx_ai_metrics_action ON ai_metrics(action);
CREATE INDEX idx_ai_metrics_timestamp ON ai_metrics(timestamp);
