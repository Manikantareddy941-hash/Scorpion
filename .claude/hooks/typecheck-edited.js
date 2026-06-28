// PostToolUse hook: typecheck the frontend or backend project after a .ts/.tsx edit. Non-blocking, surfaces errors as context.
const { execSync } = require("child_process");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path || "";
    if (!/\.tsx?$/.test(filePath)) return process.exit(0);

    const isBackend = filePath.replace(/\\/g, "/").includes("/backend/");
    const cmd = isBackend ? "npx tsc --noEmit -p tsconfig.json" : "npm run typecheck --silent";
    const cwd = isBackend ? "backend" : ".";
    execSync(cmd, { cwd, stdio: "pipe" });
  } catch (err) {
    const out = (err.stdout || err.message || "").toString().slice(0, 4000);
    console.log(`Typecheck errors after this edit:\n${out}`);
  }
  process.exit(0);
});
