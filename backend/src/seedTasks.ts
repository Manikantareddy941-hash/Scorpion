import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { databases, DB_ID, COLLECTIONS, ID } from './lib/appwrite';

async function seedTasks() {
    try {
        console.log(`[Seed] Connecting to DB: ${DB_ID}`);
        console.log(`[Seed] Collection: ${COLLECTIONS.FINDINGS}`);

        const now = new Date();
        const past = new Date(now.getTime() - (20 * 60 * 60 * 1000)); // 20 hours ago

        const tasks = [
            {
                title: "Remote Code Execution in log4j dependency",
                repo_name: "payment-gateway",
                type: "dependency",
                severity: "critical",
                file_path: "package.json",
                status: "open",
                created_at: past.toISOString()
            },
            {
                title: "Hardcoded AWS Credentials found in main.tf",
                repo_name: "infrastructure-as-code",
                type: "secret",
                severity: "high",
                file_path: "main.tf",
                status: "open",
                created_at: now.toISOString()
            },
            {
                title: "Outdated Base Image in production container",
                repo_name: "auth-service",
                type: "dast",
                severity: "medium",
                file_path: "Dockerfile",
                status: "open",
                created_at: now.toISOString()
            }
        ];

        for (const task of tasks) {
            await databases.createDocument(
                DB_ID,
                COLLECTIONS.FINDINGS,
                ID.unique(),
                task
            );
            console.log(`[Seed] ✅ Created mock task: ${task.title}`);
        }
        
        console.log('[Seed] 🚀 Successfully seeded all mock tasks!');
        process.exit(0);
    } catch (err: any) {
        console.error('[Seed] ❌ Error seeding tasks:', err.message);
        // Wait, what if created_at is not allowed as a field? Let's try without it if it fails
        if (err.message.includes('created_at')) {
            console.log('Retrying without custom created_at field...');
            try {
                const now = new Date();
                const tasks = [
                    {
                        title: "Remote Code Execution in log4j dependency",
                        repo_name: "payment-gateway",
                        type: "dependency",
                        severity: "critical",
                        file_path: "package.json",
                        status: "open",
                    },
                    {
                        title: "Hardcoded AWS Credentials found in main.tf",
                        repo_name: "infrastructure-as-code",
                        type: "secret",
                        severity: "high",
                        file_path: "main.tf",
                        status: "open",
                    },
                    {
                        title: "Outdated Base Image in production container",
                        repo_name: "auth-service",
                        type: "dast",
                        severity: "medium",
                        file_path: "Dockerfile",
                        status: "open",
                    }
                ];

                for (const task of tasks) {
                    await databases.createDocument(
                        DB_ID,
                        COLLECTIONS.FINDINGS,
                        ID.unique(),
                        task
                    );
                    console.log(`[Seed] ✅ Created mock task: ${task.title}`);
                }
                console.log('[Seed] 🚀 Successfully seeded all mock tasks!');
                process.exit(0);
            } catch (err2: any) {
                console.error('[Seed] ❌ Fallback failed:', err2.message);
                process.exit(1);
            }
        } else {
            process.exit(1);
        }
    }
}

seedTasks();
