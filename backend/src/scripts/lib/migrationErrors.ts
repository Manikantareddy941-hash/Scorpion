import { Databases, Query } from 'node-appwrite';

/**
 * Classifies an Appwrite provisioning error as benign or real.
 *
 * A plain 409 is the easy case. The awkward one: Appwrite validates the
 * collection's row-size budget BEFORE it checks whether the attribute already
 * exists, so re-creating an existing large string reports
 * "maximum number or size of attributes has been reached" rather than a
 * conflict. An idempotent migration then prints [ERR] on every re-run for a
 * no-op, and an operator learns to skim past exactly the line that will one day
 * matter.
 *
 * So a failure is resolved against reality: if the attribute is present
 * afterwards, the create was redundant.
 */
export function isConflict(raw: unknown): boolean {
  // Guard before the cast. This runs inside catch blocks, where the value is
  // whatever was thrown — and reading `.code` off null throws a TypeError from
  // the error handler itself, turning a benign re-run into a crash with a
  // stack that points here instead of at the migration that failed.
  if (typeof raw !== 'object' || raw === null) return false;
  const err = raw as { code?: number; type?: string };
  return err.code === 409 || Boolean(err.type?.includes('already_exists'));
}

/**
 * Read well past Appwrite's default page size.
 *
 * listAttributes returns 25 rows unless told otherwise, and several collections
 * here are already larger than that. Reading the default page made this helper
 * answer "no such attribute" for attributes that plainly exist — so an
 * idempotent migration reported [ERR] on a re-run instead of [=] skip, which is
 * exactly the signal this helper was written to suppress.
 */
const PAGE_LIMIT = 200;

export async function attributeExists(
  databases: Databases,
  dbId: string,
  collectionId: string,
  key: string,
): Promise<boolean> {
  let list: Awaited<ReturnType<Databases['listAttributes']>>;

  try {
    list = await databases.listAttributes(dbId, collectionId, [Query.limit(PAGE_LIMIT)]);
  } catch (err) {
    // An unreachable or unauthorised Appwrite tells us nothing about whether the
    // attribute is there. Returning false here — as an earlier version did —
    // reported absence with confidence on evidence that did not exist, which is
    // the failure this whole module is about. Throw, and let the caller decide.
    throw new Error(
      `could not list attributes on ${collectionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // A collection past the limit gives a partial view, and a partial view cannot
  // prove absence. This check sits OUTSIDE the try on purpose: it used to be
  // inside, where the bare catch swallowed its own throw and returned exactly the
  // confident false it was written to prevent.
  if (list.total > PAGE_LIMIT) {
    throw new Error(
      `collection ${collectionId} has ${list.total} attributes, beyond the ${PAGE_LIMIT} read here — ` +
      'absence cannot be proven from a partial view',
    );
  }

  return list.attributes.some((a) => (a as { key: string }).key === key);
}

/**
 * Returns 'skip' when the attribute is already there, 'error' when it genuinely
 * failed. Callers report accordingly.
 *
 * THROWS when it cannot tell — an unreachable Appwrite, or a collection too wide
 * to read in one page. That is a third outcome, and it is deliberately not folded
 * into 'error': a migration should stop and say why it could not verify, whereas
 * a genuine creation failure is something it can report and move past. Callers
 * that must not fail (the lazy path in tamperAuditLogger) catch it explicitly.
 */
export async function classifyAttributeFailure(
  databases: Databases,
  dbId: string,
  collectionId: string,
  key: string,
  raw: unknown,
): Promise<'skip' | 'error'> {
  if (isConflict(raw)) return 'skip';
  return (await attributeExists(databases, dbId, collectionId, key)) ? 'skip' : 'error';
}
