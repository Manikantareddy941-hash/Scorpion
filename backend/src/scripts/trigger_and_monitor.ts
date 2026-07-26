import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { databases, DB_ID } from '../lib/appwrite';

async function run() {
  const repoId = '69c15671002e0d7166dd';
  console.log(`[Test] Triggering pipeline run via Backend API for repo: ${repoId}`);
  try {
    const triggerRes = await axios.post('http://localhost:3001/api/pipelines/trigger', {
      repoId,
      branch: 'main'
    });

    const runId = triggerRes.data.runId;
    console.log(`[Test] Pipeline run created with ID: ${runId}`);
    console.log('[Test] Monitoring run status via Appwrite...');

    // Poll every 3 seconds
    const interval = setInterval(async () => {
      try {
        const runDoc = await databases.getDocument(DB_ID, 'pipeline_runs', runId);
        console.log(`[${new Date().toLocaleTimeString()}] Status: ${runDoc.status}, Current Stage: ${runDoc.currentStage}`);
        console.log(`      Stages status: Trigger: ${runDoc.triggerStatus}, Build: ${runDoc.buildStatus}, Test: ${runDoc.testStatus}, Security: ${runDoc.securityScanStatus}, Gate: ${runDoc.gateCheckStatus}, Deploy: ${runDoc.deployStatus}`);
        
        if (runDoc.status === 'success' || runDoc.status === 'failed') {
          clearInterval(interval);
          console.log(`[Test] Pipeline finished with status: ${runDoc.status}`);
          
          // Print logs at the end
          try {
            const logsRes = await axios.get(`http://localhost:3001/api/pipelines/run/${runId}/logs`);
            console.log('\n=== PIPELINE RUN LOGS ===');
            console.log(logsRes.data);
            console.log('=========================\n');
          } catch (e: any) {
            console.error('Failed to fetch logs:', e.message);
          }

          process.exit(runDoc.status === 'success' ? 0 : 1);
        }
      } catch (err: any) {
        console.error('Error fetching run doc:', err.message);
      }
    }, 3000);

  } catch (err: any) {
    console.error('Error triggering pipeline:', err.response?.data || err.message);
  }
}

run();
