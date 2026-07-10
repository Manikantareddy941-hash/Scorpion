export interface StatusBucket { key: string; total: number; denied: number; minute: number; }
export interface AnomalyThresholds { minDenied: number; minShare: number; }
export interface StatusSpike { key: string; denied: number; total: number; minute: number; }

export function detectStatusSpike(buckets: StatusBucket[], t: AnomalyThresholds): StatusSpike[] {
  return buckets
    .filter(b => b.total > 0 && b.denied >= t.minDenied && b.denied / b.total >= t.minShare)
    .map(b => ({ key: b.key, denied: b.denied, total: b.total, minute: b.minute }));
}
