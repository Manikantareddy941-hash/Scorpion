-- Migration: Advanced Reporting System
-- Created: 2026-02-23

CREATE TABLE IF NOT EXISTS security_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'team', 'project')),
    stats_snapshot JSONB NOT NULL,
    report_url TEXT, -- URL to PDF in Supabase Storage
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE security_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own reports" 
ON security_reports FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own reports" 
ON security_reports FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_reports_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_security_reports_timestamp
BEFORE UPDATE ON security_reports
FOR EACH ROW
EXECUTE FUNCTION update_reports_timestamp();
