import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';

export const monitorService = {
  async getRecentScans() {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
      Query.orderDesc('$createdAt'),
      Query.limit(10)
    ]);
    return response.documents;
  },

  async getVulnerabilityTrends(days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
      Query.greaterThan('$createdAt', startDate.toISOString()),
      Query.limit(1000)
    ]);
    
    // Group by day
    const grouped: { [key: string]: number } = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      grouped[d.toISOString().split('T')[0]] = 0;
    }

    response.documents.forEach(doc => {
      const day = doc.$createdAt.split('T')[0];
      if (grouped[day] !== undefined) {
        grouped[day]++;
      }
    });

    return Object.entries(grouped)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async getRepoHealth() {
    const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES);
    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - 7);

    const healthData = await Promise.all(repos.documents.map(async (repo) => {
      const latestScan = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
        Query.equal('repo_id', repo.$id),
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]);

      const isStale = latestScan.total === 0 || new Date(latestScan.documents[0].$createdAt) < staleThreshold;
      
      // Calculate risk score based on open vulnerabilities
      const openVulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
        Query.equal('repo_id', repo.$id),
        Query.equal('status', 'open'),
        Query.limit(0)
      ]);

      return {
        id: repo.$id,
        name: repo.name,
        isStale,
        lastScan: latestScan.documents[0]?.$createdAt || null,
        openIssues: openVulns.total,
        riskLevel: openVulns.total > 10 ? 'high' : openVulns.total > 0 ? 'medium' : 'low'
      };
    }));

    return healthData;
  },

  async getLatestFindings() {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
      Query.orderDesc('$createdAt'),
      Query.limit(5)
    ]);
    return response.documents;
  }
};
