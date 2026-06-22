import crypto from 'crypto';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { createIncident } from './incidentService';
import { logger } from './logger';

export interface GitleaksRawMatch {
    Match?: string;
    RuleID?: string;
    File?: string;
    Description?: string;
    StartLine?: number;
    EndLine?: number;
}

// Must match keyRoutes.ts's `sp_${crypto.randomBytes(24).toString('hex')}` format exactly.
const SCORPION_KEY_PATTERN = /sp_[a-f0-9]{48}/;

/**
 * Checks raw (unredacted) Gitleaks matches against the repo owner's active
 * API keys and revokes any that were leaked into the scanned repo.
 *
 * This is deliberately the one fully-automatic action in the incident
 * response surface (vs. freezeReleaseGateForIncident's broader freeze):
 * a hash match against our own key format has no false-positive risk, and
 * the correct response to "this exact credential is now public in a repo"
 * is always to revoke it immediately, not wait for a human to triage.
 *
 * Must be called with the RAW gitleaks output, before normalizeGitleaks
 * (scanners/normalizer.ts) redacts the Match field for storage - that's
 * the only place these raw values exist; nothing here persists them.
 */
export const respondToLeakedKeys = async (
    rawGitleaksMatches: GitleaksRawMatch[],
    ownerUserId: string | undefined,
    repoId: string
): Promise<void> => {
    if (!ownerUserId || !Array.isArray(rawGitleaksMatches) || rawGitleaksMatches.length === 0) {
        return;
    }

    try {
        const keysRes = await databases.listDocuments(DB_ID, COLLECTIONS.API_KEYS, [
            Query.equal('user_id', ownerUserId),
        ]);
        if (keysRes.total === 0) return;

        for (const match of rawGitleaksMatches) {
            const candidate = match.Match?.match(SCORPION_KEY_PATTERN)?.[0];
            if (!candidate) continue;

            const candidateHash = crypto.createHash('sha256').update(candidate).digest('hex');
            const leakedKey = keysRes.documents.find(k => k.key_hash === candidateHash);
            if (!leakedKey) continue;

            await databases.deleteDocument(DB_ID, COLLECTIONS.API_KEYS, leakedKey.$id);
            logger.error(
                `[Leaked Key Response] Revoked API key ${leakedKey.$id} ("${leakedKey.name}") - matched Gitleaks rule ${match.RuleID} in ${match.File}`
            );

            await createIncident({
                title: `API key automatically revoked: leaked in ${match.File}`,
                severity: 'critical',
                source: 'ci_pipeline',
                description: `A SCORPION API key ("${leakedKey.name}") was found in plaintext in repo ${repoId} (${match.File}, Gitleaks rule ${match.RuleID}) and was automatically revoked. Issue a replacement key if you still need it.`,
                relatedScanId: undefined,
                userId: ownerUserId,
            });
        }
    } catch (err) {
        // Best-effort, same as freezeReleaseGateForIncident - a failure here
        // must never break the scan that's reporting this finding.
        logger.error('[Leaked Key Response] Failed:', err instanceof Error ? err.message : err);
    }
};
