import { Router, Request, Response } from 'express';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import crypto from 'crypto';

function getHighestSeverity(severities: string[]): string {
    const order = ['critical', 'high', 'medium', 'low', 'unknown'];
    for (const level of order) {
        if (severities.map(s => s.toLowerCase()).includes(level)) return level.toUpperCase();
    }
    return 'NONE';
}

const router = Router();

router.get('/:repoId', async (req: Request, res: Response) => {
    const { repoId } = req.params;
    const format = (req.query.format as 'json' | 'csv') || 'json';

    try {
        console.log(`[SBOM] Generating SBOM from database for repo: ${repoId}`);

        // 1. Get the latest completed scan for this repo to get the scanId
        const scansRes = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoId),
            Query.equal('status', 'completed'),
            Query.orderDesc('$createdAt'),
            Query.limit(1)
        ]);

        if (scansRes.total === 0) {
            return res.status(404).json({ error: 'No completed scans found for this repository. Run a scan first.' });
        }

        const scan = scansRes.documents[0];
        const scanId = scan.$id;

        // 2. Fetch all vulnerabilities for this scanId
        const vulnsRes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('scanId', scanId),
            Query.limit(1000)
        ]);

        // 3. Deduplicate by package name to create a component list
        const componentsMap = new Map();
        
        vulnsRes.documents.forEach((v: any) => {
            const pkgName = v.package || 'unknown-package';
            if (!componentsMap.has(pkgName)) {
                componentsMap.set(pkgName, {
                    name: pkgName,
                    version: v.installedVersion || v.version || 'unknown',
                    fixVersion: '',
                    severities: [],
                    cveIds: []
                });
            }
            
            const comp = componentsMap.get(pkgName);
            
            // Capture fixVersion whenever we find one (don't stop at first)
            const fv = v.fixVersion || v.fixedVersion || v.fix_version || '';
            if (fv && fv.trim()) {
                comp.fixVersion = fv.trim();
            }

            // Severity dedup with normalization
            const sev = (v.severity || '').toLowerCase();
            if (sev && !comp.severities.includes(sev)) {
                comp.severities.push(sev);
            }

            // CVE ID/Description — use message as primary source
            const cveText = v.message || v.title || '';
            if (cveText && !comp.cveIds.includes(cveText)) {
                comp.cveIds.push(cveText);
            }
        });

        const components = Array.from(componentsMap.values());

        if (format === 'json') {
            // Build CycloneDX JSON
            const sbom = {
                bomFormat: "CycloneDX",
                specVersion: "1.4",
                serialNumber: `urn:uuid:${crypto.randomUUID()}`,
                version: 1,
                metadata: {
                    timestamp: new Date().toISOString(),
                    component: {
                        name: repoId,
                        type: "application",
                        version: "1.0.0"
                    },
                    tools: [
                        {
                            vendor: "Scorpion",
                            name: "Scorpion SBOM Engine",
                            version: "1.0.0"
                        }
                    ]
                },
                components: components.map(c => ({
                    type: "library",
                    name: c.name,
                    version: c.version,
                    purl: `pkg:npm/${encodeURIComponent(c.name)}@${c.version}`,
                    ...(c.fixVersion ? { fixVersion: c.fixVersion } : {}),
                    properties: [
                        { name: 'fix:recommendedVersion', value: c.fixVersion || 'N/A' },
                        { name: 'risk:severities', value: c.severities.join(', ') || 'none' },
                        { name: 'risk:highestSeverity', value: getHighestSeverity(c.severities) },
                    ],
                    vulnerabilities: c.cveIds.map((id: string) => ({
                        id,
                        ratings: [{
                            severity: (c.severities[0] || 'unknown').toLowerCase(),
                            method: 'CVSSv3',
                        }],
                    }))
                }))
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="sbom_${repoId}.json"`);
            return res.json(sbom);
        } else {
            // Build CSV
            const csvLines = [
                'Name,Version,FixVersion,HighestSeverity,All Severities,CVE IDs,PURL',
                ...Array.from(componentsMap.values()).map((c) =>
                    [
                        `"${c.name}"`,
                        `"${c.version}"`,
                        `"${c.fixVersion || 'N/A'}"`,
                        `"${getHighestSeverity(c.severities)}"`,
                        `"${c.severities.join('; ') || 'none'}"`,
                        `"${c.cveIds.slice(0, 3).join(' | ') || 'none'}"`,
                        `"pkg:npm/${encodeURIComponent(c.name)}@${c.version}"`,
                    ].join(',')
                ),
            ];
            const csv = csvLines.join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="sbom_${repoId}.csv"`);
            return res.send(csv);
        }

    } catch (err: any) {
        console.error('[SBOM Route] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate SBOM' });
    }
});

export default router;
