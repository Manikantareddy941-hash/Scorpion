import { databases, COLLECTIONS, DB_ID, Query, ID } from '../lib/appwrite';

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
            const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, event.finding_id);

            if (vuln) {
                const start = new Date(vuln.$createdAt).getTime();
                const end = new Date().getTime();
                const diffMs = end - start;
                // Format: 'HH:MM:SS'
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const mins = Math.floor((diffMs / (1000 * 60)) % 60);
                const secs = Math.floor((diffMs / 1000) % 60);
                time_to_resolution = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
        }

        await databases.createDocument(
            DB_ID,
            'ai_metrics',
            ID.unique(),
            {
                finding_id: event.finding_id,
                suggestion_id: event.suggestion_id,
                action: event.action,
                confidence_score: event.confidence_score,
                metadata: event.metadata ? JSON.stringify(event.metadata) : null,
                time_to_resolution,
                created_at: new Date().toISOString()
            }
        );
    } catch (error) {
        console.error('[MetricsService] Error recording AI event:', error);
    }
};

export const getAIAggregates = async () => {
    try {
        // Fetch all metrics and aggregate in code (Appwrite lacks complex grouping/aggregations)
        const response = await databases.listDocuments(
            DB_ID,
            'ai_metrics',
            [Query.limit(5000)] // Adjust limit as needed
        );
        const allMetrics = response.documents;

        const total = allMetrics.length;
        const viewed = allMetrics.filter((m: any) => m.action === 'viewed').length;
        const accepted = allMetrics.filter((m: any) => m.action === 'accepted').length;
        const ignored = allMetrics.filter((m: any) => m.action === 'ignored').length;

        const acceptanceRate = viewed > 0 ? (accepted / viewed) * 100 : 0;

        // Average confidence of accepted vs ignored
        const acceptedMetrics = allMetrics.filter((m: any) => m.action === 'accepted' && m.confidence_score !== null);
        const avgConfidenceAccepted = acceptedMetrics.length > 0
            ? acceptedMetrics.reduce((acc: number, curr: any) => acc + (curr.confidence_score || 0), 0) / acceptedMetrics.length
            : 0;

        return {
            total_events: total,
            viewed,
            accepted,
            ignored,
            acceptance_rate: acceptanceRate,
            avg_confidence_accepted: avgConfidenceAccepted
        };
    } catch (error) {
        console.error('[MetricsService] Error fetching AI aggregates:', error);
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
        // Manual trend calculation (group by day)
        const response = await databases.listDocuments(
            DB_ID,
            'ai_metrics',
            [Query.orderAsc('created_at'), Query.limit(5000)]
        );

        const trendsMap: Record<string, any> = {};

        response.documents.forEach((m: any) => {
            const day = new Date(m.created_at || m.$createdAt).toISOString().split('T')[0];
            if (!trendsMap[day]) {
                trendsMap[day] = { day, viewed: 0, accepted: 0, ignored: 0 };
            }
            if (m.action === 'viewed') trendsMap[day].viewed++;
            else if (m.action === 'accepted') trendsMap[day].accepted++;
            else if (m.action === 'ignored') trendsMap[day].ignored++;
        });

        return Object.values(trendsMap);
    } catch (error) {
        console.error('[MetricsService] Error fetching AI trends:', error);
        return [];
    }
};
