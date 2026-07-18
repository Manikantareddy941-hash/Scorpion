// NOTE: `getFindings` below has no callers, and the endpoint it targets
// (/api/repos/:id/findings) does not exist in the backend — repoRoutes has no
// such route. Left in place rather than removed; use `/api/issues?repoId=` for
// findings scoped to one repository.
export const getFindings = async (repoId: string, token: string) => {
  const res = await fetch(`/api/repos/${repoId}/findings`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};

/**
 * Finding status writes.
 *
 * These were `databases.updateDocument` calls straight from the browser. A read
 * leak shows one tenant another's data; these let a browser mark someone else's
 * findings resolved, dismissed or false-positive — the only boundary being
 * whatever the Appwrite collection permissions happened to be.
 *
 * The backend resolves the finding's repository and checks access before it
 * writes, and rejects any status outside the allowlist.
 */

type GetJWT = () => Promise<string | null>;

export type FindingStatus =
  | 'open'
  | 'resolved'
  | 'remediated'
  | 'dismissed'
  | 'false_positive'
  | 'snoozed';

export async function setFindingStatus(
  getJWT: GetJWT,
  findingId: string,
  status: FindingStatus,
  options: { snoozeUntil?: string } = {},
): Promise<void> {
  const token = await getJWT();
  const res = await fetch(`/api/findings/${encodeURIComponent(findingId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, ...options }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to update finding (${res.status})`);
  }
}

/**
 * Applies a status to several findings, reporting which ones failed.
 *
 * Deliberately not Promise.all: that rejects on the first failure and leaves
 * the caller unable to say which writes landed. On a bulk resolve that means
 * either a success toast for a partially applied change, or an error toast
 * hiding the ones that did succeed.
 */
export async function setFindingStatuses(
  getJWT: GetJWT,
  findingIds: string[],
  status: FindingStatus,
  options: { snoozeUntil?: string } = {},
): Promise<{ succeeded: number; failed: string[] }> {
  const results = await Promise.allSettled(
    findingIds.map((id) => setFindingStatus(getJWT, id, status, options)),
  );
  const failed = findingIds.filter((_, i) => results[i].status === 'rejected');
  return { succeeded: findingIds.length - failed.length, failed };
}
