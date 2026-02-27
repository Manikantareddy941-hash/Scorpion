-- Add risk_score to repositories
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS risk_score NUMERIC(5,2) DEFAULT 0.00;

-- Create Vulnerabilities table
CREATE TABLE IF NOT EXISTS vulnerabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  scan_result_id UUID REFERENCES scan_results(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  message TEXT NOT NULL,
  file_path TEXT,
  line_number INT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'false_positive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vulnerabilities
CREATE POLICY "Users can view vulnerabilities of their repos" ON vulnerabilities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM repositories 
      WHERE repositories.id = vulnerabilities.repo_id 
      AND repositories.user_id = auth.uid()
    )
  );

-- Backend service role has full access (default)

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_repo_id ON vulnerabilities(repo_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scan_result_id ON vulnerabilities(scan_result_id);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_status ON vulnerabilities(status);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
