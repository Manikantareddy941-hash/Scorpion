import axios from 'axios';
import { execSync } from 'child_process';

async function runDiagnostics() {
    console.log('--- 🔍 System-Wide Diagnostic Report ---');

    // 1. Backend Health Check
    console.log('\n[1] Checking Backend Health...');
    try {
        const health = await axios.get('http://localhost:3001/api/health');
        console.log('✅ /api/health:', health.data.status || 'ok');
    } catch (err: any) {
        console.log('❌ /api/health failed:', err.message);
    }

    // 2. Auth Health Check (Diagnostics)
    console.log('\n[2] Checking Auth Health (Supabase & Tools)...');
    try {
        const authHealth = await axios.get('http://localhost:3001/api/health/auth');
        console.log('✅ /api/health/auth returned status');
        console.log('   - Backend:', authHealth.data.backend);
        console.log('   - Supabase:', authHealth.data.supabase);
        console.log('   - Tools Metadata:', authHealth.data.tools || 'not reported');
    } catch (err: any) {
        console.log('❌ /api/health/auth failed:', err.message);
    }

    // 3. Security Tool Binaries
    console.log('\n[3] Verifying Security Tool Binaries...');
    const tools = [
        { name: 'Gitleaks', cmd: 'c:\\Users\\LENOVO\\Stackpilot\\tools\\gitleaks\\gitleaks.exe version' },
        { name: 'Trivy', cmd: 'c:\\Users\\LENOVO\\Stackpilot\\tools\\trivy\\trivy.exe --version' },
        { name: 'Semgrep', cmd: 'C:\\Users\\LENOVO\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\semgrep.exe --version' }
    ];

    for (const tool of tools) {
        try {
            const out = execSync(`"${tool.cmd.split(' ')[0]}" ${tool.cmd.split(' ').slice(1).join(' ')}`, { stdio: 'pipe' }).toString().trim();
            console.log(`✅ ${tool.name}: ${out.split('\n')[0]}`);
        } catch (err: any) {
            console.log(`❌ ${tool.name} failed:`, err.message);
        }
    }

    // 4. API Routes Audit
    console.log('\n[4] API Routes Accessibility...');
    const routes = ['/api/projects', '/api/repos', '/api/notifications'];
    for (const route of routes) {
        try {
            // These will fail with 401 Unauthorized but that's GOOD (proves middleware is there)
            await axios.get(`http://localhost:3001${route}`);
        } catch (err: any) {
            if (err.response?.status === 401) {
                console.log(`✅ ${route}: Protected (OK)`);
            } else {
                console.log(`❌ ${route}: Error ${err.response?.status || err.message}`);
            }
        }
    }

    console.log('\n--- Diagnostic Complete ---');
}

runDiagnostics();
