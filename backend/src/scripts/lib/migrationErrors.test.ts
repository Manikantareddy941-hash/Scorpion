import { Databases } from 'node-appwrite';
import { isConflict, attributeExists, classifyAttributeFailure } from './migrationErrors';

/**
 * The behaviour under test is what this module does when it CANNOT answer.
 *
 * An earlier version wrapped the whole lookup in `try { ... } catch { return false }`,
 * including its own "collection too wide to read" throw — so both an unreachable
 * Appwrite and a partial view came back as a confident "the attribute is absent".
 * Callers then treated a failed lookup as a failed creation. These tests exist to
 * keep that shape from coming back.
 */

const DB = 'db';
const COLLECTION = 'audit_logs_v2';

/** Minimal stand-in — only listAttributes is ever reached from here. */
const fakeDatabases = (impl: jest.Mock) => ({ listAttributes: impl }) as unknown as Databases;

const attrs = (keys: string[], total = keys.length) => ({
    total,
    attributes: keys.map((key) => ({ key })),
});

describe('attributeExists', () => {
    it('finds an attribute that is present', async () => {
        const list = jest.fn().mockResolvedValue(attrs(['actor', 'sequence', 'tamper_hash']));

        await expect(attributeExists(fakeDatabases(list), DB, COLLECTION, 'sequence')).resolves.toBe(true);
    });

    it('reports absence when the collection genuinely lacks it', async () => {
        const list = jest.fn().mockResolvedValue(attrs(['actor', 'tamper_hash']));

        await expect(attributeExists(fakeDatabases(list), DB, COLLECTION, 'sequence')).resolves.toBe(false);
    });

    it('throws rather than claiming absence when the lookup itself fails', async () => {
        // An unreachable or unauthorised Appwrite is evidence of nothing. Returning
        // false here would let a caller conclude "not created" from a failed read.
        const list = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND appwrite'));

        await expect(attributeExists(fakeDatabases(list), DB, COLLECTION, 'sequence'))
            .rejects.toThrow(/could not list attributes on audit_logs_v2.*ENOTFOUND/);
    });

    it('throws when the collection is too wide to read in one page', async () => {
        // The regression: this check used to live inside the try, so its own throw
        // was caught two lines below and became `return false`.
        const list = jest.fn().mockResolvedValue(attrs(['actor'], 500));

        await expect(attributeExists(fakeDatabases(list), DB, COLLECTION, 'sequence'))
            .rejects.toThrow(/beyond the 200 read here/);
    });

    it('reads past the default page size', async () => {
        // listAttributes returns 25 rows unless told otherwise, and collections here
        // are already larger than that.
        const list = jest.fn().mockResolvedValue(attrs(['sequence']));

        await attributeExists(fakeDatabases(list), DB, COLLECTION, 'sequence');

        const queries = list.mock.calls[0][2] as unknown[];
        expect(JSON.stringify(queries)).toContain('200');
    });
});

describe('isConflict', () => {
    it('recognises a 409', () => {
        expect(isConflict({ code: 409 })).toBe(true);
    });

    it('recognises the type when no code is present', () => {
        expect(isConflict({ type: 'attribute_already_exists' })).toBe(true);
    });

    it('does not treat an unrelated failure as a conflict', () => {
        expect(isConflict({ code: 500, type: 'general_unknown' })).toBe(false);
    });
});

describe('classifyAttributeFailure', () => {
    it('skips a plain conflict without querying at all', async () => {
        const list = jest.fn();

        await expect(classifyAttributeFailure(fakeDatabases(list), DB, COLLECTION, 'sequence', { code: 409 }))
            .resolves.toBe('skip');
        expect(list).not.toHaveBeenCalled();
    });

    it('skips when the attribute turns out to exist despite an unrecognised error', async () => {
        // The row-size-budget case: Appwrite validates the collection budget BEFORE
        // checking for a duplicate, so a redundant create reports "maximum number or
        // size of attributes has been reached" rather than a conflict.
        const list = jest.fn().mockResolvedValue(attrs(['sequence']));

        await expect(classifyAttributeFailure(
            fakeDatabases(list), DB, COLLECTION, 'sequence',
            { code: 400, message: 'maximum number or size of attributes has been reached' },
        )).resolves.toBe('skip');
    });

    it('reports error when the attribute really is absent', async () => {
        const list = jest.fn().mockResolvedValue(attrs(['actor']));

        await expect(classifyAttributeFailure(
            fakeDatabases(list), DB, COLLECTION, 'sequence', { code: 400, message: 'nope' },
        )).resolves.toBe('error');
    });

    it('propagates the throw when it cannot verify, rather than guessing error', async () => {
        // 'error' means "the create failed". "I could not check" is a different
        // statement, and collapsing the two would report a failure that was never
        // observed.
        const list = jest.fn().mockRejectedValue(new Error('503 service unavailable'));

        await expect(classifyAttributeFailure(
            fakeDatabases(list), DB, COLLECTION, 'sequence', { code: 400, message: 'nope' },
        )).rejects.toThrow(/could not list attributes/);
    });
});
