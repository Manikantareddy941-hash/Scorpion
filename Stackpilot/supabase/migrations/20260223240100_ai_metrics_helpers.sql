-- AI Metrics Helpers
-- Created: 2026-02-23

CREATE OR REPLACE FUNCTION get_ai_action_counts()
RETURNS TABLE(action TEXT, count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT m.action, COUNT(*)
    FROM ai_metrics m
    GROUP BY m.action;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_ai_trends_by_day()
RETURNS TABLE(date DATE, viewed BIGINT, accepted BIGINT, ignored BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.timestamp::DATE as date,
        COUNT(*) FILTER (WHERE m.action = 'viewed') as viewed,
        COUNT(*) FILTER (WHERE m.action = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE m.action = 'ignored') as ignored
    FROM ai_metrics m
    GROUP BY m.timestamp::DATE
    ORDER BY m.timestamp::DATE ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
