import { Models } from 'node-appwrite';
import { Octokit } from 'octokit';
import { databases, DB_ID, Query, COLLECTIONS } from '../lib/appwrite';
import { FindingDocument, RepoDocument, ScanDocument } from '../types/dashboard.types';

export const dashboardRepository = {
  async getUserTeamIds(userId: string): Promise<string[]> {
    const teamMemberships = await databases.listDocuments(DB_ID, COLLECTIONS.TEAM_MEMBERS, [
      Query.equal('user_id', userId)
    ]);
    return teamMemberships.documents.map(m => m.team_id);
  },

  async listUserRepos(userId: string, teamIds: string[] = []): Promise<Models.DocumentList<RepoDocument>> {
    return databases.listDocuments(DB_ID, 'repositories', teamIds.length > 0 ? [
      Query.or([
        Query.equal('user_id', userId),
        Query.equal('team_id', teamIds)
      ])
    ] : [
      Query.equal('user_id', userId)
    ]);
  },

  async listScansForRepos(repoIds: string[], repoUrls: string[]): Promise<Models.DocumentList<ScanDocument>> {
    return databases.listDocuments(DB_ID, 'scans', [
      Query.or([
        Query.equal('repo_id', repoIds),
        Query.equal('repoUrl', repoUrls)
      ]),
      Query.orderDesc('$createdAt'),
      Query.limit(50)
    ]);
  },

  async listFindingsForReposOrScans(repoIds: string[], scanIds: string[]): Promise<Models.DocumentList<FindingDocument>> {
    return databases.listDocuments(DB_ID, 'findings', [
      Query.or([
        Query.equal('repo_id', repoIds),
        Query.equal('scanId', scanIds)
      ]),
      Query.limit(5000)
    ]);
  },

  async listOpenFindingsForRepos(repoIds: string[]): Promise<Models.DocumentList<FindingDocument>> {
    return databases.listDocuments(DB_ID, 'findings', [
      Query.equal('repo_id', repoIds),
      Query.equal('status', 'open'),
      Query.limit(5000)
    ]);
  },

  async listFindingsForReposScoped(repoIds: string[]): Promise<Models.DocumentList<FindingDocument>> {
    return databases.listDocuments(DB_ID, COLLECTIONS.FINDINGS, [
      Query.equal('repo_id', repoIds),
      Query.limit(5000)
    ]);
  },

  async getFinding(taskId: string): Promise<FindingDocument> {
    return databases.getDocument(DB_ID, COLLECTIONS.FINDINGS, taskId);
  },

  async getRepository(repoId: string): Promise<RepoDocument | null> {
    return databases.getDocument<RepoDocument>(DB_ID, 'repositories', repoId).catch(() => null);
  },

  async setFindingGithubIssueUrl(taskId: string, url: string): Promise<void> {
    await databases.updateDocument(DB_ID, COLLECTIONS.FINDINGS, taskId, { github_issue_url: url });
  },

  async generateAiText(prompt: string): Promise<string | undefined> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'mock-key') {
      return undefined;
    }

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await geminiResponse.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  },

  async createGithubIssue(owner: string, repo: string, title: string, body: string): Promise<string> {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN not configured');
    }
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const issue = await octokit.rest.issues.create({ owner, repo, title, body });
    return issue.data.html_url;
  }
};
