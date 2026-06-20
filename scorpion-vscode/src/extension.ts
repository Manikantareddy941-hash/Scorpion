import * as vscode from 'vscode';
import { ScorpionClient } from './scorpionClient';
import { DiagnosticProvider } from './diagnosticProvider';
import { SidebarProvider } from './sidebarProvider';
import { scanWorkspace } from './commands/scanWorkspace';
import { fixWithAI } from './commands/fixWithAI';
import { scanFileForSecrets, isGitleaksAvailable } from './localGitleaks';
import { installPreCommitHook, uninstallPreCommitHook, isPreCommitHookInstalled } from './preCommitHook';

export function activate(context: vscode.ExtensionContext) {
  console.log('SCORPION Security extension is now active');

  const client = new ScorpionClient();
  const diagnostics = vscode.languages.createDiagnosticCollection('scorpion');
  const diagnosticProvider = new DiagnosticProvider(diagnostics);
  const sidebarProvider = new SidebarProvider(client);

  // Register sidebar
  vscode.window.registerTreeDataProvider('scorpion.findings', sidebarProvider);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('scorpion.scanWorkspace',
      () => scanWorkspace(client, diagnosticProvider, sidebarProvider)
    ),
    vscode.commands.registerCommand('scorpion.fixWithAI',
      (finding) => fixWithAI(client, finding)
    ),
    vscode.commands.registerCommand('scorpion.installPreCommitHook', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      const result = installPreCommitHook(root);
      if (result.installed) {
        vscode.window.showInformationMessage('SCORPION: Pre-commit secret-scan hook installed (runs gitleaks protect --staged before every commit).');
      } else {
        vscode.window.showErrorMessage(`SCORPION: Could not install pre-commit hook - ${result.reason}`);
      }
    }),
    vscode.commands.registerCommand('scorpion.uninstallPreCommitHook', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      const result = uninstallPreCommitHook(root);
      if (result.uninstalled) {
        vscode.window.showInformationMessage('SCORPION: Pre-commit hook removed.');
      } else {
        vscode.window.showWarningMessage(`SCORPION: ${result.reason}`);
      }
    }),
    diagnostics
  );

  // One-time nudge to install the pre-commit hook, if this looks like a fresh git repo without one.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && !isPreCommitHookInstalled(root) && isGitleaksAvailable()) {
    vscode.window.showInformationMessage(
      'SCORPION: Install a pre-commit hook to block commits containing secrets?',
      'Install', 'Not now'
    ).then(choice => {
      if (choice === 'Install') {
        vscode.commands.executeCommand('scorpion.installPreCommitHook');
      }
    });
  }

  // Lightweight local secret scan on save - NOT the full Semgrep/Trivy/Gitleaks
  // pipeline (that runs in Docker via the backend and is too slow to run on
  // every save). Only flags the file that was just saved; a full scan still
  // requires the "SCORPION: Scan Workspace" command.
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file' || !isGitleaksAvailable()) {
      return;
    }
    const findings = scanFileForSecrets(doc.uri.fsPath);
    diagnosticProvider.updateForFile(doc.uri.fsPath, findings);
    if (findings.length > 0) {
      vscode.window.showWarningMessage(`SCORPION: Potential secret detected in ${doc.fileName.split(/[\\/]/).pop()}`);
    }
  });

  context.subscriptions.push(onSave);
}

export function deactivate() {}
