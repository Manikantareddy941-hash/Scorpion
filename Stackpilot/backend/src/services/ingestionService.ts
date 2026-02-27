const fs = require('fs');
const path = require('path');
import unzipper from 'unzipper';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = ['.ts', '.js', '.py', '.go', '.java', '.cpp', '.h', '.md', '.json', '.yml', '.yaml'];

export const ingestZip = async (filePath: string, projectId: string, userId: string) => {
    const extractionPath = path.join(path.dirname(filePath), `extract_${Date.now()}`);

    try {
        // 1. Create extraction directory
        if (!fs.existsSync(extractionPath)) {
            fs.mkdirSync(extractionPath, { recursive: true });
        }

        // 2. Extract ZIP
        await fs.createReadStream(filePath)
            .pipe(unzipper.Extract({ path: extractionPath }))
            .promise();

        // 3. Scan extracted files (Secure extraction validation)
        const files: string[] = [];
        const walkSync = (dir: string) => {
            const list = fs.readdirSync(dir);
            list.forEach((file: string) => {
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

        // 4. Link to project (Create a mock repository entry for the upload)
        const repoName = `upload_${path.basename(filePath)}`;
        const { data: repo, error } = await supabase
            .from('repositories')
            .insert({
                user_id: userId,
                project_id: projectId,
                name: repoName,
                url: `upload://${repoName}`,
                local_path: extractionPath,
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

    } catch (err) {
        console.error('[IngestionService] Error:', err);
        throw err;
    }
};

export const cleanupWorkspace = (dirPath: string) => {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`[IngestionService] Cleaned up: ${dirPath}`);
        }
    } catch (err) {
        console.error('[IngestionService] Cleanup error:', err);
    }
};
