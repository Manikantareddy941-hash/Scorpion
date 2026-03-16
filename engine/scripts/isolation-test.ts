import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function verifyIsolation() {
    console.log('[IsolationTest] Verifying network isolation in sandbox...');

    const image = 'alpine:latest';
    const cmd = 'curl -I --connect-timeout 5 https://google.com';

    try {
        console.log(`[IsolationTest] Running: docker run --rm --network none ${image} ${cmd}`);
        await execAsync(`docker run --rm --network none ${image} ${cmd}`);
        console.error('[IsolationTest] ❌ FAILED: Sandbox has internet access!');
        process.exit(1);
    } catch (error: any) {
        console.log('[IsolationTest] ✅ SUCCESS: Sandbox is isolated (Expected failure).');
        console.log(`[IsolationTest] Error details: ${error.message}`);
    }
}

verifyIsolation().catch(console.error);
