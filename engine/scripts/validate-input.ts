import { z } from 'zod';

const scanSchema = z.object({
    repo_url: z.string().url().refine((url: string) => {
        // Basic validation to prevent local file path injection
        return url.startsWith('http://') || url.startsWith('https://');
    }, "Only http/https URLs are allowed")
});

const testCases = [
    { name: "Valid HTTPS URL", url: "https://github.com/nodejs/node", expected: true },
    { name: "Valid HTTP URL", url: "http://github.com/nodejs/node", expected: true },
    { name: "Local File Path", url: "file:///etc/passwd", expected: false },
    { name: "SSH URL", url: "git@github.com:nodejs/node.git", expected: false },
    { name: "Invalid URL string", url: "not-a-url", expected: false },
    { name: "Path Traversal Attempt", url: "https://github.com/../../etc/passwd", expected: true }, // URL valid, but repo doesn't exist. Zod only checks format.
    { name: "Localhost", url: "http://localhost:3000", expected: true }, // Technically a valid URL, but we might want to block it in prod.
];

console.log("--- Phase 7: Malicious Input Validation Test ---");

testCases.forEach(tc => {
    try {
        scanSchema.parse({ repo_url: tc.url });
        console.log(`[PASS] ${tc.name}: Accepted (Expected: ${tc.expected})`);
        if (!tc.expected) console.error(`  ❌ FAILED: Should have rejected ${tc.url}`);
    } catch (e: any) {
        console.log(`[REJECT] ${tc.name}: Rejected (Expected: ${!tc.expected})`);
        if (tc.expected) console.error(`  ❌ FAILED: Should have accepted ${tc.url}`);
    }
});
