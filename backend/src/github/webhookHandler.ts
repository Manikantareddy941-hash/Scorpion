import { Webhooks, EmitterWebhookEvent } from '@octokit/webhooks';
import { triggerCIScan } from './ciOrchestrator';

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET || 'scorpion_webhook_secret'
});

// Handle Pull Request events
webhooks.on('pull_request.opened', handlePR);
webhooks.on('pull_request.synchronize', handlePR);

async function handlePR({ payload }: EmitterWebhookEvent<'pull_request'>) {
  const { pull_request, repository, installation } = payload;

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
