// PostToolUse hook: eslint --fix the file just edited, scoped to frontend or backend config.
const { execSync } = require("child_process");
const path = require("path");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path || "";
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return process.exit(0);

    const isBackend = filePath.replace(/\\/g, "/").includes("/backend/");
    const cwd = isBackend ? path.join(process.cwd(), "backend") : process.cwd();
    execSync(`npx eslint --fix "${filePath}"`, { cwd, stdio: "ignore" });
  } catch {
    // lint errors shouldn't block the agent
  }
  process.exit(0);
});
