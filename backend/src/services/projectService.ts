import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { triggerScan } from './scanService';

// -----------------------------------------------------------------------------
// CREATE PROJECT
// -----------------------------------------------------------------------------
export const createProject = async (
    userId: string,
    name: string,
    description?: string
) => {
    try {
        const project = await databases.createDocument(DB_ID, COLLECTIONS.PROJECTS || 'projects', ID.unique(), {
            user_id: userId,
            name,
            description,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        return { data: project, error: null };
    } catch (error) {
        return { data: null, error };
    }
};

// -----------------------------------------------------------------------------
// GET PROJECTS
// -----------------------------------------------------------------------------
export const getProjects = async (userId: string) => {
    try {
        const response = await databases.listDocuments(DB_ID, COLLECTIONS.PROJECTS || 'projects', [
            Query.equal('user_id', userId),
            Query.orderDesc('created_at')
        ]);
        return { data: response.documents, error: null };
    } catch (error) {
        return { data: null, error };
    }
};

// -----------------------------------------------------------------------------
// PROJECT DASHBOARD DATA
// -----------------------------------------------------------------------------
export const getProjectDashboard = async (
    projectId: string,
    userId: string
) => {
    try {
        const project = await databases.getDocument(DB_ID, COLLECTIONS.PROJECTS || 'projects', projectId);

        if (!project || project.user_id !== userId) {
            return { error: 'Project not found or access denied' };
        }

        const reposResponse = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('project_id', projectId)
        ]);

        const repos = reposResponse.documents;
        const totalRepos = repos.length;
        const totalVulns = repos.reduce(
            (acc, r: any) => acc + (r.vulnerability_count || 0),
            0
        );

        const avgRiskScore =
            totalRepos > 0
                ? repos.reduce((acc, r: any) => acc + (Number(r.risk_score) || 0), 0) /
                totalRepos
                : 0;

        return {
            data: {
                project,
                stats: {
                    totalRepos,
                    totalVulns,
                    avgRiskScore: Math.round(avgRiskScore * 100) / 100,
                },
                repositories: repos,
            },
        };
    } catch (error) {
        return { error };
    }
};

// -----------------------------------------------------------------------------
// IMPORT REPO + AUTO SCAN
// -----------------------------------------------------------------------------
export const importRepoToProject = async (
    projectId: string,
    userId: string,
    url: string
) => {
    try {
        // verify ownership
        const project = await databases.getDocument(DB_ID, COLLECTIONS.PROJECTS || 'projects', projectId);

        if (!project || project.user_id !== userId) {
            return { error: 'Project not found or access denied' };
        }

        // check if repo exists
        const existingRepos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('user_id', userId),
            Query.equal('url', url)
        ]);

        let repo;
        if (existingRepos.total > 0) {
            // update existing
            repo = await databases.updateDocument(DB_ID, COLLECTIONS.REPOSITORIES, existingRepos.documents[0].$id, {
                project_id: projectId,
                updated_at: new Date().toISOString()
            });
        } else {
            // create new
            repo = await databases.createDocument(DB_ID, COLLECTIONS.REPOSITORIES, ID.unique(), {
                user_id: userId,
                project_id: projectId,
                url,
                name: url.split('/').pop(),
                updated_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            });
        }

        // 🔥 AUTO TRIGGER SCAN
        try {
            await triggerScan(repo.$id);
        } catch (scanErr) {
            console.error('Auto scan failed:', scanErr);
        }

        return { data: repo, error: null };
    } catch (error) {
        return { error };
    }
};

// -----------------------------------------------------------------------------
// PROJECT SCAN HISTORY
// -----------------------------------------------------------------------------
export const getProjectScanHistory = async (
    projectId: string,
    userId: string
) => {
    try {
        const reposResponse = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
            Query.equal('project_id', projectId),
            Query.equal('user_id', userId)
        ]);

        const repos = reposResponse.documents;
        if (repos.length === 0) return { data: [] };

        const repoIds = repos.map((r) => r.$id);

        const scansResponse = await databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.orderDesc('$createdAt'),
            Query.limit(20)
        ]);

        // Enrich with repo name
        const repoNameMap = new Map(repos.map(r => [r.$id, r.name]));
        const scans = scansResponse.documents.map(s => ({
            ...s,
            repositories: { name: repoNameMap.get(s.repo_id) }
        }));

        return { data: scans, error: null };
    } catch (error) {
        return { data: null, error };
    }
};