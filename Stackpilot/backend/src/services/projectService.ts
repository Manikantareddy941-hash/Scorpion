import { databases, COLLECTIONS, DB_ID, ID, Query } from '../lib/appwrite';

export const createProject = async (userId: string, name: string, description?: string) => {
    try {
        const data = await databases.createDocument(
            DB_ID,
            COLLECTIONS.PROJECTS,
            ID.unique(),
            {
                user_id: userId,
                name,
                description,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        );
        return { data, error: null };
    } catch (error: any) {
        return { data: null, error };
    }
};

export const getProjects = async (userId: string) => {
    try {
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.PROJECTS,
            [Query.equal('user_id', userId), Query.orderDesc('created_at')]
        );
        return { data: response.documents, error: null };
    } catch (error: any) {
        return { data: null, error };
    }
};

export const getProjectDashboard = async (projectId: string, userId: string) => {
    try {
        // 1. Verify project ownership and get project details
        const project = await databases.getDocument(DB_ID, COLLECTIONS.PROJECTS, projectId);

        if (project.user_id !== userId) {
            return { error: 'Project not found or access denied' };
        }

        // 2. Get repositories for this project
        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('project_id', projectId)]
        );
        const repos = reposRes.documents;

        // 3. Aggregate stats
        const totalRepos = repos.length;
        const totalVulns = repos.reduce((acc: number, r: any) => acc + (r.vulnerability_count || 0), 0);
        const avgRiskScore = totalRepos > 0
            ? repos.reduce((acc: number, r: any) => acc + (Number(r.risk_score) || 0), 0) / totalRepos
            : 0;

        return {
            data: {
                project,
                stats: {
                    totalRepos,
                    totalVulns,
                    avgRiskScore: Math.round(avgRiskScore * 100) / 100
                },
                repositories: repos
            }
        };
    } catch (error: any) {
        return { error: error.message || 'Failed to fetch project dashboard' };
    }
};

export const importRepoToProject = async (projectId: string, userId: string, url: string) => {
    try {
        // 1. Double check project ownership
        const project = await databases.getDocument(DB_ID, COLLECTIONS.PROJECTS, projectId);
        if (project.user_id !== userId) return { error: 'Project not found or access denied' };

        // 2. Upsert repository and link to project
        const existing = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('user_id', userId), Query.equal('url', url)]
        );

        let data;
        const payload = {
            user_id: userId,
            project_id: projectId,
            url,
            name: url.split('/').pop(),
            updated_at: new Date().toISOString()
        };

        if (existing.total > 0) {
            data = await databases.updateDocument(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                existing.documents[0].$id,
                payload
            );
        } else {
            data = await databases.createDocument(
                DB_ID,
                COLLECTIONS.REPOSITORIES,
                ID.unique(),
                payload
            );
        }

        return { data, error: null };
    } catch (error: any) {
        return { data: null, error };
    }
};

export const getProjectScanHistory = async (projectId: string, userId: string) => {
    try {
        const reposRes = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.REPOSITORIES,
            [Query.equal('project_id', projectId), Query.equal('user_id', userId)]
        );
        const repos = reposRes.documents;

        if (!repos || repos.length === 0) return { data: [] };

        const repoIds = repos.map((r: any) => r.$id);

        // Appwrite Query.in supports limited number of values. 
        // For project scan history, we might need a better way if repoCount is high.
        const response = await databases.listDocuments(
            DB_ID,
            COLLECTIONS.SCANS,
            [Query.equal('repo_id', repoIds), Query.orderDesc('created_at'), Query.limit(20)]
        );

        return { data: response.documents, error: null };
    } catch (error: any) {
        return { data: null, error };
    }
};
