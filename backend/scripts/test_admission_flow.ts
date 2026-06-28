/**
 * Manual end-to-end check for the image-digest admission flow.
 *
 * 1. POST a mock scan (vulns with unproven reachability) to /api/v1/ingest/scan
 *    for a dummy digest.
 * 2. POST a mock AdmissionReview for that digest in the `prod` namespace —
 *    expect allowed:false with a block reason.
 * 3. Repeat in the `dev` namespace — expect allowed:true with a Warning reason.
 *
 * Run the backend first (npm run dev), then: npx ts-node scripts/test_admission_flow.ts
 *
 * Note: prod-block / dev-warn comes from reachability:'unknown' (vulns present
 * but not proven reachable). A 'reachable' verdict would block in BOTH envs.
 */

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.PORT ?? 3001}`;
const IMAGE_DIGEST = 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const IMAGE = `registry.example.com/payments-api@${IMAGE_DIGEST}`;

async function ingestMockScan(): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/ingest/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageDigest: IMAGE_DIGEST,
      results: [
        { pkgName: 'log4j', installedVersion: '2.14.1', vulnerabilityId: 'CVE-2021-44228', severity: 'critical', reachability: 'unknown' },
        { pkgName: 'lodash', installedVersion: '4.17.20', vulnerabilityId: 'CVE-2021-23337', severity: 'high', reachability: 'unknown' },
      ],
    }),
  });
  console.log(`\n[ingest] ${res.status}`, await res.json());
}

function admissionReview(namespace: string) {
  return {
    apiVersion: 'admission.k8s.io/v1',
    kind: 'AdmissionReview',
    request: {
      uid: `test-uid-${namespace}`,
      namespace,
      object: { spec: { containers: [{ image: IMAGE }] } },
    },
  };
}

async function postAdmission(namespace: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/webhook/k8s-admission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(admissionReview(namespace)),
  });
  const body = (await res.json()) as { response?: { allowed?: boolean; status?: { message?: string } } };
  const allowed = body.response?.allowed;
  const message = body.response?.status?.message ?? '';
  console.log(`\n[admission ns=${namespace}] allowed=${allowed} reason="${message}"`);
}

async function main(): Promise<void> {
  await ingestMockScan();
  await postAdmission('prod'); // expect allowed=false, "...blocked in prod"
  await postAdmission('dev');  // expect allowed=true,  "Warning — ...warning in dev"
}

main().catch(err => {
  console.error('test_admission_flow failed:', err);
  process.exit(1);
});
