import 'dotenv/config';
import { createProject, getProjects, getProjectDashboard, importRepoToProject } from './services/projectService';

async function runVerification() {
    console.log('🚀 Starting Verification: Projects and Repository Module');

    const testUserId = 'a95d9aa5-8992-4f2a-beb5-8ccdeb0bcd26'; // Provided by user
    let testProjectId: string = '';

    try {
        // 1. Create Project
        console.log('\n--- 1. Create Project ---');
        const { data: project, error: createError } = await createProject(
            testUserId,
            'Test Project ' + Date.now(),
            'Verification testing'
        );
        if (createError) throw new Error(`Create Project failed: ${createError.message}`);
        console.log('✅ Project created:', project.name, 'ID:', project.id);
        testProjectId = project.id;

        // 2. List Projects
        console.log('\n--- 2. List Projects ---');
        const { data: projects, error: listError } = await getProjects(testUserId);
        if (listError) throw new Error(`List Projects failed: ${listError.message}`);
        console.log('✅ Projects found:', projects?.length);

        // 3. Import Repo
        console.log('\n--- 3. Import Repository ---');
        const testRepoUrl = 'https://github.com/stackpilot/test-repo-' + Date.now();
        const { data: repo, error: importError } = await importRepoToProject(testProjectId, testUserId, testRepoUrl);
        if (importError) throw new Error(`Import Repo failed: ${typeof importError === 'string' ? importError : importError.message}`);
        console.log('✅ Repository imported:', repo.name, 'Link to Project:', repo.project_id);

        // 4. Project Dashboard
        console.log('\n--- 4. Project Dashboard ---');
        const { data: dashboard, error: dashError } = await getProjectDashboard(testProjectId, testUserId);
        if (dashError) throw new Error(`Dashboard failed: ${typeof dashError === 'string' ? dashError : dashError.message}`);
        console.log('✅ Dashboard Data:');
        console.log('   Repos:', dashboard?.stats.totalRepos);
        console.log('   Vulns:', dashboard?.stats.totalVulns);
        console.log('   Risk:', dashboard?.stats.avgRiskScore);

        console.log('\n✨ Verification Successful! ✨');
    } catch (error: any) {
        console.error('\n❌ Verification Failed:', error.message);
        // We don't exit(1) here as it's a test script, but we mark the failure
    }
}

runVerification();
