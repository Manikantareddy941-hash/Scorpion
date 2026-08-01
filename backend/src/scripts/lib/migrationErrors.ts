import { Databases } from 'node-appwrite';

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

export async function attributeExists(
  databases: Databases,
  dbId: string,
  collectionId: string,
  key: string,
): Promise<boolean> {
  try {
    const list = await databases.listAttributes(dbId, collectionId);
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
