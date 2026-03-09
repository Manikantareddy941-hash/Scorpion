import 'dotenv/config';
import { Client, Databases } from 'node-appwrite';

const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);

const databases = new Databases(client);
const dbId = process.env.69aeb218002ad2403a36!;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function createAttr(fn: () => Promise<any>, name: string) {
    try {
        await fn();
        await delay(300); // give appwrite time between attributes
    } catch (e: any) {
        if (!e.message.includes('already exists') && !e.message.includes('Duplicate')) {
            console.error(`Error on attribute ${name}:`, e.message);
        }
    }
}

async function setup() {
    try {
        console.log(`Setting up collections in DB: ${dbId}`);
        // repositories
        try {
            await databases.createCollection(dbId, 'repositories', 'Repositories');
            console.log('✅ repositories collection created');
            await delay(1000);
        } catch (e: any) { if (!e.message.includes('already_exists')) console.log('repositories exist or error:', e.message); }

        await createAttr(() => databases.createStringAttribute(dbId, 'repositories', 'name', 255, true), 'name');
        await createAttr(() => databases.createStringAttribute(dbId, 'repositories', 'url', 2048, true), 'url');
        await createAttr(() => databases.createStringAttribute(dbId, 'repositories', 'user_id', 255, true), 'user_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'repositories', 'visibility', 50, true), 'visibility');
        await createAttr(() => databases.createDatetimeAttribute(dbId, 'repositories', 'created_at', true), 'created_at');
        await createAttr(() => databases.createDatetimeAttribute(dbId, 'repositories', 'last_scan_at', false), 'last_scan_at');
        await createAttr(() => databases.createIntegerAttribute(dbId, 'repositories', 'vulnerability_count', false), 'vulnerability_count');
        await createAttr(() => databases.createIntegerAttribute(dbId, 'repositories', 'risk_score', false), 'risk_score');
        await createAttr(() => databases.createDatetimeAttribute(dbId, 'repositories', 'updated_at', false), 'updated_at');
        await createAttr(() => databases.createStringAttribute(dbId, 'repositories', 'local_path', 2048, false), 'local_path');
        console.log('✅ repositories attributes setup complete');

        // scans
        try {
            await databases.createCollection(dbId, 'scans', 'Scans');
            console.log('✅ scans collection created');
            await delay(1000);
        } catch (e: any) { if (!e.message.includes('already_exists')) console.log('scans exist or error:', e.message); }

        await createAttr(() => databases.createStringAttribute(dbId, 'scans', 'repo_id', 255, true), 'repo_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'scans', 'status', 50, true), 'status');
        await createAttr(() => databases.createStringAttribute(dbId, 'scans', 'scan_type', 50, true), 'scan_type');
        await createAttr(() => databases.createStringAttribute(dbId, 'scans', 'details', 100000, false), 'details');
        console.log('✅ scans attributes setup complete');

        // vulnerabilities
        try {
            await databases.createCollection(dbId, 'vulnerabilities', 'Vulnerabilities');
            console.log('✅ vulnerabilities collection created');
            await delay(1000);
        } catch (e: any) { if (!e.message.includes('already_exists')) console.log('vulnerabilities exist or error:', e.message); }

        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'repo_id', 255, true), 'repo_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'scan_result_id', 255, true), 'scan_result_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'tool', 50, true), 'tool');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'severity', 50, true), 'severity');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'message', 4096, true), 'message');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'file_path', 2048, false), 'file_path');
        await createAttr(() => databases.createIntegerAttribute(dbId, 'vulnerabilities', 'line_number', false), 'line_number');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'status', 50, true), 'status');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'resolution_status', 50, true), 'resolution_status');
        await createAttr(() => databases.createStringAttribute(dbId, 'vulnerabilities', 'fingerprint', 255, true), 'fingerprint');
        console.log('✅ vulnerabilities attributes setup complete');

        // notification_preferences
        try {
            await databases.createCollection(dbId, 'notification_preferences', 'Notification Preferences');
            console.log('✅ notification_preferences collection created');
            await delay(1000);
        } catch (e: any) { if (!e.message.includes('already_exists')) console.log('notification_preferences exist or error:', e.message); }

        await createAttr(() => databases.createStringAttribute(dbId, 'notification_preferences', 'user_id', 255, true), 'user_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'notification_preferences', 'repo_id', 255, false), 'repo_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'notification_preferences', 'channel', 50, true), 'channel');
        await createAttr(() => databases.createStringAttribute(dbId, 'notification_preferences', 'event_type', 50, true), 'event_type');
        await createAttr(() => databases.createBooleanAttribute(dbId, 'notification_preferences', 'enabled', true), 'enabled');
        await createAttr(() => databases.createDatetimeAttribute(dbId, 'notification_preferences', 'updated_at', false), 'updated_at');
        console.log('✅ notification_preferences attributes setup complete');

        // policy_evaluations
        try {
            await databases.createCollection(dbId, 'policy_evaluations', 'Policy Evaluations');
            console.log('✅ policy_evaluations collection created');
            await delay(1000);
        } catch (e: any) { if (!e.message.includes('already_exists')) console.log('policy_evaluations exist or error:', e.message); }

        await createAttr(() => databases.createStringAttribute(dbId, 'policy_evaluations', 'scan_id', 255, true), 'scan_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'policy_evaluations', 'repo_id', 255, true), 'repo_id');
        await createAttr(() => databases.createStringAttribute(dbId, 'policy_evaluations', 'policy_name', 255, true), 'policy_name');
        await createAttr(() => databases.createStringAttribute(dbId, 'policy_evaluations', 'result', 50, true), 'result');
        await createAttr(() => databases.createStringAttribute(dbId, 'policy_evaluations', 'details', 100000, false), 'details');
        await createAttr(() => databases.createDatetimeAttribute(dbId, 'policy_evaluations', 'created_at', true), 'created_at');
        console.log('✅ policy_evaluations attributes setup complete');

        console.log('🎉 Setup Process Finished!');
    } catch (e) {
        console.error('Setup failed:', e);
    }
}

setup();
