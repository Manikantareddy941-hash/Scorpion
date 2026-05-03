import * as vscode from 'vscode';
import { ScorpionClient } from '../scorpionClient';
import { DiagnosticProvider } from '../diagnosticProvider';
import { SidebarProvider } from '../sidebarProvider';

export async function scanWorkspace(
  client: ScorpionClient,
  diagnosticProvider: DiagnosticProvider,
  sidebarProvider: SidebarProvider
) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const rootPath = folders[0].uri.fsPath;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'SCORPION: Scanning workspace for security vulnerabilities...',
    cancellable: false
  }, async () => {
    try {
      const findings = await client.scanWorkspace(rootPath);
      
      diagnosticProvider.update(findings);
      sidebarProvider.refresh(findings);

      if (findings.length > 0) {
        vscode.window.showWarningMessage(`SCORPION: Found ${findings.length} security issues!`);
      } else {
        vscode.window.showInformationMessage('SCORPION: Workspace is secure. No issues found.');
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`SCORPION Scan failed: ${error.message}`);
    }
  });
}
