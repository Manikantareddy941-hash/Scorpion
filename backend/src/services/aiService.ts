import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'mock-key',
});

export const getRemediationFix = async (vulnerabilityId: string) => {
    try {
        // 1. Fetch Finding Details
        const vuln = await databases.getDocument(DB_ID, COLLECTIONS.VULNERABILITIES, vulnerabilityId);

        if (!vuln) {
            throw new Error('Vulnerability not found');
        }

        // Fetch Repo details separately
        const repo = await databases.getDocument(DB_ID, COLLECTIONS.REPOSITORIES, vuln.repo_id);

        // 2. Check for cached fix
        const existingFixes = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, [
            Query.equal('vulnerability_id', vulnerabilityId),
            Query.limit(1)
        ]);

        if (existingFixes.total > 0) return existingFixes.documents[0];

        // 3. Read Full File Context (if available)
        let fileContent = '';
        if (repo && repo.local_path && vuln.file_path) {
            try {
                const fullPath = path.join(repo.local_path, vuln.file_path);
                if (fs.existsSync(fullPath)) {
                    fileContent = fs.readFileSync(fullPath, 'utf8');
                }
            } catch (err) {
                console.error('[AI Service] Failed to read file context:', err);
            }
        }

        // 4. Construct Prompt
        const prompt = `
        You are a Security Engineer assistant. Analyze the following security finding and suggest a fix.
        
        FINDING DETAILS:
        - Tool: ${vuln.tool}
        - Severity: ${vuln.severity}
        - Message: ${vuln.message}
        - File: ${vuln.file_path}
        - Line: ${vuln.line_number}
        
        CODE CONTEXT (Line ${vuln.line_number} is the center of this snippet):
        \`\`\`
        ${fileContent || 'Context not available'}
        \`\`\`
        
        YOUR TASK:
        1. Explain WHY this is a security risk.
        2. Provide the FULL, complete, and SECURE version of the file that resolves the issue.
        3. The file must be ready to be written directly to the filesystem. Do not include diff markers or markdown commentary in the "code_diff" field.
        4. Provide a confidence score (0.0 to 1.0) on how likely this fix is correct.
        
        FORMAT YOUR RESPONSE AS JSON:
        {
          "explanation": "...",
          "code_diff": "...", // THIS MUST BE THE ENTIRE FILE CONTENT
          "confidence_score": 0.95
        }
        `;

        // 5. Call LLM (with safety fallback)
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'mock-key') {
            return {
                explanation: "LLM API Key not configured. This is a simulated response. The finding suggests an issue with: " + vuln.message,
                code_diff: "// Fix unavailable (API Key restricted)",
                confidence_score: 0.0
            };
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        // 6. Store and Return
        const savedFix = await databases.createDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, ID.unique(), {
            vulnerability_id: vulnerabilityId,
            suggestion_text: result.explanation,
            code_diff: result.code_diff,
            confidence_score: result.confidence_score,
            explanation: result.explanation,
            llm_model: 'gpt-4-turbo-preview',
            created_at: new Date().toISOString()
        });

        return savedFix;
    } catch (err) {
        console.error('[AI Service] remediation failed:', err);
        throw err;
    }
};

export const recordFeedback = async (fixId: string, feedback: any) => {
    try {
        await databases.updateDocument(DB_ID, COLLECTIONS.VULNERABILITY_FIXES, fixId, {
            feedback: typeof feedback === 'object' ? JSON.stringify(feedback) : feedback
        });
    } catch (err) {
        console.error('[AI Service] Failed to record feedback:', err);
        throw err;
    }
};
