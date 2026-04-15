import crypto from 'crypto';
import { databases, DB_ID, COLLECTIONS, ID, Query, users } from '../lib/appwrite';

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
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.SCAN_COMMITS}`);
        if (!COLLECTIONS.SCAN_COMMITS) throw new Error("collectionId is undefined");
        await databases.createDocument(DB_ID, COLLECTIONS.SCAN_COMMITS, ID.unique(), {
            scan_id: scanId,
            repo_id: repoId,
            commit_hash: metadata.commit_hash,
            branch: metadata.branch,
            pr_number: metadata.pr_number,
            created_at: new Date().toISOString()
        });
        console.log(`[GitTraceability] Scan ${scanId} linked to commit ${metadata.commit_hash.substring(0, 7)}`);
    } catch (err) {
        console.error(`[GitTraceability] Failed to link commit to scan ${scanId}:`, err);
        throw err;
    }
};

/**
 * Fetches the historical lifecycle of a finding.
 */
export const getFindingHistory = async (findingId: string) => {
    try {
        console.log(`[DB Call] DatabaseID: ${DB_ID}, CollectionID: ${COLLECTIONS.FINDING_RESOLUTIONS}`);
        if (!COLLECTIONS.FINDING_RESOLUTIONS) throw new Error("collectionId is undefined");
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.FINDING_RESOLUTIONS, [
            Query.equal('finding_id', findingId),
            Query.orderDesc('$createdAt')
        ]);

        // Enrich with user email if possible (Appwrite doesn't support joins like Supabase)
        const resolutions = await Promise.all(response.documents.map(async (doc: any) => {
            let email = 'unknown';
            try {
                if (doc.user_id) {
                    const user = await users.get(doc.user_id);
                    email = user.email;
                }
            } catch (userErr) {
                console.warn(`[GitTraceability] Could not fetch user ${doc.user_id} for finding history:`, userErr);
            }
            return {
                ...doc,
                user_email: email
            };
        }));

        return resolutions;
    } catch (err) {
        console.error(`[GitTraceability] Error fetching finding history for ${findingId}:`, err);
        throw err;
    }
};

/**
 * Generates a stable fingerprint for a finding based on tool, file, and message.
 */
export const generateFingerprint = (f: { tool: string, file_path: string, message: string }): string => {
    // Basic deterministic string for tracking across scans
    return `${f.tool}:${f.file_path}:${Buffer.from(f.message).toString('base64').substring(0, 32)}`;
};
