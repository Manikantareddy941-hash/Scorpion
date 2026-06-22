import express, { Request, Response } from 'express';
import { Models } from 'node-appwrite';
import PDFDocument from 'pdfkit';
import { Parser } from 'json2csv';
import { evaluateCompliance } from '../services/complianceEngine';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { logAuditEvent } from '../utils/auditLogger';
import { logger } from '../services/logger';

interface AuthenticatedRequest extends Request {
  user?: Models.User<Models.Preferences>;
}

const router = express.Router();

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, [Query.equal('scopeId', userId)]);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch compliance controls' });
  }
});

router.post('/evaluate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.$id || '';
    const results = await evaluateCompliance(userId);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Compliance evaluation failed' });
  }
});

const FRAMEWORK_ORDER = ['SOC2', 'ISO27001'];

/**
 * GET /api/compliance/export?format=pdf|csv
 *
 * Exports the most recently evaluated compliance controls as an auditor-
 * facing evidence package. Exports the stored point-in-time snapshot (run
 * POST /evaluate first to refresh it) rather than recomputing live - an
 * evidence document should reflect what was actually evaluated, not a
 * number that could change mid-export.
 */
router.get('/export', async (req: AuthenticatedRequest, res: Response) => {
  const format = (req.query.format as string) || 'pdf';
  if (format !== 'pdf' && format !== 'csv') {
    return res.status(400).json({ error: "format must be 'pdf' or 'csv'" });
  }

  try {
    const userId = req.user?.$id || '';
    const controlsRes = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, [
      Query.equal('scopeId', userId),
    ]);
    const controls = controlsRes.documents;

    await logAuditEvent('COMPLIANCE_EVIDENCE_EXPORTED', `Compliance evidence exported as ${format.toUpperCase()} (${controls.length} controls)`, userId);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="scorpion-compliance-evidence.csv"');

      const rows = controls.map((c) => ({
        framework: c.framework,
        controlId: c.controlId,
        title: c.title,
        status: c.status,
        lastEvaluated: c.lastEvaluated,
        evidence: (() => {
          try {
            const parsed = typeof c.evidence === 'string' ? JSON.parse(c.evidence) : c.evidence;
            return Array.isArray(parsed) ? parsed.join(';') : '';
          } catch {
            return '';
          }
        })(),
      }));

      const parser = new Parser({ fields: ['framework', 'controlId', 'title', 'status', 'lastEvaluated', 'evidence'] });
      return res.send(parser.parse(rows));
    }

    // PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="scorpion-compliance-evidence.pdf"');

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fillColor('#1D4ED8').fontSize(22).text('SCORPION Compliance Evidence Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#334155').fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    const passing = controls.filter((c) => c.status === 'passing').length;
    doc.fillColor('#0F172A').fontSize(14).text('Summary');
    doc.fontSize(10).fillColor('#475569')
      .text(`Total controls evaluated: ${controls.length}`)
      .text(`Passing: ${passing}`)
      .text(`Failing: ${controls.length - passing}`);
    doc.moveDown(1.5);

    for (const framework of FRAMEWORK_ORDER) {
      const frameworkControls = controls.filter((c) => c.framework === framework);
      if (frameworkControls.length === 0) continue;

      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor('#0F172A').text(framework);
      doc.moveDown(0.5);

      for (const control of frameworkControls) {
        if (doc.y > 700) doc.addPage();
        const statusColor = control.status === 'passing' ? '#16A34A' : '#DC2626';
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#0F172A').text(`${control.controlId} - ${control.title}`);
        doc.font('Helvetica').fontSize(9)
          .fillColor(statusColor).text(`Status: ${control.status.toUpperCase()}`, { continued: false });
        doc.fillColor('#64748B').text(`Last evaluated: ${control.lastEvaluated || 'never'}`);
        doc.moveDown(0.75);
      }
      doc.moveDown(1);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#94A3B8').text(`Page ${i + 1} of ${range.count}`, 50, 750, { align: 'center' });
    }

    doc.end();
  } catch (error) {
    logger.error('[Compliance Export Error]', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export compliance evidence' });
    }
  }
});

export default router;
