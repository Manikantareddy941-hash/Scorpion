import * as dotenv from 'dotenv';
dotenv.config();

import { databases, DB_ID } from '../lib/appwrite';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Adds the team_id attribute to the repositories collection so repos can be
 * scoped to a team (multi-tenant) instead of only the creating user. Not
 * required, no default -- existing repos are left with team_id unset and
 * keep resolving to their current personal (user_id) scope.
 */
async function migrate() {
    try {
        console.log(`Adding team_id to repositories in DB: ${DB_ID}`);
        await databases.createStringAttribute(DB_ID, 'repositories', 'team_id', 255, false);
        await delay(1000);
        console.log('Done. team_id is now available on the repositories collection.');
        process.exit(0);
    } catch (err: any) {
        if (err.code === 409) {
            console.log('Attribute team_id already exists on repositories.');
            process.exit(0);
        }
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
