// backend/src/scripts/e2e_plan_roundtrip.ts
//
// Proof-by-execution for the Plan Workspace. Schema being 'ALL GREEN' proves
// the collections exist; it does NOT prove planRepository's writes actually
// land in Appwrite instead of the JSON fallback. handleQuery() swallows any
// Appwrite error and returns mock data, so a type/shape mismatch still reads as
// success while quietly persisting nowhere durable.
//
// This drives the real repository methods end to end, then confirms each row by
// reading it straight from Appwrite with getDocument. A 404 there means the
// write fell back to JSON — the exact failure mode we are hunting.
//
// It also logs 25 minutes of work on purpose: createWorklog does
// timeLogged += minutes/60, i.e. a fractional number into whatever type
// plan_issues.timeLogged is. If that column is an integer, the issue update
// throws and the worklog silently falls back. This run surfaces that.
//
// Run:
//   cd backend && npx ts-node src/scripts/e2e_plan_roundtrip.ts
//   (add --keep to leave the created docs behind for manual inspection)
// MUST be first: lib/appwrite reads APPWRITE_* env at import time, and ES
// imports are hoisted, so .env has to be loaded before any app import or the
// client initializes with empty creds and every call 401s into the JSON
// fallback. (dotenv/config loads ./.env from CWD, i.e. backend/.env.)
import 'dotenv/config';
import { planRepository } from '../repositories/planRepository';
import { databases, DB_ID } from '../lib/appwrite';
import { Issue } from '../types/plan.types';

const KEEP = process.argv.includes('--keep');

// Track what we create so we can read it back and clean it up.
const created: { collection: string; id: string }[] = [];
let failures = 0;

async function assertInAppwrite(collection: string, id: string, label: string): Promise<void> {
  try {
    await databases.getDocument(DB_ID, collection, id);
    console.log(`  [OK]   ${label} persisted to Appwrite (${id})`);
    created.push({ collection, id });
  } catch {
    console.error(`  [FAIL] ${label} is NOT in Appwrite (${id}) — write fell back to JSON`);
    failures++;
  }
}

async function run(): Promise<void> {
  console.log('Plan Workspace round-trip (real repository -> Appwrite)\n');

  const project = await planRepository.createProject({ name: 'RT Project', repoId: 'rt-repo', type: 'scrum', userId: 'rt-user' });
  await assertInAppwrite('plan_projects', project.$id, 'project');

  const epic = await planRepository.createEpic(project.$id, { title: 'RT Epic', color: '#f00' });
  await assertInAppwrite('plan_epics', epic.$id, 'epic');

  const sprint = await planRepository.createSprint(project.$id, { name: 'RT Sprint', goal: 'ship it' });
  await assertInAppwrite('plan_sprints', sprint.$id, 'sprint');

  const issueInput: Issue = {
    $id: 'temp', projectId: project.$id, epicId: epic.$id, sprintId: sprint.$id,
    type: 'task', title: 'RT Issue', priority: 'high', status: 'todo',
    storyPoints: 5, timeEstimate: 8, timeLogged: 0, labels: ['rt'],
    createdAt: new Date().toISOString(),
  };
  const issue = await planRepository.createIssue(issueInput);
  await assertInAppwrite('plan_issues', issue.$id, 'issue');

  const comment = await planRepository.createComment(issue.$id, { author: 'rt@x', body: 'RT comment' });
  await assertInAppwrite('plan_comments', comment.$id, 'comment');

  // 25 minutes -> timeLogged += 25/60 = 0.4166... fractional hours.
  const worklog = await planRepository.createWorklog(issue.$id, { author: 'rt@x', minutes: 25, comment: 'RT work' });
  await assertInAppwrite('plan_worklogs', worklog.$id, 'worklog (fractional timeLogged)');

  const rule = await planRepository.createAutomationRule(project.$id, { trigger: 'status:done', action: 'notify' });
  await assertInAppwrite('plan_automation_rules', rule.$id, 'automation rule');

  const arun = await planRepository.createAutomationRun({
    projectId: project.$id, ruleId: rule.$id, trigger: 'status:done', action: 'notify',
    status: 'success', message: 'ok', issueId: issue.$id, createdAt: new Date().toISOString(),
  });
  await assertInAppwrite('plan_automation_runs', arun.$id, 'automation run');

  const snap = await planRepository.createSprintSnapshot({
    projectId: project.$id, sprintId: sprint.$id, sprintName: sprint.name,
    committedPoints: 5, completedPoints: 3, committedIssues: 1, completedIssues: 0,
    startDate: '', endDate: '', closedAt: new Date().toISOString(),
  });
  await assertInAppwrite('plan_sprint_snapshots', snap.$id, 'sprint snapshot');

  const threat = await planRepository.createThreat(project.$id, {
    title: 'RT Threat', strideCategory: 'Tampering', severity: 'high',
    description: 'desc', mitigation: 'mitigate',
  });
  await assertInAppwrite('plan_threats', threat.$id, 'threat');

  // Read-back through the repository's own list methods (exercises the query +
  // order-index path that also silently falls back when an index is missing).
  console.log('\nRepository read-back:');
  const epics = await planRepository.listEpics(project.$id);
  const issues = await planRepository.listIssues(project.$id);
  const worklogs = await planRepository.listWorklogs(issue.$id);
  const snaps = await planRepository.listSprintSnapshots(project.$id);
  console.log(`  epics=${epics.length} issues=${issues.length} worklogs=${worklogs.length} snapshots=${snaps.length}`);
  if (epics.length === 0 || issues.length === 0) { console.error('  [FAIL] list returned empty — reads not hitting Appwrite'); failures++; }
  // Confirm the fractional value actually round-tripped on the issue.
  const reloaded = await planRepository.getIssue(issue.$id);
  console.log(`  issue.timeLogged after 25min log = ${reloaded?.timeLogged}`);

  if (!KEEP) {
    console.log('\nCleaning up...');
    for (const c of created.reverse()) {
      try { await databases.deleteDocument(DB_ID, c.collection, c.id); } catch { /* best effort */ }
    }
    console.log(`  deleted ${created.length} docs.`);
  } else {
    console.log('\n--keep set: leaving created docs in place.');
  }

  console.log(`\n${failures === 0 ? 'PASS — every Plan entity persisted to Appwrite.' : `FAIL — ${failures} entity(ies) did not reach Appwrite.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
