import * as vscode from 'vscode';
import { ScorpionClient, Finding } from './scorpionClient';

export class SidebarProvider implements vscode.TreeDataProvider<FindingItem> {
  private _findings: Finding[] = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private client: ScorpionClient) {}

  refresh(findings: Finding[]) {
    this._findings = findings;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: FindingItem): vscode.TreeItem {
    return item;
  }

  getChildren(): FindingItem[] {
    if (!this._findings.length) {
      return [new FindingItem('No findings — workspace is clean ✅', '', vscode.TreeItemCollapsibleState.None)];
    }

    return this._findings.map(f =>
      new FindingItem(
        `${this.severityIcon(f.severity)} ${f.title}`,
        `${vscode.workspace.asRelativePath(f.file)}:${f.line}`,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'scorpion.fixWithAI',
          title: 'Fix with AI',
          arguments: [f]
        }
      )
    );
  }

  private severityIcon(s: string): string {
    const map: Record<string, string> = {
      CRITICAL: '🔴',
      HIGH: '🟠',
      MEDIUM: '🟡',
      LOW: '🔵'
    };
    return map[s] || '⚪';
  }
}

class FindingItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = `${label}\n${description}`;
    
    if (command) {
        this.contextValue = 'finding';
    }
  }
}
