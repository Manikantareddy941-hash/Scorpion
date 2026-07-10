import type { StatusBucket } from './anomalyDetector';

const MINUTE = 60_000;
const MAX_KEYS = 500;
type Cell = { total: number; denied: number };
const store = new Map<number, Map<string, Cell>>(); // minute → key → cell

function minuteOf(ts: number): number { return Math.floor(ts / MINUTE); }

export const statusTelemetry = {
  record(key: string, status: number): void {
    const m = minuteOf(Date.now());
    let byKey = store.get(m);
    if (!byKey) { byKey = new Map(); store.set(m, byKey); }
    if (!byKey.has(key) && byKey.size >= MAX_KEYS) return; // bounded
    const cell = byKey.get(key) ?? { total: 0, denied: 0 };
    cell.total += 1;
    if (status === 401 || status === 403) cell.denied += 1;
    byKey.set(key, cell);
  },
  snapshot(): StatusBucket[] {
    const out: StatusBucket[] = [];
    for (const [minute, byKey] of store) {
      for (const [key, cell] of byKey) out.push({ key, total: cell.total, denied: cell.denied, minute });
    }
    return out;
  },
  prune(now: number): void {
    const cutoff = minuteOf(now) - 5;
    for (const m of store.keys()) if (m < cutoff) store.delete(m);
  },
  reset(): void { store.clear(); },
};
