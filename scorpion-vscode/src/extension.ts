import * as vscode from 'vscode';
import { ScorpionClient } from './scorpionClient';
import { DiagnosticProvider } from './diagnosticProvider';
import { SidebarProvider } from './sidebarProvider';
import { scanWorkspace } from './commands/scanWorkspace';
import { fixWithAI } from './commands/fixWithAI';

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
    diagnostics
  );

  // Auto-scan on file save (optional, can be noisy)
  const onSave = vscode.workspace.onDidSaveTextDocument(() => {
    // Only scan if there are workspace folders
    if (vscode.workspace.workspaceFolders) {
        vscode.commands.executeCommand('scorpion.scanWorkspace');
    }
  });

  context.subscriptions.push(onSave);
}

export function deactivate() {}
