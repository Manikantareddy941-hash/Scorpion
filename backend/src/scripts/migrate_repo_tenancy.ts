import * as dotenv from 'dotenv';
dotenv.config();

import { databases, DB_ID } from '../lib/appwrite';
import { errorMessage } from '../services/logger';
import { isAppwriteError } from '../utils/errorGuards';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function addAttribute(collectionId: string, key: string) {
    try {
        console.log(`Adding ${key} to ${collectionId} in DB: ${DB_ID}`);
        await databases.createStringAttribute(DB_ID, collectionId, key, 255, false);
        await delay(1000);
        console.log(`Done. ${key} is now available on the ${collectionId} collection.`);
    } catch (err) {
        if (isAppwriteError(err) && err.code === 409) {
            console.log(`Attribute ${key} already exists on ${collectionId}.`);
            return;
        }
        throw err;
    }
}

/**
 * Adds the team_id attribute to the repositories collection so repos can be
 * scoped to a team (multi-tenant) instead of only the creating user, and
 * user_id to scans so scans with no real owning repo (DAST, which uses a
 * placeholder repo_id of 'dast') can still be ownership-checked directly.
 * Neither is required, no default -- existing docs are left unset and
 * keep resolving to their current scope.
 */
async function migrate() {
    try {
        await addAttribute('repositories', 'team_id');
        await addAttribute('scans', 'user_id');
        await addAttribute('incidents', 'user_id');
        await addAttribute('compliance_controls', 'scopeId');
        await addAttribute('plan_projects', 'user_id');
        // ai_metrics events were previously aggregated across all users; this lets
        // getAIAggregates/getAITrends scope results to the calling user.
        await addAttribute('ai_metrics', 'userId');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', errorMessage(err));
        process.exit(1);
    }
}

migrate();
