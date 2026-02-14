import * as vscode from 'vscode';
import { OgnileEditorProvider } from './editor-provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new OgnileEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('ognile.editor', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.switchEditor', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

      if (activeTab?.input && (activeTab.input as any).viewType === 'ognile.editor') {
        const uri = (activeTab.input as any).uri as vscode.Uri;
        await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
      } else if (activeEditor) {
        await vscode.commands.executeCommand('vscode.openWith', activeEditor.document.uri, 'ognile.editor');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.bold', () => {
      provider.sendCommandToActiveWebview('bold');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.italic', () => {
      provider.sendCommandToActiveWebview('italic');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.strikethrough', () => {
      provider.sendCommandToActiveWebview('strikethrough');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.link', async () => {
      provider.sendCommandToActiveWebview('link');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ognile.copyRich', () => {
      provider.sendCommandToActiveWebview('copyRich');
    })
  );
}

export function deactivate() {}
