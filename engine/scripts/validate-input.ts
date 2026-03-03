import { z } from 'zod';

const scanSchema = z.object({
    repo_url: z.string().refine((value: string) => {
        if (!value.startsWith("https://github.com/")) return false;
        if (value.includes('..')) return false;
        try {
            const url = new URL(value);
            if (url.protocol !== "https:") return false;
            if (url.hostname !== "github.com") return false;
            const pathParts = url.pathname.split("/").filter(Boolean);
            if (pathParts.length !== 2) return false;
            if (pathParts.some(part => part === '..' || part === '.')) return false;
            return true;
        } catch {
            return false;
        }
    }, {
        message: "Only valid GitHub HTTPS repository URLs (https://github.com/owner/repo) are allowed."
    })
});

const testCases = [
    { name: "Valid GitHub HTTPS URL", url: "https://github.com/nodejs/node", expected: true },
    { name: "Invalid HTTP URL", url: "http://github.com/nodejs/node", expected: false },
    { name: "Local File Path", url: "file:///etc/passwd", expected: false },
    { name: "SSH URL", url: "git@github.com:nodejs/node.git", expected: false },
    { name: "Invalid URL string", url: "not-a-url", expected: false },
    { name: "Path Traversal Attempt", url: "https://github.com/../../etc/passwd", expected: false },
    { name: "Localhost", url: "http://localhost:3000", expected: false },
    { name: "Non-GitHub HTTPS URL", url: "https://google.com/owner/repo", expected: false },
];

console.log("--- Phase 7: Malicious Input Validation Test ---");

testCases.forEach(tc => {
    try {
        scanSchema.parse({ repo_url: tc.url });
        if (tc.expected) {
            console.log(`[PASS] ${tc.name}: Accepted as expected.`);
        } else {
            console.error(`[FAIL] ${tc.name}: Accepted but should have been REJECTED!`);
        }
    } catch (e: any) {
        if (!tc.expected) {
            console.log(`[PASS] ${tc.name}: Rejected as expected.`);
        } else {
            console.error(`[FAIL] ${tc.name}: Rejected but should have been ACCEPTED!`);
        }
    }
});
