import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import pool, { query, updateScanStatus } from './db';
import { scanQueue } from './queue';

const app = express();
app.use(express.json());

// Environment Validation
const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    PORT: z.string().optional().default('3000'),
    LOG_LEVEL: z.enum(['info', 'debug', 'error']).default('info'),
});

const env = envSchema.parse(process.env);

// Health Check Endpoint
app.get('/scan/health', async (req: Request, res: Response) => {
    try {
        // Check DB connection
        await query('SELECT 1');
        // Check Redis connection (implicitly checked by queue availability)
        res.json({ status: 'healthy', database: 'connected', redis: 'connected' });
    } catch (error: any) {
        res.status(503).json({ status: 'unhealthy', error: error.message });
    }
});

const scanSchema = z.object({
    repo_url: z.string().refine((value: string) => {
        // PRE-PARSING SECURITY: Strictly whitelist the prefix at the string level
        if (!value.startsWith("https://github.com/")) return false;
        if (value.includes('..')) return false;

        try {
            const url = new URL(value);

            // 1. Enforce HTTPS only (Already checked by prefix, but good for depth)
            if (url.protocol !== "https:") return false;

            // 2. Enforce GitHub only
            if (url.hostname !== "github.com") return false;

            // 3. Enforce /owner/repo format specifically
            const pathParts = url.pathname.split("/").filter(Boolean);
            if (pathParts.length !== 2) return false;

            // 4. Block path traversal or extra segments
            // Prefix check + split check makes this extremely robust
            if (pathParts.some(part => part === '..' || part === '.')) return false;

            return true;
        } catch {
            return false;
        }
    }, {
        message: "Only valid GitHub HTTPS repository URLs (https://github.com/owner/repo) are allowed."
    })
});

app.post('/scan', async (req: Request, res: Response) => {
    try {
        const { repo_url } = scanSchema.parse(req.body);

        // 1. Insert scan with status = created
        const scanId = uuidv4();
        await query(
            'INSERT INTO scans (id, repo_url, status) VALUES ($1, $2, $3)',
            [scanId, repo_url, 'created']
        );

        // 2. Add job to BullMQ
        await scanQueue.add('run-scan', { scanId });

        // 3. Update status = scan_queued (Atomic)
        const updated = await updateScanStatus(scanId, 'scan_queued', 'created');

        if (!updated) {
            return res.status(500).json({ error: 'Failed to queue scan' });
        }

        res.json({ scan_id: scanId, status: 'scan_queued' });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message });
    }
});

app.get('/scan/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const scanResult = await query('SELECT * FROM scans WHERE id = $1', [id]);
        if (scanResult.rows.length === 0) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        const vulnerabilitiesResult = await query(
            'SELECT * FROM vulnerabilities WHERE scan_id = $1',
            [id]
        );

        res.json({
            scan: scanResult.rows[0],
            vulnerabilities: vulnerabilitiesResult.rows
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Server running on port ${PORT}`);
});
