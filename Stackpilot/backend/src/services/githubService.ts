import axios from 'axios';

const GITHUB_API_URL = 'https://api.github.com';

export const getRepoMetadata = async (repoUrl: string) => {
    // Extract owner/repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;

    const [, owner, repo] = match;

    try {
        const headers: any = {};
        if (process.env.GITHUB_TOKEN) {
            headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
        }

        const { data } = await axios.get(`${GITHUB_API_URL}/repos/${owner}/${repo}`, { headers });
        return {
            name: data.full_name,
            stars: data.stargazers_count,
            description: data.description,
            last_pushed: data.pushed_at,
        };
    } catch (error) {
        console.error(`[GitHub Service] Failed to fetch metadata for ${repoUrl}`, error);
        return null;
    }
};
