const { execSync } = require('child_process');
try {
    console.log('Semgrep Version:', execSync('semgrep --version', { encoding: 'utf8' }).trim());
    console.log('Gitleaks Version:', execSync('gitleaks version', { encoding: 'utf8' }).trim());
} catch (err) {
    console.error('Spawn check failed:', err.message);
}
