import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

export interface AIEvent {
    finding_id: string;
    suggestion_id: string;
    action: 'viewed' | 'accepted' | 'ignored';
    confidence_score?: number;
    metadata?: any;
}

export const recordAIEvent = async (event: AIEvent) => {
    try {
        // If accepted, we might want to calculate time to resolution
        let time_to_resolution = null;
        if (event.action === 'accepted') {
            const finding = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, event.finding_id);

            if (finding) {
                const start = new Date(finding.created_at || finding.$createdAt).getTime();
                const end = new Date().getTime();
                const diffMs = end - start;
                // Format as HH:MM:SS
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
                const seconds = Math.floor((diffMs / 1000) % 60);
                time_to_resolution = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }

        await databases.createDocument(DB_ID, COLLECTIONS.AI_METRICS, ID.unique(), {
            ...event,
            metadata: event.metadata ? JSON.stringify(event.metadata) : null,
            time_to_resolution,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('[MetricsService] Failed to record AI event:', err);
        throw err;
    }
};

export const getAIAggregates = async (userId: string) => {
    try {
        // Fetch all metrics for current user (this might need filtering by repository owned by user in the future)
        // For now, listing all as per previous implementation logic
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.AI_METRICS, [
            Query.limit(5000) // Large limit for manual aggregation
        ]);

        const allMetrics = response.documents;
        const total = allMetrics.length;
        const viewed = allMetrics.filter((m: any) => m.action === 'viewed').length;
        const accepted = allMetrics.filter((m: any) => m.action === 'accepted').length;
        const ignored = allMetrics.filter((m: any) => m.action === 'ignored').length;

        const acceptanceRate = viewed > 0 ? (accepted / viewed) * 100 : 0;

        const acceptedWithConfidence = allMetrics.filter((m: any) => m.action === 'accepted' && m.confidence_score !== null);
        const avgConfidenceAccepted = acceptedWithConfidence.length > 0
            ? acceptedWithConfidence.reduce((acc, curr: any) => acc + (curr.confidence_score || 0), 0) / acceptedWithConfidence.length
            : 0;

        return {
            total_events: total,
            viewed,
            accepted,
            ignored,
            acceptance_rate: acceptanceRate,
            avg_confidence_accepted: avgConfidenceAccepted
        };
    } catch (err) {
        console.error('[MetricsService] Failed to get aggregates:', err);
        return {
            total_events: 0,
            viewed: 0,
            accepted: 0,
            ignored: 0,
            acceptance_rate: 0,
            avg_confidence_accepted: 0
        };
    }
};

export const getAITrends = async () => {
    try {
        // Since we don't have RPC, we'll fetch recent metrics and aggregate by day in JS
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.AI_METRICS, [
            Query.orderDesc('$createdAt'),
            Query.limit(1000)
        ]);

        const metrics = response.documents;
        const trendsMap: Record<string, { date: string, viewed: number, accepted: number, ignored: number }> = {};

        metrics.forEach((m: any) => {
            const date = new Date(m.$createdAt).toISOString().split('T')[0];
            if (!trendsMap[date]) {
                trendsMap[date] = { date, viewed: 0, accepted: 0, ignored: 0 };
            }
            if (m.action === 'viewed') trendsMap[date].viewed++;
            if (m.action === 'accepted') trendsMap[date].accepted++;
            if (m.action === 'ignored') trendsMap[date].ignored++;
        });

        return Object.values(trendsMap).sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
        console.error('[MetricsService] Failed to get trends:', err);
        return [];
    }
};
