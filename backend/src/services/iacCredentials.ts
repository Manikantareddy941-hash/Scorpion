// backend/src/services/iacCredentials.ts
// Cloud credential profiles for the IaC engine. A profile is a named map of
// env vars (AWS_*, ARM_*, GOOGLE_CREDENTIALS, ...) — Terraform providers all
// authenticate via env, so one generic shape covers every cloud.
// Values are AES-256-GCM encrypted at rest (key from IAC_CRED_KEY), decrypted
// only at container launch, and never returned by the API or written to logs.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.IAC_DATA_DIR || path.join(process.cwd(), 'data', 'iac');
const CRED_DIR = () => path.join(DATA_DIR, 'credentials');

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'other';

export interface CredentialProfile {
    id: string;
    name: string;
    provider: CloudProvider;
    envKeys: string[]; // key names only — values live encrypted in the blob
    createdAt: string;
}

interface StoredProfile extends CredentialProfile {
    blob: string; // base64(iv | authTag | ciphertext) of the JSON env map
}

function masterKey(): Buffer {
    const secret = process.env.IAC_CRED_KEY;
    if (!secret) throw new Error('IAC_CRED_KEY_MISSING');
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

const profilePath = (id: string) => path.join(CRED_DIR(), `${id}.json`);

/** Strips the encrypted blob so API-facing objects can never leak it. */
function toPublic(stored: StoredProfile): CredentialProfile {
    return { id: stored.id, name: stored.name, provider: stored.provider, envKeys: stored.envKeys, createdAt: stored.createdAt };
}

export async function createProfile(name: string, provider: CloudProvider, env: Record<string, string>): Promise<CredentialProfile> {
    const stored: StoredProfile = {
        id: crypto.randomUUID(),
        name,
        provider,
        envKeys: Object.keys(env),
        createdAt: new Date().toISOString(),
        blob: encrypt(JSON.stringify(env)),
    };
    await fs.mkdir(CRED_DIR(), { recursive: true });
    await fs.writeFile(profilePath(stored.id), JSON.stringify(stored, null, 2));
    return toPublic(stored);
}

export async function listProfiles(): Promise<CredentialProfile[]> {
    let files: string[] = [];
    try {
        files = await fs.readdir(CRED_DIR());
    } catch {
        return []; // no profiles created yet
    }
    const profiles: CredentialProfile[] = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
            profiles.push(toPublic(JSON.parse(await fs.readFile(path.join(CRED_DIR(), f), 'utf8')) as StoredProfile));
        } catch { /* skip corrupt file */ }
    }
    return profiles;
}

/** Decrypts a profile into KEY=value pairs for container Env. Call only at container launch. */
export async function getProfileEnv(id: string): Promise<string[]> {
    let stored: StoredProfile;
    try {
        stored = JSON.parse(await fs.readFile(profilePath(id), 'utf8'));
    } catch {
        throw new Error('PROFILE_NOT_FOUND');
    }
    const env = JSON.parse(decrypt(stored.blob)) as Record<string, string>;
    return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

export async function deleteProfile(id: string): Promise<void> {
    try {
        await fs.unlink(profilePath(id));
    } catch {
        throw new Error('PROFILE_NOT_FOUND');
    }
}
