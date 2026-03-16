import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { User } from '@supabase/supabase-js';
import { Request } from 'express';
import { ingestZip, cleanupWorkspace } from '../services/ingestionService';

interface AuthenticatedRequest extends Request {
    user?: User;
}

const router = Router();

// Configure storage for uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.zip') {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

// ZIP Upload Endpoint
router.post('/zip', upload.single('project_zip'), async (req: AuthenticatedRequest, res: Response) => {
    const { projectId } = req.body;

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!projectId) {
        cleanupWorkspace(req.file.path);
        return res.status(400).json({ error: 'projectId is required' });
    }

    try {
        const result = await ingestZip(req.file.path, projectId, req.user!.id);

        // Final cleanup of the uploaded ZIP file itself (not the extraction path yet if it's being used)
        // In a real app, we might move the extraction path to a persistent storage or trigger a scan immediately.
        cleanupWorkspace(req.file.path);

        res.json(result);
    } catch (err: any) {
        if (req.file) cleanupWorkspace(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

export default router;
