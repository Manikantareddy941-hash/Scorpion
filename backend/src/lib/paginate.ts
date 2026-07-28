import { Models } from 'node-appwrite';
import { databases, DB_ID, Query } from './appwrite';
import { logger } from '../services/logger';

/**
 * Result of an exhaustive read.
 *
 * `truncated` exists because the alternative is what this helper was written to
 * remove: a capped read whose caller cannot tell a complete answer from a
 * partial one. Three separate places in this codebase computed a summary over a
 * silently truncated set and presented it as the whole picture — the compliance
 * evaluation, the feedback metrics, and the collection-permission audit, which
 * read 25 of 66 collections and reported "no collection is open to all
 * sessions" while every open one sat in the unread remainder.
 */
export interface PageResult<T> {
  items: T[];
  /** What the backend says exists, which is not always what was fetched. */
  total: number;
  /** True when the safety cap stopped the read before it finished. */
  truncated: boolean;
}

const PAGE_SIZE = 100;

/** Ceiling on a single exhaustive read, so a runaway data set cannot hang a request. */
const DEFAULT_MAX_ITEMS = 5000;

/**
 * Reads every document matching `queries`, paging until the set is exhausted.
 *
 * Use this for anything that AGGREGATES — compliance verdicts, metrics, audits —
 * where a missing row changes the answer rather than merely shortening a list.
 * A plain `Query.limit(n)` is still right for genuine UI pagination and for
 * existence checks; the danger is only in summarising a subset as if complete.
 *
 * Caller filters are re-applied to every page: dropping them after page one
 * would widen the read past the caller's scope.
 */
export async function fetchAllDocuments(
  collectionId: string,
  queries: string[] = [],
  opts: { maxItems?: number } = {},
): Promise<PageResult<Models.Document>> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
  const items: Models.Document[] = [];
  let total = 0;

  for (;;) {
    const page = await databases.listDocuments(DB_ID, collectionId, [
      ...queries,
      Query.limit(PAGE_SIZE),
      Query.offset(items.length),
    ]);
    total = page.total;
    items.push(...page.documents);

    // A short page means the backend has no more to give, whatever `total`
    // claims — trusting total alone would spin forever against a stale count.
    if (page.documents.length < PAGE_SIZE) break;
    if (items.length >= total) break;

    if (items.length >= maxItems) {
      logger.warn('[paginate] read hit the safety cap — result is incomplete', {
        event: 'read_truncated', collectionId, fetched: items.length, total, maxItems,
      });
      return { items: items.slice(0, maxItems), total, truncated: true };
    }
  }

  return { items, total, truncated: false };
}
