// PreToolUse hook: require explicit confirmation before editing security-sensitive route files.
const SENSITIVE = /backend\/src\/routes\/(dast|docker|compliance|audit|gate|sbom|falco|auth|key|user|team)\w*Routes?\.ts$/i;

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const filePath = (data?.tool_input?.file_path || "").replace(/\\/g, "/");
    if (SENSITIVE.test(filePath)) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `Editing security-sensitive route file: ${filePath}. Confirm before proceeding.`,
          },
        })
      );
    }
  } catch {
    // malformed input, allow through
  }
  process.exit(0);
});
