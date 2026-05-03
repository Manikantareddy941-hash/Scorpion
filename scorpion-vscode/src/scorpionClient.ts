import * as vscode from 'vscode';

export interface Finding {
  id: string;
  type: 'sast' | 'sca' | 'secret';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  file: string;
  line: number;
  message: string;
  fix?: string;
}

export class ScorpionClient {
  private get baseUrl(): string {
    return vscode.workspace.getConfiguration('scorpion').get('backendUrl', 'http://localhost:3001');
  }

  private get apiKey(): string {
    return vscode.workspace.getConfiguration('scorpion').get('apiKey', '');
  }

  async scanWorkspace(repoPath: string): Promise<Finding[]> {
    try {
      // Use node-fetch style if global fetch is not available in older VSCode node versions
      // But 1.85+ should have it.
      const response = await fetch(`${this.baseUrl}/api/scan/ide/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey
        },
        body: JSON.stringify({ path: repoPath })
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.statusText}`);
      }
      
      const data = await response.json() as { findings: Finding[] };
      return data.findings;
    } catch (error: any) {
      console.error('[ScorpionClient] Request error:', error);
      throw error;
    }
  }

  async fixWithAI(finding: Finding): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/remediation/fix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      body: JSON.stringify({ finding })
    });

    if (!response.ok) {
      throw new Error('AI fix failed');
    }
    
    const data = await response.json() as { fix: string };
    return data.fix;
  }
}
