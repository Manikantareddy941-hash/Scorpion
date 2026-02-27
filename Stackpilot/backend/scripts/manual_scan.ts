import 'dotenv/config';
import { scanRepositories } from '../src/jobs/github-scanner';

const run = async () => {
    console.log('Triggering manual scan...');
    try {
        await scanRepositories();
        console.log('Scan completed successfully.');
    } catch (error) {
        console.error('Scan failed:', error);
    }
};

run();
