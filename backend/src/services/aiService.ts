import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const getSupabase = () => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    return createClient(supabaseUrl, supabaseKey);
};

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'mock-key',
});

export const getRemediationFix = async (vulnerabilityId: string) => {
    const supabase = getSupabase();

    // 1. Fetch Finding Details
    const { data: vuln, error: vErr } = await supabase
        .from('vulnerabilities')
        .select(`
            *,
            repositories (*)
        `)
        .eq('id', vulnerabilityId)
        .single();

    if (vErr || !vuln) {
        throw new Error('Vulnerability not found');
    }

    // 2. Check for cached fix
    const { data: existingFix } = await supabase
        .from('vulnerability_fixes')
        .select('*')
        .eq('vulnerability_id', vulnerabilityId)
        .single();

    if (existingFix) return existingFix;

    // 3. Read Full File Context (if available)
    let fileContent = '';
    if (vuln.repositories?.local_path && vuln.file_path) {
        try {
            const fullPath = path.join(vuln.repositories.local_path, vuln.file_path);
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
    if (!process.env.OPENAI_API_KEY) {
        return {
            explanation: "LLM API Key not configured. This is a simulated response. The finding suggests an issue with: " + vuln.message,
            code_diff: "// Fix unavailable (API Key restricted)",
            confidence_score: 0.0
        };
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content || '{}');

        // 6. Store and Return
        const { data: savedFix } = await supabase
            .from('vulnerability_fixes')
            .insert({
                vulnerability_id: vulnerabilityId,
                suggestion_text: result.explanation,
                code_diff: result.code_diff,
                confidence_score: result.confidence_score,
                explanation: result.explanation,
                llm_model: 'gpt-4-turbo-preview'
            })
            .select()
            .single();

        return savedFix || result;
    } catch (err) {
        console.error('[AI Service] LLM call failed:', err);
        throw err;
    }
};

export const recordFeedback = async (fixId: string, feedback: any) => {
    const supabase = getSupabase();
    const { error } = await supabase
        .from('vulnerability_fixes')
        .update({ feedback })
        .eq('id', fixId);

    if (error) throw error;
};
