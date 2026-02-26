-- Add GitHub fields to tasks
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS repo_url TEXT,
ADD COLUMN IF NOT EXISTS issue_url TEXT;

-- Create Repositories table
CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  url TEXT NOT NULL,
  name TEXT,
  stars INT DEFAULT 0,
  last_scan_at TIMESTAMPTZ,
  vulnerability_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Scan Results table
CREATE TABLE IF NOT EXISTS scan_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('queued', 'in_progress', 'completed', 'failed')),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Notification Preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  scan_alerts_enabled BOOLEAN DEFAULT true,
  overdue_tasks_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Repositories: Users can see/edit their own
CREATE POLICY "Users can view own repositories" ON repositories
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repositories" ON repositories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repositories" ON repositories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own repositories" ON repositories
  FOR DELETE USING (auth.uid() = user_id);

-- Scan Results: Users can view scans for their repos
CREATE POLICY "Users can view own scan results" ON scan_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM repositories 
      WHERE repositories.id = scan_results.repo_id 
      AND repositories.user_id = auth.uid()
    )
  );

-- Backend service policy (service_role will bypass RLS, but explicit grant helps if we use a specific user)
-- For now, we rely on service_role key for backend operations.

-- Notification Preferences
CREATE POLICY "Users can view own preferences" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
