import * as vscode from 'vscode';
import { ScorpionClient, Finding } from '../scorpionClient';

export async function fixWithAI(client: ScorpionClient, finding: Finding) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `SCORPION: Generating AI fix for "${finding.title}"...`,
    cancellable: false
  }, async () => {
    try {
      const fix = await client.fixWithAI(finding);

      // Open a diff view: current file vs AI-fixed version
      const doc = await vscode.workspace.openTextDocument(finding.file);
      const original = doc.getText();

      // Show fix in new tab for review
      const fixDoc = await vscode.workspace.openTextDocument({
        content: fix,
        language: doc.languageId
      });

      await vscode.commands.executeCommand('vscode.diff',
        doc.uri,
        fixDoc.uri,
        `SCORPION Fix: ${finding.title}`
      );

      // Ask user to apply
      const choice = await vscode.window.showInformationMessage(
        'AI fix ready. Apply to file?',
        'Apply Fix', 'Dismiss'
      );

      if (choice === 'Apply Fix') {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(original.length)
        );
        edit.replace(doc.uri, fullRange, fix);
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage('✅ Fix applied successfully');
      }

    } catch (err) {
      vscode.window.showErrorMessage(`SCORPION fix failed: ${err}`);
    }
  });
}
