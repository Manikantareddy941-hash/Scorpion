/**
 * NOTE: nothing in the app imports this module — `getMonitorData` included.
 * It is left in place rather than removed, but treat it as unwired: the
 * functions below are not exercised by any screen.
 *
 * Its four reads used to go straight to Appwrite with no ownership filter at
 * all (every scan, every repository, every vulnerability in the collection).
 * They now go through the tenant-scoped backend, so wiring any of this up
 * later cannot reintroduce a cross-tenant read.
 */

type GetJWT = () => Promise<string | null>;

async function authedJson(getJWT: GetJWT, url: string): Promise<any> {
  const token = await getJWT();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

export const monitorService = {
  async getRecentScans(getJWT: GetJWT) {
    const body = await authedJson(getJWT, '/api/repos/scans?limit=10');
    return body?.documents ?? [];
  },

  async getMonitorData(getJWT: GetJWT) {
    return authedJson(getJWT, '/api/monitor');
  },

  async getVulnerabilityTrends(getJWT: GetJWT, days: number = 7) {
    const body = await authedJson(getJWT, '/api/issues?limit=1000');
    const documents: any[] = body?.documents ?? [];

    const grouped: { [key: string]: number } = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      grouped[d.toISOString().split('T')[0]] = 0;
    }

    documents.forEach((doc) => {
      const day = String(doc.$createdAt || '').split('T')[0];
      if (grouped[day] !== undefined) {
        grouped[day]++;
      }
    });

    return Object.entries(grouped)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async getRepoHealth(getJWT: GetJWT) {
    const repos = await authedJson(getJWT, '/api/repos');
    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - 7);

    return Promise.all((Array.isArray(repos) ? repos : []).map(async (repo: any) => {
      const [scanBody, vulnBody] = await Promise.all([
        authedJson(getJWT, `/api/repos/scans?repoId=${encodeURIComponent(repo.$id)}&limit=1`),
        authedJson(getJWT, `/api/issues?repoId=${encodeURIComponent(repo.$id)}&status=open&limit=1000`),
      ]);

      const latestScan = scanBody?.documents?.[0] ?? null;
      const openIssues = vulnBody?.total ?? 0;

      return {
        id: repo.$id,
        name: repo.name,
        isStale: !latestScan || new Date(latestScan.$createdAt) < staleThreshold,
        lastScan: latestScan?.$createdAt || null,
        openIssues,
        riskLevel: openIssues > 10 ? 'high' : openIssues > 0 ? 'medium' : 'low',
      };
    }));
  },

  async getLatestFindings(getJWT: GetJWT) {
    const body = await authedJson(getJWT, '/api/issues?limit=5');
    return body?.documents ?? [];
  },
};
