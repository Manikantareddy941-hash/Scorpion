-- Notification System Schema

-- Notification Preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE, -- Optional: per-repo settings
    channel TEXT NOT NULL, -- 'email', 'slack', 'discord'
    event_type TEXT NOT NULL, -- 'scan_completed', 'critical_detected', 'policy_failure', 'scheduled_scan'
    enabled BOOLEAN DEFAULT true,
    target_value TEXT, -- email address, webhook URL
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, repo_id, channel, event_type)
);

-- Notification History & Retry Queue
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add some default preferences for existing users
-- Note: This is a placeholder, actual logic might differ based on user sign-up flow
