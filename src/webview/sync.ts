import { EditorView } from '@codemirror/view';
import { MessageType } from '../messages';
import type { EditorSettings } from '../messages';
import type { CommandMessage } from '../messages';

declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

export const vscode = acquireVsCodeApi();

let editorView: EditorView | null = null;
let editTimer: ReturnType<typeof setTimeout> | null = null;
let ignoreNextUpdate = false;

export function setEditorView(view: EditorView) {
  editorView = view;
}

export function sendEdit(content: string) {
  if (editTimer) clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    vscode.postMessage({ type: MessageType.Edit, content });
  }, 100);
}

export function sendFocus() {
  vscode.postMessage({ type: MessageType.Focus });
}

export function sendBlur() {
  vscode.postMessage({ type: MessageType.Blur });
}

export function sendReady() {
  vscode.postMessage({ type: MessageType.Ready });
}

export function sendOpenExternal(url: string) {
  vscode.postMessage({ type: MessageType.OpenExternal, url });
}

export function sendOpenFile(path: string) {
  vscode.postMessage({ type: MessageType.OpenFile, path });
}

export function sendSaveImage(data: number[], filename: string) {
  vscode.postMessage({ type: MessageType.SaveImage, data, filename });
}

export function sendShowError(message: string) {
  vscode.postMessage({ type: MessageType.ShowError, message });
}

export function sendLinkInput() {
  vscode.postMessage({ type: MessageType.LinkInput });
}

export function setIgnoreNextUpdate(value: boolean) {
  ignoreNextUpdate = value;
}

export function getIgnoreNextUpdate(): boolean {
  return ignoreNextUpdate;
}

export type InitCallback = (content: string, settings: EditorSettings) => void;
export type UpdateCallback = (content: string) => void;
export type CommandCallback = (command: CommandMessage['command'], args?: string) => void;
export type SaveImageResultCallback = (success: boolean, relativePath?: string, error?: string) => void;
export type LinkInputResultCallback = (url: string | undefined) => void;
export type SettingsCallback = (settings: EditorSettings) => void;

const callbacks = {
  onInit: null as InitCallback | null,
  onUpdate: null as UpdateCallback | null,
  onCommand: null as CommandCallback | null,
  onSaveImageResult: null as SaveImageResultCallback | null,
  onLinkInputResult: null as LinkInputResultCallback | null,
  onSettings: null as SettingsCallback | null,
};

export function onInit(cb: InitCallback) { callbacks.onInit = cb; }
export function onUpdate(cb: UpdateCallback) { callbacks.onUpdate = cb; }
export function onCommand(cb: CommandCallback) { callbacks.onCommand = cb; }
export function onSaveImageResult(cb: SaveImageResultCallback) { callbacks.onSaveImageResult = cb; }
export function onLinkInputResult(cb: LinkInputResultCallback) { callbacks.onLinkInputResult = cb; }
export function onSettings(cb: SettingsCallback) { callbacks.onSettings = cb; }

window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case MessageType.Init:
      callbacks.onInit?.(message.content, message.settings);
      break;
    case MessageType.Update:
      callbacks.onUpdate?.(message.content);
      break;
    case MessageType.Command:
      callbacks.onCommand?.(message.command, message.args);
      break;
    case MessageType.SaveImageResult:
      callbacks.onSaveImageResult?.(message.success, message.relativePath, message.error);
      break;
    case MessageType.LinkInputResult:
      callbacks.onLinkInputResult?.(message.url);
      break;
    case MessageType.Settings:
      callbacks.onSettings?.(message.settings);
      break;
  }
});
