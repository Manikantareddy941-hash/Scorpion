import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';

const execAsync = promisify(exec);
const SBOM_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export const generateSBOM = async (repoId: string, format: 'json' | 'csv' = 'json') => {
    // 1. Get repo details
    const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, repoId);
    if (!repo || !repo.url) {
        throw new Error('Repository not found or URL missing');
    }

    const tempDir = path.join(process.cwd(), 'tmp', `sbom_${repoId}_${Date.now()}`);
    if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
        fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
    }

    try {
        let scanPath = repo.url;
        let isTemporary = false;

        if (repo.url.startsWith('http')) {
            console.log('[SBOM] Cloning remote repo:', repo.url);
            await execAsync(`git clone --depth 1 "${repo.url}" "${tempDir}"`, { timeout: 60000 });
            scanPath = tempDir;
            isTemporary = true;
        } else if (repo.url.startsWith('upload://')) {
            scanPath = repo.local_path;
        }

        console.log(`[SBOM] Running Trivy SBOM for: ${scanPath}`);
        
        // Use CycloneDX format as it's standard for SBOM
        const outputFormat = format === 'json' ? 'cyclonedx' : 'csv';
        // Note: Trivy might not support direct CSV for 'fs' SBOM easily in older versions, 
        // but CycloneDX JSON is the standard.
        // If format is CSV, we might need to convert or use a different Trivy command.
        // For simplicity and standard compliance, we'll focus on CycloneDX JSON.
        
        const cmd = `trivy fs --format ${outputFormat} --output "${tempDir}_out.${format}" "${scanPath}"`;
        await execAsync(cmd, { timeout: SBOM_TIMEOUT_MS });

        const outputPath = `${tempDir}_out.${format}`;
        if (!fs.existsSync(outputPath)) {
            throw new Error('SBOM generation failed - output file missing');
        }

        const content = fs.readFileSync(outputPath, 'utf-8');
        
        // Cleanup
        if (isTemporary && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }

        if (format === 'json') {
            const parsed = JSON.parse(content);
            return {
                metadata: parsed.metadata || {},
                components: parsed.components || []
            };
        }

        return content; // Raw CSV string

    } catch (err: any) {
        // Cleanup on error
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        const outputPath = `${tempDir}_out.${format}`;
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        
        console.error('[SBOM] Error:', err);
        throw err;
    }
};
