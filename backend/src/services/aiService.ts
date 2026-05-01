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

        // 2. [Cache Check Disabled - Collection Missing]

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
        - Package: ${vuln.package || 'N/A'}
        - Version: ${vuln.version || 'N/A'}
        
        CODE CONTEXT (Line ${vuln.line_number} is the center of this snippet):
        \`\`\`
        ${fileContent || 'Context not available'}
        \`\`\`
        
        YOUR TASK:
        1. Provide a detailed technical analysis of why this is a risk.
        2. Provide the FULL, complete, and SECURE version of the file that resolves the issue.
        3. Assess the impact of the fix on the overall system.
        4. Provide a confidence score (0.0 to 1.0) on how likely this fix is correct.
        
        FORMAT YOUR RESPONSE AS JSON:
        {
          "technical_analysis": "...",
          "diff": "...", // THIS MUST BE THE ENTIRE FILE CONTENT OR A REPLACEMENT BLOCK
          "impact_assessment": "...",
          "confidence": 0.95
        }
        `;

        // 5. Call Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'mock-key') {
            return {
                explanation: "Gemini API Key not configured. This is a simulated response. The finding suggests an issue with: " + vuln.message,
                code_diff: "// Fix unavailable (API Key restricted)",
                confidence_score: 0.0
            };
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    response_mime_type: "application/json",
                }
            }),
        });

        if (!geminiResponse.ok) {
            const errData = await geminiResponse.json();
            throw new Error(`Gemini API error: ${errData.error?.message || geminiResponse.statusText}`);
        }

        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('No response from Gemini');

        const result = JSON.parse(text);
        return result;
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
