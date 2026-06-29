// PreToolUse hook: block Edit/Write on secret files. Exit 2 = deny.
const SECRET_PATTERNS = [/\.env(\..*)?$/, /private-key\.pem$/, /password_resets\.sql$/, /\.pem$/, /\.key$/];

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path || "";
    const base = filePath.replace(/\\/g, "/").split("/").pop() || "";
    if (SECRET_PATTERNS.some((re) => re.test(base))) {
      console.error(`Blocked: ${base} looks like a secret file. Edit manually if intended.`);
      process.exit(2);
    }
  } catch {
    // malformed input, allow through
  }
  process.exit(0);
});
