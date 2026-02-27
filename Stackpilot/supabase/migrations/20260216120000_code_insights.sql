-- ============================================================
-- Migration: Code Insights Extension
-- Adds code_metrics table, enhances repositories/scan_results,
-- links tasks to repos, adds notification channels.
-- ============================================================

-- 1. Enhance repositories with branch/language metadata
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS default_branch TEXT DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS last_pushed_at TIMESTAMPTZ;

-- 2. Enhance scan_results with tool-specific scan type
ALTER TABLE scan_results
  ADD COLUMN IF NOT EXISTS scan_type TEXT DEFAULT 'full';

-- 3. Code quality metrics (per-scan, per-tool breakdown)
CREATE TABLE IF NOT EXISTS code_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_result_id UUID REFERENCES scan_results(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('eslint', 'trivy', 'npm_audit')),
  errors INT DEFAULT 0,
  warnings INT DEFAULT 0,
  info INT DEFAULT 0,
  score NUMERIC(5,2) DEFAULT 100.00,
  raw_output JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Link tasks to repositories (many-to-one)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES repositories(id);

-- 5. Notification preferences: add SNS/Slack fields
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS sns_topic_arn TEXT,
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT;

-- ============================================================
-- RLS for code_metrics
-- ============================================================
ALTER TABLE code_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own code metrics" ON code_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM scan_results sr
      JOIN repositories r ON r.id = sr.repo_id
      WHERE sr.id = code_metrics.scan_result_id
      AND r.user_id = auth.uid()
    )
  );

-- Backend service uses service_role key (bypasses RLS)

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_code_metrics_scan_result ON code_metrics(scan_result_id);
CREATE INDEX IF NOT EXISTS idx_code_metrics_tool ON code_metrics(tool);
CREATE INDEX IF NOT EXISTS idx_scan_results_repo_id ON scan_results(repo_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_status ON scan_results(status);
CREATE INDEX IF NOT EXISTS idx_repositories_user_id ON repositories(user_id);
