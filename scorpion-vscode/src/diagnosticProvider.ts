import * as vscode from 'vscode';
import { Finding } from './scorpionClient';

export class DiagnosticProvider {
  constructor(private collection: vscode.DiagnosticCollection) {}

  update(findings: Finding[]) {
    this.collection.clear();

    // Group findings by file
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!byFile.has(f.file)) {
        byFile.set(f.file, []);
      }
      byFile.get(f.file)!.push(f);
    }

    for (const [file, filefindings] of byFile) {
      const uri = vscode.Uri.file(file);
      const diagnostics = filefindings.map(f => {
        const line = Math.max(0, f.line - 1);
        const range = new vscode.Range(
          new vscode.Position(line, 0),
          new vscode.Position(line, 999)
        );
        
        const diag = new vscode.Diagnostic(
          range,
          `[SCORPION] ${f.title}: ${f.message}`,
          this.severityMap(f.severity)
        );
        
        diag.source = 'SCORPION';
        diag.code = f.id;
        return diag;
      });

      this.collection.set(uri, diagnostics);
    }
  }

  private severityMap(s: string): vscode.DiagnosticSeverity {
    switch (s) {
      case 'CRITICAL':
      case 'HIGH':
        return vscode.DiagnosticSeverity.Error;
      case 'MEDIUM':
        return vscode.DiagnosticSeverity.Warning;
      case 'LOW':
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Information;
    }
  }
}
