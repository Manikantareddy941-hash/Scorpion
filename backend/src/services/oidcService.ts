import * as oidc from 'openid-client';
import { users, ID, Query } from '../lib/appwrite';

/**
 * Generic OIDC SSO against any customer IdP (Okta, Auth0, Entra ID, Keycloak,
 * ...) via the Appwrite custom-token bridge: we run the standards-compliant
 * code+PKCE flow here, then mint an Appwrite user token so the frontend ends
 * up with a normal Appwrite session — verifyUser and the rest of the auth
 * stack stay untouched.
 */

export const isSsoConfigured = (): boolean =>
    !!(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);

let cachedConfig: oidc.Configuration | null = null;

async function getOidcConfig(): Promise<oidc.Configuration> {
    if (!cachedConfig) {
        cachedConfig = await oidc.discovery(
            new URL(process.env.OIDC_ISSUER_URL!),
            process.env.OIDC_CLIENT_ID!,
            process.env.OIDC_CLIENT_SECRET
        );
    }
    return cachedConfig;
}

export function __resetOidcCache(): void {
    cachedConfig = null;
}

export interface LoginRedirect {
    url: string;
    state: string;
    nonce: string;
    codeVerifier: string;
}

export async function buildLoginRedirect(redirectUri: string): Promise<LoginRedirect> {
    const config = await getOidcConfig();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
    }).href;

    return { url, state, nonce, codeVerifier };
}

export interface SsoIdentity {
    email: string;
    name: string;
}

export async function completeLogin(
    callbackUrl: URL,
    expected: { state: string; nonce: string; codeVerifier: string }
): Promise<SsoIdentity> {
    const config = await getOidcConfig();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        pkceCodeVerifier: expected.codeVerifier
    });
    const claims = tokens.claims();
    if (!claims?.email) throw new Error('OIDC_NO_EMAIL_CLAIM');
    return {
        email: String(claims.email),
        name: String(claims.name ?? claims.email)
    };
}

/** JIT provisioning: returns the Appwrite user id for this SSO identity, creating the user on first login. */
export async function provisionSsoUser(identity: SsoIdentity): Promise<string> {
    const existing = await users.list([Query.equal('email', identity.email)]);
    if (existing.total > 0) return existing.users[0].$id;
    const created = await users.create(ID.unique(), identity.email, undefined, undefined, identity.name);
    return created.$id;
}

/** Mints an Appwrite custom token the frontend exchanges via account.createSession(userId, secret). */
export async function issueSessionToken(userId: string): Promise<{ userId: string; secret: string }> {
    const token = await users.createToken(userId);
    return { userId, secret: token.secret };
}
