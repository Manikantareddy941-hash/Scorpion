import { Webhooks, EmitterWebhookEvent } from '@octokit/webhooks';
import crypto from 'crypto';
import { triggerCIScan } from './ciOrchestrator';

// Never fall back to a hardcoded secret here: a known default would let anyone forge a
// valid signature and trigger CI scans. If GITHUB_WEBHOOK_SECRET isn't configured, use an
// unguessable random secret instead so signature checks fail closed until it's set properly.
if (!process.env.GITHUB_WEBHOOK_SECRET) {
  console.warn('[GitHub Webhook] WARNING: GITHUB_WEBHOOK_SECRET not set. Using a random per-process secret; all incoming GitHub webhook events will be rejected until this is configured.');
}
const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex')
});

// Handle Pull Request events
webhooks.on('pull_request.opened', handlePR);
webhooks.on('pull_request.synchronize', handlePR);

async function handlePR({ payload }: EmitterWebhookEvent<'pull_request'>) {
  const { pull_request, repository } = payload;
  const installation = (payload as any).installation;

  if (!installation) {
    console.error('[GitHub Webhook] No installation ID found in payload');
    return;
  }

  console.log(`[GitHub Webhook] Received PR event for ${repository.full_name} PR #${pull_request.number}`);

  await triggerCIScan({
    owner: repository.owner.login,
    repo: repository.name,
    branch: pull_request.head.ref,
    sha: pull_request.head.sha,
    prNumber: pull_request.number,
    installationId: installation.id,
    cloneUrl: repository.clone_url
  });
}

export default webhooks;
