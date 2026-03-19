const { Octokit } = require("@octokit/rest");

module.exports = async ({ req, res, log, error }) => {
  const {
    providerAccessToken,
    repoFullName,
    filePath,
    packageName,
    oldVersion,
    fixedVersion,
    cveId
  } = req.body;

  if (!providerAccessToken || !repoFullName || !filePath || !packageName || !oldVersion || !fixedVersion || !cveId) {
    return res.json({ error: "Missing required parameters" }, 400);
  }

  // DEV: Enable full-flow mock testing
  if (providerAccessToken === 'mock-github-token') {
    log('Mock token detected. Returning synthetic PR URL.');
    return res.json({ prUrl: 'https://github.com/Manikantareddy941-hash/Scorpion/pull/mock-remediation-123' });
  }

  const [owner, repo] = repoFullName.split("/");
  const octokit = new Octokit({ auth: providerAccessToken });

  try {
    // 1. Get default branch
    log(`Fetching repo info for ${repoFullName}`);
    const { data: repository } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repository.default_branch;

    // 2. Get latest commit SHA from default branch
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`
    });
    const baseSha = ref.object.sha;

    // 3. Create a new branch
    const newBranch = `security-fix-${cveId}`;
    log(`Creating branch ${newBranch} from ${defaultBranch}`);
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: baseSha
    });

    // 4. Get the current file content
    log(`Getting file content for ${filePath}`);
    const { data: fileData } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: newBranch
    });

    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
    
    // 5. Replace oldVersion with fixedVersion
    const updatedContent = content.replace(oldVersion, fixedVersion);
    if (content === updatedContent) {
      log("No changes detected in file content.");
    }

    // 6. Commit the change
    log(`Committing changes to ${filePath}`);
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Security Fix: Upgrade ${packageName} to ${fixedVersion}`,
      content: Buffer.from(updatedContent).toString('base64'),
      sha: fileData.sha,
      branch: newBranch
    });

    // 7. Open a Pull Request
    log(`Opening Pull Request for ${newBranch}`);
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `Security Fix: Upgrade ${packageName} to ${fixedVersion}`,
      head: newBranch,
      base: defaultBranch,
      body: `This automated PR upgrades **${packageName}** from version \`${oldVersion}\` to \`${fixedVersion}\` to remediate vulnerability **${cveId}**.`
    });

    log(`Pull Request created: ${pr.html_url}`);
    return res.json({ prUrl: pr.html_url });

  } catch (err) {
    error(`Error in remediation flow: ${err.message}`);
    return res.json({ error: err.message }, 500);
  }
};
