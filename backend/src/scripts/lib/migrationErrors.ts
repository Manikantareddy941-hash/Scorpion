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
  try {
    const list = await databases.listAttributes(dbId, collectionId, [Query.limit(PAGE_LIMIT)]);
    // A collection past the limit would give a partial view, and a partial view
    // cannot prove absence. Say so rather than reporting a confident false.
    if (list.total > PAGE_LIMIT) {
      throw new Error(`collection ${collectionId} has ${list.total} attributes, beyond the ${PAGE_LIMIT} read here`);
    }
    return list.attributes.some((a) => (a as { key: string }).key === key);
  } catch {
    return false;
  }
}

/**
 * Returns 'skip' when the attribute is already there, 'error' when it genuinely
 * failed. Callers report accordingly.
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
