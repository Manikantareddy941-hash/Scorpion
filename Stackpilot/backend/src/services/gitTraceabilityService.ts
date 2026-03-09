import { databases, COLLECTIONS, DB_ID, Query, ID } from '../lib/appwrite';

export interface GitMetadata {
    commit_hash: string;
    branch?: string;
    pr_number?: number;
}

/**
 * Links a scan execution to specific Git metadata.
 */
export const linkCommitToScan = async (scanId: string, repoId: string, metadata: GitMetadata) => {
    try {
        await databases.createDocument(
            DB_ID,
            'scan_commits',
            ID.unique(),
            {
                scan_id: scanId,
                repo_id: repoId,
                commit_hash: metadata.commit_hash,
                branch: metadata.branch,
                pr_number: metadata.pr_number,
                created_at: new Date().toISOString()
            }
        );

        console.log(`[GitTraceability] Scan ${scanId} linked to commit ${metadata.commit_hash.substring(0, 7)}`);
    } catch (error) {
        console.error(`[GitTraceability] Failed to link commit to scan ${scanId}:`, error);
        throw error;
    }
};

/**
 * Fetches the historical lifecycle of a finding.
 */
export const getFindingHistory = async (findingId: string) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            'finding_resolutions',
            [Query.equal('finding_id', findingId), Query.orderDesc('created_at')]
        );

        // In Appwrite, we'd need to fetch user emails separately if they aren't in the document.
        // For now, we return the documents.
        return response.documents;
    } catch (error) {
        console.error('[GitTraceability] Error fetching finding history:', error);
        throw error;
    }
};

/**
 * Generates a stable fingerprint for a finding based on tool, file, and message.
 */
export const generateFingerprint = (f: { tool: string, file_path: string, message: string }): string => {
    // Basic deterministic string for tracking across scans
    return `${f.tool}:${f.file_path}:${Buffer.from(f.message).toString('base64').substring(0, 32)}`;
};
