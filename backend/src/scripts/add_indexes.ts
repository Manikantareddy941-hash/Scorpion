// backend/src/scripts/add_indexes.ts
// One-time migration: adds Appwrite indexes for attributes that are hit by
// Query.equal/orderDesc/orderAsc across the codebase but have no index
// (Appwrite does NOT auto-index non-unique attributes — every Query.equal
// against an un-indexed attribute is a full collection scan).
// Run: npx ts-node backend/src/scripts/add_indexes.ts
import { Client, Databases, DatabasesIndexType, OrderBy } from 'node-appwrite';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || '')
  .setProject(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'default';

interface IndexSpec {
  collection: string;
  key: string;
  type: DatabasesIndexType;
  attributes: string[];
  orders?: OrderBy[];
}

// Single-attribute indexes for the most-filtered field per collection
// (foreign-key-equivalent lookups: repo_id/user_id/team_id/scanId/etc), plus
// composite indexes for the filter+sort pairs actually used in services
// (e.g. "scans for a repo, newest first").
const INDEXES: IndexSpec[] = [
  { collection: 'scans', key: 'idx_repo_status', type: DatabasesIndexType.Key, attributes: ['repo_id', 'status'] },
  { collection: 'scans', key: 'idx_repo_started', type: DatabasesIndexType.Key, attributes: ['repo_id', 'startedAt'], orders: [OrderBy.Asc, OrderBy.Desc] },
  { collection: 'scans', key: 'idx_user_id', type: DatabasesIndexType.Key, attributes: ['user_id'] },

  { collection: 'repositories', key: 'idx_user_id', type: DatabasesIndexType.Key, attributes: ['user_id'] },
  { collection: 'repositories', key: 'idx_status', type: DatabasesIndexType.Key, attributes: ['status'] },
  { collection: 'repositories', key: 'idx_updated_at', type: DatabasesIndexType.Key, attributes: ['updated_at'], orders: [OrderBy.Desc] },

  { collection: 'vulnerabilities', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repo_id'] },
  { collection: 'vulnerabilities', key: 'idx_scan_id', type: DatabasesIndexType.Key, attributes: ['scanId'] },
  { collection: 'vulnerabilities', key: 'idx_severity', type: DatabasesIndexType.Key, attributes: ['severity'] },

  { collection: 'team_members', key: 'idx_team_user', type: DatabasesIndexType.Key, attributes: ['team_id', 'user_id'] },
  { collection: 'project_access', key: 'idx_repo_team', type: DatabasesIndexType.Key, attributes: ['repo_id', 'team_id'] },

  { collection: 'notifications', key: 'idx_user_id', type: DatabasesIndexType.Key, attributes: ['user_id'] },
  { collection: 'notifications', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repo_id'] },

  { collection: 'audit_logs', key: 'idx_actor_timestamp', type: DatabasesIndexType.Key, attributes: ['actor', 'timestamp'], orders: [OrderBy.Asc, OrderBy.Desc] },

  { collection: 'build_pipelines', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repoId'] },
  { collection: 'deployments', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repoId'] },
  { collection: 'deployments', key: 'idx_build_id', type: DatabasesIndexType.Key, attributes: ['buildId'] },

  { collection: 'threats', key: 'idx_owner_status', type: DatabasesIndexType.Key, attributes: ['ownerUserId', 'status'] },
  { collection: 'project_policies', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repo_id'] },
  { collection: 'policy_evaluations', key: 'idx_repo_id', type: DatabasesIndexType.Key, attributes: ['repo_id'] },
  { collection: 'incidents', key: 'idx_user_status', type: DatabasesIndexType.Key, attributes: ['user_id', 'status'] },
];

async function run() {
  for (const idx of INDEXES) {
    try {
      await databases.createIndex(DATABASE_ID, idx.collection, idx.key, idx.type, idx.attributes, idx.orders);
      console.log(`created: ${idx.collection}.${idx.key} (${idx.attributes.join(',')})`);
    } catch (err: any) {
      // 409 = index already exists, 404 = collection/attribute not provisioned yet — skip, don't crash the batch
      if (err.code === 409) {
        console.log(`skip (exists): ${idx.collection}.${idx.key}`);
      } else {
        console.error(`failed: ${idx.collection}.${idx.key} — ${err.message}`);
      }
    }
  }
}

run();
