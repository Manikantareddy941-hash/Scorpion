import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import { logger, errorContext } from './logger';

export interface SecurityEvent {
  type: 'threat' | 'gate_blocked';
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  details: string;
  repo_id: string;
  repo_name?: string;
  meta?: Record<string, any>;
}

export async function sendSecurityAlert(event: SecurityEvent) {
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
  const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

  logger.info(`[Notification Router] Event Dispatched: ${event.title} (Severity: ${event.severity})`);

  // Fetch Repository Name if not provided
  let repoName = event.repo_name || event.repo_id;
  try {
    if (event.repo_id && event.repo_id !== 'system') {
      const repoDoc = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, event.repo_id);
      if (repoDoc && repoDoc.name) {
        repoName = repoDoc.name;
      }
    }
  } catch (err) {
    logger.warn('[Notification Router] failed to resolve repo name', {
      event_name: 'NOTIFICATION_REPO_LOOKUP_FAILED',
      repoId: event.repo_id,
      ...errorContext(err),
    });
  }

  // 1. Structure Slack Block Kit Payload
  const slackPayload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 SCORPION SECURITY EVENT: ${event.type === 'threat' ? 'INTRUSION DETECTED' : 'RELEASE GATE BLOCKED'}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Repository:* \`${repoName}\`\n*Event Vector:* ${event.title}\n*Threat Severity:* \`${event.severity}\`\n\n*Diagnostic Details:*\n> ${event.details}`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🚨 View Dashboard',
              emoji: true
            },
            url: `http://localhost:5173/journey?repo_id=${event.repo_id}`,
            style: 'primary'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '💥 Trigger TONY Remediate',
              emoji: true
            },
            url: `http://localhost:5173/analysis?repo_id=${event.repo_id}`,
            style: 'danger'
          }
        ]
      }
    ]
  };

  // 2. Structure Discord Rich Embed Markdown Payload
  const colorHex = (event.severity === 'CRITICAL' || event.severity === 'HIGH') ? 16711765 : 61951; // crimson red vs neon cyan
  const discordPayload = {
    embeds: [
      {
        title: `🚨 SCORPION SECURITY SIGNAL: ${event.type === 'threat' ? 'PRODUCTION INTRUSION' : 'CD GATE BLOCKED'}`,
        description: `**Vector Alert:** ${event.title}\n**Severity Rating:** ${event.severity}\n**Target Repo:** ${repoName}\n\n**Payload Context:**\n\`\`\`\n${event.details}\n\`\`\``,
        color: colorHex,
        fields: [
          {
            name: '🔗 Actionable Triage Controls',
            value: `[🚨 View in SCORPION Dashboard](http://localhost:5173/journey?repo_id=${event.repo_id})\n[💥 Trigger TONY Auto-Remediation](http://localhost:5173/analysis?repo_id=${event.repo_id})`
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'SCORPION Security Compliance Gatekeeper'
        }
      }
    ]
  };

  // 3. Dispatch to Slack Webhook (Fail-safe, async with AbortController)
  if (SLACK_WEBHOOK_URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
      signal: controller.signal
    })
      .then(res => {
        clearTimeout(timeout);
        logger.info(`[Notification Router] Slack dispatch result status: ${res.status}`);
      })
      .catch(err => {
        clearTimeout(timeout);
        logger.error('[Notification Router] dispatch aborted or failed', {
          event_name: 'NOTIFICATION_DISPATCH_FAILED',
          channel: 'slack',
          ...errorContext(err),
        });
      });
  } else {
    logger.info('[Notification Router] SLACK_WEBHOOK_URL not configured. Skipping Slack dispatch.');
  }

  // 4. Dispatch to Discord Webhook (Fail-safe, async with AbortController)
  if (DISCORD_WEBHOOK_URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
      signal: controller.signal
    })
      .then(res => {
        clearTimeout(timeout);
        logger.info(`[Notification Router] Discord dispatch result status: ${res.status}`);
      })
      .catch(err => {
        clearTimeout(timeout);
        logger.error('[Notification Router] dispatch aborted or failed', {
          event_name: 'NOTIFICATION_DISPATCH_FAILED',
          channel: 'discord',
          ...errorContext(err),
        });
      });
  } else {
    logger.info('[Notification Router] DISCORD_WEBHOOK_URL not configured. Skipping Discord dispatch.');
  }
}

// Support for other backend modules' notification requirements
export async function checkOverdueTasks() {
  logger.info('[Notification Router] Running hourly check for overdue tasks...');
  try {
    const response = await databases.listDocuments(DB_ID, COLLECTIONS.TASKS, [
      Query.equal('status', 'todo'),
      Query.limit(50)
    ]);
    const overdue = response.documents.filter(doc => doc.due_date && new Date(doc.due_date) < new Date());
    logger.info(`[Notification Router] Found ${overdue.length} overdue tasks.`);
  } catch (err) {
    logger.error('[Notification Router] failed to check overdue tasks', {
      event_name: 'OVERDUE_TASK_CHECK_FAILED',
      ...errorContext(err),
    });
  }
}

export async function notifyPolicyFailure(repoId: string, scanId: string, result: string, reason: string) {
  logger.info(`[Notification Router] Policy evaluation failed for repo: ${repoId}`);
  await sendSecurityAlert({
    type: 'gate_blocked',
    title: 'Policy Evaluation Failure',
    severity: 'HIGH',
    details: `Scan ID: ${scanId}\nResult: ${result}\nReason: ${reason}`,
    repo_id: repoId
  });
}

export async function notifyScanCompletion(scanId: string, repoId?: string, status?: string) {
  logger.info(`[Notification Router] Scan completion event triggered for scan: ${scanId}, repo: ${repoId || 'N/A'}, status: ${status || 'N/A'}`);
}
