const fs = require('fs');

function replace(file, src, dest) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.split(src).join(dest);
    fs.writeFileSync(file, content);
  }
}

replace('src/github/webhookHandler.ts', 'payload.installation', '(payload as any).installation');
replace('src/routes/ciRoutes.ts', 'req.headers[\'x-github-delivery\'] as string | null', '(req.headers[\'x-github-delivery\'] as string) || \'\'');
replace('src/routes/dashboardRoutes.ts', 'repo_name: repo?.name,', 'repo_name: repo?.name || \'Unknown\',');
replace('src/routes/dashboardRoutes.ts', 'repo_name: repo ? repo.name : undefined,', 'repo_name: repo?.name || \'Unknown\',');
replace('src/routes/repoRoutes.ts', 'isTemp: true,', '');
replace('src/routes/repoRoutes.ts', 'isTemp: true', '');
replace('src/services/incidentService.ts', 'import { notifySlack }', '// import { notifySlack }');
replace('src/verify_projects.ts', 'e.message', '(e as any).message');
replace('src/verify_projects.ts', 'project.name', 'project?.name');
replace('src/verify_projects.ts', 'repo.name', 'repo?.name');
