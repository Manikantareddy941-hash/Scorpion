/**
 * Read-only survey of the three collections still carrying broad grants.
 *
 * Answers the questions the per-document backfill depends on:
 *   - how many documents are actually in each
 *   - does each document carry an owner we can resolve (repo_id -> repository)
 *   - do any already have per-document permissions
 *
 * Changes nothing.
 */
const sdk = require('node-appwrite');
require('dotenv').config({ path: '.env' });

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const db = new sdk.Databases(client);
const DB = process.env.APPWRITE_DATABASE_ID;

(async () => {
  // Server key bypasses collection permissions — if this read fails, the
  // lockdown broke the API, not just the browser.
  const repos = await db.listDocuments(DB, 'repositories', [sdk.Query.limit(100)]);
  console.log(`API read after lockdown: repositories -> ${repos.total} docs (server key works)\n`);

  const ownerOf = new Map();
  for (const r of repos.documents) ownerOf.set(r.$id, r.team_id || r.user_id || null);

  for (const id of ['scans', 'vulnerabilities', 'findings']) {
    try {
      const res = await db.listDocuments(DB, id, [sdk.Query.limit(100)]);
      const withPerms = res.documents.filter((d) => (d.$permissions || []).length > 0).length;
      const withRepo = res.documents.filter((d) => d.repo_id).length;
      const resolvable = res.documents.filter((d) => d.repo_id && ownerOf.get(d.repo_id)).length;
      const orphaned = res.documents.filter((d) => d.repo_id && !ownerOf.has(d.repo_id)).length;

      console.log(`${id}: total=${res.total} (sampled ${res.documents.length})`);
      console.log(`   already have per-doc permissions: ${withPerms}`);
      console.log(`   carry repo_id:                    ${withRepo}`);
      console.log(`   owner resolvable via repository:  ${resolvable}`);
      console.log(`   repo_id points at a missing repo: ${orphaned}`);
      if (res.documents.length) {
        console.log(`   sample keys: ${Object.keys(res.documents[0]).filter((k) => !k.startsWith('$')).slice(0, 12).join(', ')}`);
      }
    } catch (e) {
      console.log(`${id}: read failed -> ${e.message}`);
    }
    console.log('');
  }
})();
