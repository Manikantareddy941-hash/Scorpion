import { Threat } from './threatModelService';
import { logger, errorContext } from './logger';

export interface DiagramComponent {
  id: string;
  type: 'process' | 'externalEntity' | 'dataStore' | 'trustBoundary' | 'dataFlow';
  label: string;
  description?: string;
  trustLevel?: 'high' | 'medium' | 'low';
  data?: any;
}

export const generateStrideThreats = async (diagramData: any): Promise<Threat[]> => {
  try {
    const components: DiagramComponent[] = diagramData.nodes || [];
    
    if (components.length === 0) {
      return [];
    }

    const prompt = `
    You are a Senior Security Threat Modeling Expert. Analyze the following system architecture diagram components and generate STRIDE threats.
    
    DIAGRAM COMPONENTS:
    ${JSON.stringify(components, null, 2)}
    
    YOUR TASK:
    For each component, identify potential security threats using the STRIDE methodology:
    - S: Spoofing - Impersonation of something or someone
    - T: Tampering - Modification of data or code
    - R: Repudiation - Users denying performing actions
    - I: Information Disclosure - Exposure of sensitive information
    - D: Denial of Service - Disruption of service availability
    - E: Elevation of Privilege - Gaining unauthorized capabilities
    
    For each threat, provide:
    - threatId: Unique identifier (e.g., THR-001)
    - component: The component name this threat applies to
    - strideCategory: One of: Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege
    - title: Brief threat title
    - description: Detailed explanation of the threat
    - severity: One of: low, medium, high, critical
    - mitigations: Array of specific mitigation strategies
    
    FORMAT YOUR RESPONSE AS JSON:
    {
      "threats": [
        {
          "threatId": "THR-001",
          "component": "component_name",
          "strideCategory": "Spoofing",
          "title": "Threat title",
          "description": "Detailed description",
          "severity": "high",
          "mitigations": ["mitigation 1", "mitigation 2"]
        }
      ]
    }
    
    Generate 3-5 relevant threats per component. Focus on realistic, actionable threats.
    `;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'mock-key') {
      // Return mock threats when API key is not configured
      return generateMockThreats(components);
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
      throw new Error(`Threat AI: Gemini returned non-JSON response: ${text.slice(0, 300)}`);
    }

    return parsed.threats || [];
  } catch (err) {
    logger.error('[Threat AI Service] STRIDE analysis failed:', { event: 'THREAT_AI_ANALYSIS_FAILED', ...errorContext(err) });
    throw err;
  }
};

const generateMockThreats = (components: DiagramComponent[]): Threat[] => {
  const threats: Threat[] = [];
  let threatCounter = 1;

  const strideCategories: Array<'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege'> = [
    'Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege'
  ];

  components.forEach((component, index) => {
    // Generate 2-3 threats per component
    const numThreats = 2 + (index % 2);
    
    for (let i = 0; i < numThreats; i++) {
      const stride = strideCategories[(threatCounter - 1) % strideCategories.length];
      const severity: 'low' | 'medium' | 'high' | 'critical' = 
        threatCounter % 5 === 0 ? 'critical' : 
        threatCounter % 3 === 0 ? 'high' : 
        threatCounter % 2 === 0 ? 'medium' : 'low';

      threats.push({
        threatId: `THR-${String(threatCounter).padStart(3, '0')}`,
        component: component.label,
        strideCategory: stride,
        title: `${stride} Threat on ${component.label}`,
        description: `Potential ${stride.toLowerCase()} vulnerability identified for ${component.label}. This is a simulated threat generated because the Gemini API key is not configured. Configure GEMINI_API_KEY in backend/.env to enable real AI-powered threat analysis.`,
        severity: severity,
        mitigations: [
          'Implement proper authentication and authorization',
          'Add input validation and sanitization',
          'Enable comprehensive logging and monitoring',
          'Apply principle of least privilege',
          'Regular security testing and review'
        ]
      });
      threatCounter++;
    }
  });

  return threats;
};
