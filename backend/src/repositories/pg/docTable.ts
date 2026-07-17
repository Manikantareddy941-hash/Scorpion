import { randomUUID } from 'crypto';

/**
 * Appwrite-document-shaped row: callers today consume { $id, $createdAt, ...fields }.
 * $createdAt is surfaced from the table's created_at column so consumers that
 * read Appwrite's system timestamp (e.g. scan.$createdAt) keep working.
 */
export type DocRow = { $id: string; $createdAt: string } & Record<string, unknown>;

export function toDoc(row: { id: string; data: Record<string, unknown>; created_at?: string | Date }): DocRow {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at ?? new Date(0).toISOString();
  return { $id: row.id, $createdAt: createdAt, ...row.data };
}

export function newId(): string {
  return randomUUID();
}
