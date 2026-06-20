import * as vscode from 'vscode';
import { Finding } from './scorpionClient';

export class DiagnosticProvider {
  constructor(private collection: vscode.DiagnosticCollection) {}

  /** Replaces diagnostics for a single file only, leaving other files' diagnostics untouched. */
  updateForFile(filePath: string, findings: Finding[]) {
    const uri = vscode.Uri.file(filePath);
    this.collection.set(uri, findings.map(f => this.toDiagnostic(f)));
  }

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
      this.collection.set(uri, filefindings.map(f => this.toDiagnostic(f)));
    }
  }

  private toDiagnostic(f: Finding): vscode.Diagnostic {
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
