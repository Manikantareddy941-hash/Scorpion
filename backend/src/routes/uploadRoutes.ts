import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { Models } from 'node-appwrite';
import { Request } from 'express';
import { ingestZip, cleanupWorkspace } from '../services/ingestionService';
import { uploadLimiter } from '../middleware/rateLimiters';

interface AuthenticatedRequest extends Request {
    user?: Models.User<Models.Preferences>;
}

const router = Router();

const zipUploadSchema = z.object({
    projectId: z.string().trim().min(1, 'projectId is required'),
});

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

// Verifies the file actually begins with the ZIP local-file-header magic bytes
// (PK\x03\x04, or the empty/spanned variants PK\x05\x06 / PK\x07\x08), since the
// multer extension filter alone is trivially spoofable by renaming any file .zip.
const hasZipSignature = (p: string): boolean => {
    let fd: number | null = null;
    try {
        fd = fs.openSync(p, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        if (buf[0] !== 0x50 || buf[1] !== 0x4b) return false; // 'PK'
        const third = buf[2], fourth = buf[3];
        return (
            (third === 0x03 && fourth === 0x04) ||
            (third === 0x05 && fourth === 0x06) ||
            (third === 0x07 && fourth === 0x08)
        );
    } catch {
        return false;
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
};

// ZIP Upload Endpoint
router.post('/zip', uploadLimiter, upload.single('project_zip'), async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Content-based validation: reject anything that isn't really a ZIP regardless
    // of its filename/extension or declared MIME type.
    if (!hasZipSignature(req.file.path)) {
        cleanupWorkspace(req.file.path);
        return res.status(400).json({ error: 'Uploaded file is not a valid ZIP archive' });
    }

    // multer parses multipart text fields into req.body alongside the file, so
    // validation has to happen here rather than as a pre-multer middleware.
    const parsed = zipUploadSchema.safeParse(req.body);
    if (!parsed.success) {
        cleanupWorkspace(req.file.path);
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
    }
    const { projectId } = parsed.data;

    try {
        const result = await ingestZip(req.file.path, projectId, req.user!.$id);

        // Final cleanup of the uploaded ZIP file itself (not the extraction path yet if it's being used)
        // In a real app, we might move the extraction path to a persistent storage or trigger a scan immediately.
        cleanupWorkspace(req.file.path);

        res.json(result);
    } catch (err: unknown) {
        if (req.file) cleanupWorkspace(req.file.path);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
});

export default router;
