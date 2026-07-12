import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iac-creds-'));
process.env.IAC_DATA_DIR = DATA_DIR;
process.env.IAC_CRED_KEY = 'test-master-key';

// require (not import) so the env vars above are set before the module reads them
// eslint-disable-next-line @typescript-eslint/no-require-imports
const creds = require('./iacCredentials') as typeof import('./iacCredentials');

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

describe('credential profiles', () => {
    it('stores encrypted and decrypts back to the same env vars', async () => {
        const profile = await creds.createProfile('prod-aws', 'aws', {
            AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
            AWS_SECRET_ACCESS_KEY: 's3cr3t/value+x',
        });

        const env = await creds.getProfileEnv(profile.id);
        expect(env).toContain('AWS_ACCESS_KEY_ID=AKIAEXAMPLE');
        expect(env).toContain('AWS_SECRET_ACCESS_KEY=s3cr3t/value+x');

        // secrets never on disk in plaintext
        const raw = fs.readFileSync(path.join(DATA_DIR, 'credentials', `${profile.id}.json`), 'utf8');
        expect(raw).not.toContain('AKIAEXAMPLE');
        expect(raw).not.toContain('s3cr3t');
    });

    it('lists profiles with env keys only, never values', async () => {
        const list = await creds.listProfiles();
        const prod = list.find(p => p.name === 'prod-aws');
        expect(prod).toBeDefined();
        expect(prod!.envKeys).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
        expect(JSON.stringify(list)).not.toContain('AKIAEXAMPLE');
    });

    it('deletes a profile and getProfileEnv then throws', async () => {
        const p = await creds.createProfile('temp', 'gcp', { GOOGLE_CREDENTIALS: '{"k":"v"}' });
        await creds.deleteProfile(p.id);
        await expect(creds.getProfileEnv(p.id)).rejects.toThrow('PROFILE_NOT_FOUND');
    });

    it('refuses to operate without IAC_CRED_KEY', async () => {
        const saved = process.env.IAC_CRED_KEY;
        delete process.env.IAC_CRED_KEY;
        try {
            await expect(creds.createProfile('x', 'aws', { A: 'b' })).rejects.toThrow('IAC_CRED_KEY_MISSING');
        } finally {
            process.env.IAC_CRED_KEY = saved;
        }
    });
});
