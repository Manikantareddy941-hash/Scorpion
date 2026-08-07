import fs from 'fs/promises';
import path from 'path';
import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { logger, errorContext } from '../services/logger';
import type { ComplianceViolation } from '../services/securityRequirementsService';

/**
 * Audit ledger of every compliance-gate evaluation (pass and block alike). The
 * passing record is the proof-of-enforcement an auditor needs — "the gate ran
 * and passed on commit X" — so this stores all runs, not only failures. The UI
 * filters to blocked when it wants the actionable subset.
 */

const COLLECTION = 'plan_gate_runs';
const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'gate_runs_mock_db.json');

export interface GateRun {
  $id?: string;
  repoId: string;
  // Where the gate fired: a CI pipeline call or the deploy path. Defaults to
  // 'ci' for records written before this field existed.
  source?: 'ci' | 'deploy';
  // Deploy-source context.
  environment?: string;
  actor?: string;
  commitSha?: string;
  branch?: string;
  // 'overridden' = a break-glass deploy that shipped despite violations — the
  // single most important event to keep visible.
  status: 'passed' | 'blocked' | 'overridden';
  violations: ComplianceViolation[];
  createdAt: string;
}

interface MockDb { runs: GateRun[] }

async function readMockDb(): Promise<MockDb> {
  try {
    const parsed = JSON.parse(await fs.readFile(MOCK_DB_PATH, 'utf-8'));
    return { runs: parsed.runs ?? [] };
  } catch {
    await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
    await fs.writeFile(MOCK_DB_PATH, JSON.stringify({ runs: [] }, null, 2), 'utf-8');
    return { runs: [] };
  }
}

async function writeMockDb(db: MockDb): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

async function handleQuery<T>(appwriteCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
  try {
    return await appwriteCall();
  } catch (err) {
    logger.warn('[GateRunRepository] Appwrite operation failed, using local JSON fallback', errorContext(err));
    return await mockCall();
  }
}

// violations is stored as a JSON string — a gate run can carry many, and Appwrite
// has no nested-object attribute. Parsed back on read.
function parseViolations(raw: unknown): ComplianceViolation[] {
  if (Array.isArray(raw)) return raw as ComplianceViolation[];
  if (typeof raw !== 'string') return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function fromDoc(doc: Record<string, unknown>): GateRun {
  return {
    $id: doc.$id as string,
    repoId: doc.repoId as string,
    source: (doc.source as GateRun['source']) || 'ci',
    environment: (doc.environment as string) || undefined,
    actor: (doc.actor as string) || undefined,
    commitSha: (doc.commitSha as string) || undefined,
    branch: (doc.branch as string) || undefined,
    status: doc.status as GateRun['status'],
    violations: parseViolations(doc.violations),
    createdAt: doc.createdAt as string,
  };
}

export const gateRunRepository = {
  async record(run: GateRun): Promise<void> {
    const payload = {
      repoId: run.repoId,
      source: run.source ?? 'ci',
      environment: run.environment ?? '',
      actor: run.actor ?? '',
      commitSha: run.commitSha ?? '',
      branch: run.branch ?? '',
      status: run.status,
      violations: JSON.stringify(run.violations),
      createdAt: run.createdAt,
    };
    await handleQuery(
      async () => { await databases.createDocument(DB_ID, COLLECTION, ID.unique(), payload); },
      async () => {
        const db = await readMockDb();
        db.runs.push({ $id: `run-${db.runs.length}`, ...run });
        await writeMockDb(db);
      },
    );
  },

  async listByRepos(repoIds: string[]): Promise<GateRun[]> {
    if (repoIds.length === 0) return [];
    return handleQuery(
      async () => {
        const res = await databases.listDocuments(DB_ID, COLLECTION, [
          Query.equal('repoId', repoIds),
          Query.orderDesc('createdAt'),
          Query.limit(100),
        ]);
        return res.documents.map((d) => fromDoc(d as unknown as Record<string, unknown>));
      },
      async () => {
        const db = await readMockDb();
        return db.runs
          .filter((r) => repoIds.includes(r.repoId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
    );
  },
};
