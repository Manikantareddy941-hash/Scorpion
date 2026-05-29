import { Request, Response } from 'express';
import { deduplicateFindings } from '../deduplication';

export const getMetrics = async (req: Request, res: Response) => {
  try {
    const rawFindings: any[] = [];
    const dedupedFindings = deduplicateFindings(rawFindings);

    const totalRawFindings = rawFindings.length;
    const totalUniqueFindings = dedupedFindings.length;
    const noiseReductionPercentage = totalRawFindings
      ? ((totalRawFindings - totalUniqueFindings) / totalRawFindings) * 100
      : 0;

    const complianceMapping: Record<string, number> = {
      sast: dedupedFindings.filter((f: any) => f.tool?.includes('semgrep')).length,
      secret: dedupedFindings.filter((f: any) => f.tool?.includes('gitleaks')).length,
      sca: dedupedFindings.filter((f: any) => f.tool?.includes('trivy')).length,
      iac: 0,
    };

    const averageMTTRMinutes = 5;

    res.json({
      totalRawFindings,
      totalUniqueFindings,
      noiseReductionPercentage: Number(noiseReductionPercentage.toFixed(2)),
      complianceMapping,
      averageMTTRMinutes,
    });
  } catch (err) {
    console.error('Failed to compute dashboard metrics', err);
    res.status(500).json({ error: 'Unable to compute metrics' });
  }
};
