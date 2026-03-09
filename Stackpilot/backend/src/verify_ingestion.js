const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { Client, Databases, ID, Query } = require('node-appwrite');
const unzipper = require('unzipper');

// Load environment variables
require('dotenv').config();

const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const DB_ID = process.env.APPWRITE_DATABASE_ID;

const ALLOWED_EXTENSIONS = ['.ts', '.js', '.py', '.go', '.java', '.cpp', '.h', '.md', '.json', '.yml', '.yaml'];

async function ingestZip(filePath, projectId, userId) {
    const extractionPath = path.join(path.dirname(filePath), `extract_${Date.now()}`);

    if (!fs.existsSync(extractionPath)) {
        fs.mkdirSync(extractionPath, { recursive: true });
    }

    await fs.createReadStream(filePath)
        .pipe(unzipper.Extract({ path: extractionPath }))
        .promise();

    const files = [];
    const walkSync = (dir) => {
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walkSync(fullPath);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (ALLOWED_EXTENSIONS.includes(ext)) {
                    files.push(fullPath);
                }
            }
        });
    };

    walkSync(extractionPath);

    const repoName = `upload_${path.basename(filePath)}`;

    const repo = await databases.createDocument(
        DB_ID,
        'repositories',
        ID.unique(),
        {
            user_id: userId,
            project_id: projectId,
            name: repoName,
            url: `upload://${repoName}`,
            updated_at: new Date().toISOString()
        }
    );

    return {
        message: 'Ingestion successful',
        repoId: repo.$id,
        filesCount: files.length,
        extractionPath
    };
}

function cleanupWorkspace(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

async function verifyIngestion() {
    console.log('🚀 Starting Verification: Code Ingestion Module (JS)');

    const testUserId = ID.unique();
    let testProjectId;
    const zipPath = path.join(__dirname, 'test_project_js.zip');

    try {
        console.log('\n--- 0. Creating Test Project ---');
        const project = await databases.createDocument(
            DB_ID,
            'projects',
            ID.unique(),
            {
                user_id: testUserId,
                name: 'Ingestion Test Project ' + Date.now(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        );

        testProjectId = project.$id;
        console.log('✅ Project created:', project.name, 'ID:', testProjectId);

        console.log('\n--- 1. Creating Mock ZIP ---');
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        const promise = new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
        });

        archive.pipe(output);
        archive.append('console.log("hello world");', { name: 'src/index.ts' });
        archive.append('print("hello world")', { name: 'main.py' });
        archive.append('README content', { name: 'README.md' });
        await archive.finalize();
        await promise;
        console.log('✅ Mock ZIP created at:', zipPath);

        console.log('\n--- 2. Running Ingestion ---');
        const result = await ingestZip(zipPath, testProjectId, testUserId);
        console.log('✅ Ingestion Result:', result.message);
        console.log('   Repo ID:', result.repoId);
        console.log('   Files Found:', result.filesCount);
        console.log('   Extraction Path:', result.extractionPath);

        console.log('\n--- 3. Cleanup ---');
        cleanupWorkspace(zipPath);
        cleanupWorkspace(result.extractionPath);
        console.log('✅ Cleanup complete.');

        console.log('\n✨ Code Ingestion (JS) Verified Successfully! ✨');
    } catch (err) {
        console.error('\n❌ Ingestion Verification Failed:', err.message);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
}

verifyIngestion();
