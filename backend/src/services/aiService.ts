import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'mock-key',
});

export const generateSecuritySummary = async (findings: any[], alerts: any[]) => {
    try {
        const prompt = `
        You are a Senior DevSecOps Engineer. Analyze the following security data and provide an executive summary.
        
        DATA CONTEXT:
        - Total Findings: ${findings.length}
        - Findings Preview: ${JSON.stringify(findings.slice(0, 10), null, 2)}
        - Recent Alerts: ${JSON.stringify(alerts.slice(0, 5), null, 2)}
        
        YOUR TASK:
        Provide a concise, markdown-formatted executive briefing detailing:
        1. **Current Risk Profile**: Summarize the overall security posture.
        2. **Active System Anomalies**: Highlight any unusual patterns or critical spikes.
        3. **Top 3 Priority Remediation Actions**: Provide specific, actionable steps to reduce risk.
        
        Keep the tone professional and the advice highly technical yet accessible to executives.
        `;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'mock-key') {
            return "### AI Security Briefing\n\n*Gemini API Key not configured. This is a simulated assessment based on provided telemetry.*\n\n**Risk Profile**: Moderate. Multiple findings detected in repository scans.\n**Anomalies**: None detected in simulated mode.\n**Priorities**: 1. Configure API keys, 2. Review critical findings, 3. Audit access logs.";
        }

        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            }),
        });

        if (!geminiResponse.ok) {
            throw new Error(`Gemini API error: ${geminiResponse.statusText}`);
        }

        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return text || 'Failed to generate summary';
    } catch (err) {
        console.error('[AI Service] summary generation failed:', err);
        throw err;
    }
};

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
                technical_analysis: "Gemini API Key not configured. This is a simulated response. The finding suggests an issue with: " + vuln.message,
                diff: "--- a/" + (vuln.file_path || 'src/App.tsx') + "\n+++ b/" + (vuln.file_path || 'src/App.tsx') + "\n@@ -12,1 +12,1 @@\n-// Fix unavailable (API Key restricted)\n+// Please configure GEMINI_API_KEY in backend/.env",
                impact_assessment: "Mock assessment: Configure GEMINI_API_KEY in your server backend's configuration to enable live AI-powered patches.",
                confidence: 0.0
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

        // Strip ```json fences if Gemini adds them despite instructions
        const cleaned = text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();

        let parsed: any;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            throw new Error(`TONY: Gemini returned non-JSON response: ${text.slice(0, 300)}`);
        }

        // Validate and clamp confidence to [0, 1]
        const confidence = typeof parsed.confidence === 'number'
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0.5; // safe default if Gemini omits it

        return {
            technical_analysis: parsed.technical_analysis || 'No analysis provided.',
            diff: parsed.diff || '',
            impact_assessment: parsed.impact_assessment || 'No impact assessment provided.',
            confidence
        };
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
