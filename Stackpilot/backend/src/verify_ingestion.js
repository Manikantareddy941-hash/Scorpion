const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { createClient } = require('@supabase/supabase-js');
const unzipper = require('unzipper');

// Load environment variables manually if dotnev is not used in raw JS
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    const { data: repo, error } = await supabase
        .from('repositories')
        .insert({
            user_id: userId,
            project_id: projectId,
            name: repoName,
            url: `upload://${repoName}`,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) throw error;

    return {
        message: 'Ingestion successful',
        repoId: repo.id,
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

    const testUserId = 'a95d9aa5-8992-4f2a-beb5-8ccdeb0bcd26';
    let testProjectId;
    const zipPath = path.join(__dirname, 'test_project_js.zip');

    try {
        console.log('\n--- 0. Creating Test Project ---');
        const { data: project, error: pError } = await supabase
            .from('projects')
            .insert({
                user_id: testUserId,
                name: 'Ingestion Test Project ' + Date.now(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (pError) throw pError;
        testProjectId = project.id;
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
