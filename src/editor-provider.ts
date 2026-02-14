import * as vscode from 'vscode';
import { MessageType, EditorSettings } from './messages';
import type { ClientMessage, HostMessage } from './messages';

type HostCommand = 'bold' | 'italic' | 'strikethrough' | 'link' | 'copyRich';

export class OgnileEditorProvider implements vscode.CustomTextEditorProvider {
  private activeWebview: vscode.WebviewPanel | null = null;
  private webviewPanels = new Set<vscode.WebviewPanel>();
  private focusedWebviews = new Map<vscode.WebviewPanel, boolean>();
  private updateTimers = new Map<vscode.WebviewPanel, ReturnType<typeof setTimeout>>();
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEdit: string | null = null;
  private isApplyingEdit = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.updateShortcutContext();

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('editor') && !e.affectsConfiguration('ognile')) return;
        this.updateShortcutContext();
        this.broadcastSettings();
      })
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviewPanels.add(webviewPanel);
    this.focusedWebviews.set(webviewPanel, false);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(document.uri, '..'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (this.isApplyingEdit) return;

      const isFocused = this.focusedWebviews.get(webviewPanel) ?? false;
      if (isFocused) return;

      const existing = this.updateTimers.get(webviewPanel);
      if (existing) clearTimeout(existing);

      this.updateTimers.set(
        webviewPanel,
        setTimeout(() => {
          this.postMessage(webviewPanel, {
            type: MessageType.Update,
            content: document.getText(),
          });
        }, 300)
      );
    });

    webviewPanel.webview.onDidReceiveMessage((message: ClientMessage) => {
      switch (message.type) {
        case MessageType.Ready:
          this.postMessage(webviewPanel, {
            type: MessageType.Init,
            content: document.getText(),
            settings: this.getEditorSettings(),
          });
          break;

        case MessageType.Edit:
          this.handleEdit(document, message.content);
          break;

        case MessageType.Focus:
          this.focusedWebviews.set(webviewPanel, true);
          this.activeWebview = webviewPanel;
          vscode.commands.executeCommand('setContext', 'ognile.active', true);
          this.updateShortcutContext();
          break;

        case MessageType.Blur:
          this.focusedWebviews.set(webviewPanel, false);
          if (this.activeWebview === webviewPanel) {
            vscode.commands.executeCommand('setContext', 'ognile.active', false);
          }
          break;

        case MessageType.OpenExternal:
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case MessageType.OpenFile: {
          const dir = vscode.Uri.joinPath(document.uri, '..');
          const fileUri = vscode.Uri.joinPath(dir, message.path + '.md');
          vscode.workspace.openTextDocument(fileUri).then(
            (doc) => vscode.window.showTextDocument(doc),
            () => vscode.window.showErrorMessage(`File not found: ${message.path}.md`)
          );
          break;
        }

        case MessageType.SaveImage: {
          const dir = vscode.Uri.joinPath(document.uri, '..');
          const assetsDir = vscode.Uri.joinPath(dir, 'assets');
          const fileUri = vscode.Uri.joinPath(assetsDir, message.filename);
          const data = new Uint8Array(message.data);

          vscode.workspace.fs.createDirectory(assetsDir).then(() =>
            vscode.workspace.fs.writeFile(fileUri, data).then(
              () => {
                this.postMessage(webviewPanel, {
                  type: MessageType.SaveImageResult,
                  success: true,
                  relativePath: `assets/${message.filename}`,
                });
              },
              (err) => {
                this.postMessage(webviewPanel, {
                  type: MessageType.SaveImageResult,
                  success: false,
                  error: String(err),
                });
              }
            )
          );
          break;
        }

        case MessageType.ShowError:
          vscode.window.showErrorMessage(message.message);
          break;

        case MessageType.LinkInput: {
          vscode.window.showInputBox({ prompt: 'Enter URL', placeHolder: 'https://' }).then((url) => {
            this.postMessage(webviewPanel, {
              type: MessageType.LinkInputResult,
              url,
            });
          });
          break;
        }

        case MessageType.GetSettings:
          this.postMessage(webviewPanel, {
            type: MessageType.Settings,
            settings: this.getEditorSettings(),
          });
          break;
      }
    });

    // Set ognile.active immediately — onDidChangeViewState only fires on
    // CHANGES, not for the initial state. Without this, the context key is
    // false when the editor first opens, and Cmd+B hits the built-in toggle sidebar.
    this.activeWebview = webviewPanel;
    vscode.commands.executeCommand('setContext', 'ognile.active', true);
    this.updateShortcutContext();

    // Track subsequent panel active/inactive transitions
    webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.activeWebview = webviewPanel;
        vscode.commands.executeCommand('setContext', 'ognile.active', true);
        this.updateShortcutContext();
      } else if (this.activeWebview === webviewPanel) {
        this.activeWebview = null;
        vscode.commands.executeCommand('setContext', 'ognile.active', false);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      this.webviewPanels.delete(webviewPanel);
      this.focusedWebviews.delete(webviewPanel);
      const timer = this.updateTimers.get(webviewPanel);
      if (timer) clearTimeout(timer);
      this.updateTimers.delete(webviewPanel);
      if (this.activeWebview === webviewPanel) {
        this.activeWebview = null;
        vscode.commands.executeCommand('setContext', 'ognile.active', false);
      }
    });
  }

  sendCommandToActiveWebview(command: HostCommand) {
    if (!this.activeWebview) return;
    this.postMessage(this.activeWebview, {
      type: MessageType.Command,
      command,
    });
  }

  private broadcastSettings() {
    const settings = this.getEditorSettings();
    for (const panel of this.webviewPanels) {
      this.postMessage(panel, {
        type: MessageType.Settings,
        settings,
      });
    }
  }

  private handleEdit(document: vscode.TextDocument, content: string) {
    this.pendingEdit = content;

    if (this.editTimer) clearTimeout(this.editTimer);

    this.editTimer = setTimeout(async () => {
      if (this.pendingEdit === null) return;
      const newContent = this.pendingEdit;
      this.pendingEdit = null;

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );

      this.isApplyingEdit = true;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, newContent);
      await vscode.workspace.applyEdit(edit);
      this.isApplyingEdit = false;
    }, 100);
  }

  private postMessage(panel: vscode.WebviewPanel, message: HostMessage) {
    panel.webview.postMessage(message);
  }

  private getEditorSettings(): EditorSettings {
    const editorConfig = vscode.workspace.getConfiguration('editor');
    const ognileConfig = vscode.workspace.getConfiguration('ognile');
    const rawScale = ognileConfig.get<number>('ui.typographyScale', 1);
    const typographyScale = Math.max(0.85, Math.min(1.35, rawScale));
    const fontSize = editorConfig.get<number>('fontSize', 14);
    const rawLineHeight = editorConfig.get<number>('lineHeight', 0);

    // VS Code returns 0 for auto line-height. Treat that as a sane multiplier.
    // If users provide pixel-based lineHeight, convert to a multiplier.
    let lineHeight = 1.6;
    if (rawLineHeight > 0 && rawLineHeight < 4) {
      lineHeight = rawLineHeight;
    } else if (rawLineHeight >= 4) {
      lineHeight = rawLineHeight / Math.max(fontSize, 12);
    }
    lineHeight = Math.max(1.2, Math.min(2.4, lineHeight));

    return {
      fontFamily: editorConfig.get<string>('fontFamily', 'monospace'),
      fontSize,
      lineHeight,
      tabSize: editorConfig.get<number>('tabSize', 4),
      shortcutsMode: ognileConfig.get<'hybrid' | 'hostOnly' | 'webviewOnly'>('shortcuts.mode', 'hybrid'),
      emptySelectionBehavior: ognileConfig.get<'word' | 'markers'>('formatting.emptySelectionBehavior', 'word'),
      italicDelimiter: ognileConfig.get<'underscore' | 'asterisk'>('formatting.italicDelimiter', 'underscore'),
      motionLevel: ognileConfig.get<'off' | 'subtle' | 'full'>('ui.motionLevel', 'subtle'),
      widgetDensity: ognileConfig.get<'comfortable' | 'compact'>('ui.widgetDensity', 'comfortable'),
      typographyScale,
    };
  }

  private updateShortcutContext() {
    const mode = vscode.workspace.getConfiguration('ognile').get<'hybrid' | 'hostOnly' | 'webviewOnly'>(
      'shortcuts.mode',
      'hybrid'
    );
    vscode.commands.executeCommand('setContext', 'ognile.hostShortcutsEnabled', mode !== 'webviewOnly');
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.global.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'styles.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Markdown Ognile</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
