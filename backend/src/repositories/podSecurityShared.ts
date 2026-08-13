import fs from 'fs/promises';
import path from 'path';
import { PodSecurityConfig } from '../services/podSecurityService';

/**
 * Storage-agnostic half of the pod-security config repository: the local JSON
 * fallback buffer and its lock.
 *
 * Extracted so the Postgres implementation can degrade the same way the Appwrite
 * one does. Both previously lived in podSecurityRepository.ts, which already
 * imports podSecurityPgRepository to build the facade — so having the adapter
 * import them back would have added a circular dependency, the exact shape the
 * madge gate in ci.yml counts. Same split, and same reason, as driftShared.ts.
 *
 * The buffer file is shared between backends by design: it is per-process
 * (process.cwd()/scratch) and only one backend is ever selected at a time, so a
 * config buffered under Appwrite is still replayable if the deployment later
 * switches to Postgres.
 */

const MOCK_DB_PATH = path.join(process.cwd(), 'scratch', 'pod_security_mock_db.json');

export async function readMock(): Promise<Record<string, PodSecurityConfig>> {
  try {
    const data = await fs.readFile(MOCK_DB_PATH, 'utf-8');
    return JSON.parse(data) as Record<string, PodSecurityConfig>;
  } catch {
    return {};
  }
}

export async function writeMock(db: Record<string, PodSecurityConfig>): Promise<void> {
  await fs.mkdir(path.dirname(MOCK_DB_PATH), { recursive: true });
  await fs.writeFile(MOCK_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// In-process mutex serializing read-modify-write on the fallback file — same
// rationale as gateRulesRepository (per-process file, no distributed lock).
let fileLock: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileLock.then(fn, fn);
  fileLock = run.catch(() => undefined);
  return run;
}

/** Buffer one config under the lock, for replay once storage recovers. */
export async function bufferConfig(userId: string, config: PodSecurityConfig): Promise<void> {
  await withLock(async () => {
    const db = await readMock();
    db[userId] = config;
    await writeMock(db);
  });
}

/** Read one buffered config, or undefined when nothing is buffered for the user. */
export async function readBufferedConfig(userId: string): Promise<PodSecurityConfig | undefined> {
  const db = await readMock();
  return db[userId];
}

/**
 * Drain the buffer through `persist`, keeping entries that still fail. Never
 * throws — a still-unreachable backend just yields 0. Returns the count flushed.
 */
export async function flushBuffer(
  persist: (userId: string, config: PodSecurityConfig) => Promise<void>,
): Promise<number> {
  return withLock(async () => {
    const pending = await readMock();
    const userIds = Object.keys(pending);
    if (userIds.length === 0) return 0;
    let flushed = 0;
    for (const userId of userIds) {
      try {
        await persist(userId, pending[userId]);
        delete pending[userId];
        flushed++;
      } catch {
        // Backend still unreachable — keep for the next tick.
      }
    }
    if (flushed > 0) await writeMock(pending);
    return flushed;
  });
}
