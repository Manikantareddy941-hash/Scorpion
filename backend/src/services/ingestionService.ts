import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { logger, errorContext } from './logger';

const MAX_ENTRY_SIZE = 50 * 1024 * 1024;         // 50MB per extracted file
const MAX_TOTAL_UNCOMPRESSED = 300 * 1024 * 1024; // 300MB total — zip-bomb guard
const ALLOWED_EXTENSIONS = ['.ts', '.js', '.py', '.go', '.java', '.cpp', '.h', '.md', '.json', '.yml', '.yaml'];

export const ingestZip = async (filePath: string, projectId: string, userId: string) => {
    const extractionPath = path.join(path.dirname(filePath), `extract_${Date.now()}`);

    try {
        // 1. Create extraction directory
        if (!fs.existsSync(extractionPath)) {
            fs.mkdirSync(extractionPath, { recursive: true });
        }

        // 2. Extract ZIP, validating each entry stays within extractionPath (zip-slip
        //    guard) and enforcing per-entry and total uncompressed size caps so a
        //    small "zip bomb" can't decompress into hundreds of GB and fill the disk.
        const resolvedExtractionPath = path.resolve(extractionPath) + path.sep;
        const directory = await unzipper.Open.file(filePath);
        let totalUncompressed = 0;
        for (const entry of directory.files) {
            const targetPath = path.resolve(extractionPath, entry.path);
            if (!targetPath.startsWith(resolvedExtractionPath)) {
                logger.warn(`[IngestionService] Skipping zip entry with path traversal: ${entry.path}`);
                continue;
            }
            if (entry.type === 'Directory') {
                fs.mkdirSync(targetPath, { recursive: true });
                continue;
            }
            const entrySize = (entry as any).uncompressedSize || 0;
            if (entrySize > MAX_ENTRY_SIZE) {
                // With unzipper's Open.file API, entries are read on demand, so
                // simply not calling entry.stream() skips it — no drain needed.
                logger.warn(`[IngestionService] Skipping oversized zip entry (${entrySize} bytes): ${entry.path}`);
                continue;
            }
            totalUncompressed += entrySize;
            if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
                throw new Error('Archive exceeds maximum uncompressed size limit');
            }
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            await new Promise<void>((resolve, reject) => {
                entry.stream()
                    .pipe(fs.createWriteStream(targetPath))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }

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
        const repo = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
            user_id: userId,
            project_id: projectId,
            name: repoName,
            url: `upload://${repoName}`,
            local_path: extractionPath,
            updated_at: new Date().toISOString(),
            created_at: new Date().toISOString()
        });

        return {
            message: 'Ingestion successful',
            repoId: repo.$id,
            filesCount: files.length,
            extractionPath
        };

    } catch (err) {
        logger.error('[IngestionService] Error:', { event: 'INGESTION_FAILED', ...errorContext(err) });
        throw err;
    }
};

export const cleanupWorkspace = (dirPath: string) => {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.info(`[IngestionService] Cleaned up: ${dirPath}`);
        }
    } catch (err) {
        logger.error('[IngestionService] Cleanup error:', { event: 'INGESTION_CLEANUP_FAILED', ...errorContext(err) });
    }
};
