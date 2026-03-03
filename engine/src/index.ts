import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import pool, { query, updateScanStatus } from './db';
import { scanQueue } from './queue';

const app = express();
app.use(express.json());

const scanSchema = z.object({
    repo_url: z.string().url().refine(url => {
        // Basic validation to prevent local file path injection
        return url.startsWith('http://') || url.startsWith('https://');
    }, "Only http/https URLs are allowed")
});

app.post('/scan', async (req, res) => {
    try {
        const { repo_url } = scanSchema.parse(req.body);

        // 1. Insert scan with status = created
        const scanId = uuidv4();
        await query(
            'INSERT INTO scans (id, repo_url, status) VALUES ($1, $2, $3)',
            [scanId, repo_url, 'created']
        );

        // 2. Add job to BullMQ
        await scanQueue.add('run-scan', { scanId, repo_url });

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

app.get('/scan/:id', async (req, res) => {
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
