// SLSA v1 build provenance, scoped to what this codebase actually runs:
// buildService.ts builds Docker images locally (no registry, no Fulcio/Rekor),
// so provenance is an in-toto Statement signed with the same local cosign
// key primitive as image digests (cosignService.signBlobContent). It proves
// the same thing a registry attestation would: this exact image digest was
// produced by this pipeline from this repo+commit, not substituted afterward.
import { signBlobContent, verifyBlobContent } from './cosignService';
import { logger } from './logger';

const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';
const BUILD_TYPE = 'https://scorpion.local/buildTypes/docker@v1';
const BUILDER_ID = 'https://scorpion.local/builder/buildService@v1';

export interface BuildContext {
    imageName: string;
    /** Image content digest, `sha256:<hex>` as returned by getImageDigest. */
    imageDigest: string;
    repoUrl: string;
    branch: string;
    commitSha: string;
    /** Build pipeline id — ties the statement back to the pipeline record. */
    invocationId: string;
    startedOn: string;
    finishedOn: string;
}

export interface SlsaProvenanceStatement {
    _type: typeof STATEMENT_TYPE;
    subject: Array<{ name: string; digest: { sha256: string } }>;
    predicateType: typeof PREDICATE_TYPE;
    predicate: {
        buildDefinition: {
            buildType: string;
            externalParameters: { repository: string; branch: string };
            resolvedDependencies: Array<{ uri: string; digest: { gitCommit: string } }>;
        };
        runDetails: {
            builder: { id: string };
            metadata: { invocationId: string; startedOn: string; finishedOn: string };
        };
    };
}

export interface SignedProvenance {
    statement: SlsaProvenanceStatement;
    signature: string;
}

const bareSha256 = (digest: string): string => digest.replace(/^sha256:/, '');

/** Pure statement construction — no signing, no I/O. */
export const buildProvenanceStatement = (ctx: BuildContext): SlsaProvenanceStatement => ({
    _type: STATEMENT_TYPE,
    subject: [{ name: ctx.imageName, digest: { sha256: bareSha256(ctx.imageDigest) } }],
    predicateType: PREDICATE_TYPE,
    predicate: {
        buildDefinition: {
            buildType: BUILD_TYPE,
            externalParameters: { repository: ctx.repoUrl, branch: ctx.branch },
            resolvedDependencies: [{ uri: ctx.repoUrl, digest: { gitCommit: ctx.commitSha } }],
        },
        runDetails: {
            builder: { id: BUILDER_ID },
            metadata: { invocationId: ctx.invocationId, startedOn: ctx.startedOn, finishedOn: ctx.finishedOn },
        },
    },
});

/**
 * Builds and signs a provenance statement for a completed build. Returns
 * null (not an error) when signing isn't configured/available — same
 * opt-in semantics as signImageDigest.
 *
 * The signature covers JSON.stringify(statement); verifyProvenance
 * re-serializes the stored statement the same way, so the statement object
 * itself is the canonical form (key order is fixed by construction above).
 */
export const attestProvenance = async (ctx: BuildContext): Promise<SignedProvenance | null> => {
    const statement = buildProvenanceStatement(ctx);
    const signed = await signBlobContent(JSON.stringify(statement));
    if (!signed) return null;
    return { statement, signature: signed.signature };
};

/**
 * Verifies a stored provenance record against an image digest: the statement
 * must name this exact digest as its subject AND the signature over the
 * statement must be valid. Returns false on mismatch/invalid signature;
 * throws when verification couldn't be attempted (no public key, no cosign) —
 * mirrors verifyImageDigest so callers keep the block-vs-skip distinction.
 */
export const verifyProvenance = async (imageDigest: string, prov: SignedProvenance): Promise<boolean> => {
    const expected = bareSha256(imageDigest);
    const subjectMatches = prov.statement.subject.some((s) => s.digest.sha256 === expected);
    if (!subjectMatches) {
        logger.warn(`[Provenance] Statement subject does not match digest ${imageDigest}`);
        return false;
    }
    return verifyBlobContent(JSON.stringify(prov.statement), prov.signature);
};
