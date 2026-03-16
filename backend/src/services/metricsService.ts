import { supabase } from '../lib/supabase';

export interface AIEvent {
    finding_id: string;
    suggestion_id: string;
    action: 'viewed' | 'accepted' | 'ignored';
    confidence_score?: number;
    metadata?: any;
}

export const recordAIEvent = async (event: AIEvent) => {

    // If accepted, we might want to calculate time to resolution
    let time_to_resolution = null;
    if (event.action === 'accepted') {
        const { data: finding } = await supabase
            .from('vulnerabilities')
            .select('created_at')
            .eq('id', event.finding_id)
            .single();

        if (finding) {
            const start = new Date(finding.created_at).getTime();
            const end = new Date().getTime();
            const diffMs = end - start;
            // Convert to Postgres interval string format: 'HH:MM:SS' or similar
            time_to_resolution = `${Math.floor(diffMs / (1000 * 60 * 60))}:${Math.floor((diffMs / (1000 * 60)) % 60)}:${Math.floor((diffMs / 1000) % 60)}`;
        }
    }

    const { error } = await supabase
        .from('ai_metrics')
        .insert([{
            ...event,
            time_to_resolution
        }]);

    if (error) throw error;
};

export const getAIAggregates = async (userId: string) => { // Added userId even if not used to match signature if needed

    // 1. Total suggestions & breakdowns
    const { data: counts } = await supabase
        .rpc('get_ai_action_counts'); // We'll need a small SQL function or just multiple queries

    // Fallback to manual aggregation if RPC doesn't exist yet
    const { data: allMetrics } = await supabase
        .from('ai_metrics')
        .select('action, confidence_score, time_to_resolution');

    const total = allMetrics?.length || 0;
    const viewed = allMetrics?.filter(m => m.action === 'viewed').length || 0;
    const accepted = allMetrics?.filter(m => m.action === 'accepted').length || 0;
    const ignored = allMetrics?.filter(m => m.action === 'ignored').length || 0;

    const acceptanceRate = viewed > 0 ? (accepted / viewed) * 100 : 0;

    // Average confidence of accepted vs ignored
    const avgConfidenceAccepted = allMetrics?.filter(m => m.action === 'accepted' && m.confidence_score !== null)
        .reduce((acc, curr, _, arr) => acc + (curr.confidence_score || 0) / arr.length, 0) || 0;

    return {
        total_events: total,
        viewed,
        accepted,
        ignored,
        acceptance_rate: acceptanceRate,
        avg_confidence_accepted: avgConfidenceAccepted
    };
};

export const getAITrends = async () => {

    // Group by day
    const { data: trends, error } = await supabase
        .rpc('get_ai_trends_by_day');

    if (error) {
        // Fallback or handle error
        console.error('[MetricsService] Trend RPC failed:', error);
        return [];
    }

    return trends;
};
