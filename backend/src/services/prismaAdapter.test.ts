import { adapterKindFor } from './prismaAdapter';

describe('adapterKindFor', () => {
    it('selects sqlite for file: URLs', () => {
        expect(adapterKindFor('file:./dev.db')).toBe('sqlite');
    });

    it('selects postgres for postgres:// and postgresql:// URLs', () => {
        expect(adapterKindFor('postgres://user:pw@host:5432/db')).toBe('postgres');
        expect(adapterKindFor('postgresql://user:pw@host:5432/db')).toBe('postgres');
    });

    it('throws when DATABASE_URL is unset', () => {
        expect(() => adapterKindFor(undefined)).toThrow('DATABASE_URL not configured');
    });

    it('throws on an unsupported scheme', () => {
        expect(() => adapterKindFor('mysql://host/db')).toThrow('Unsupported DATABASE_URL scheme');
    });
});
