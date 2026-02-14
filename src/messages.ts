export enum MessageType {
  Init = 'init',
  Update = 'update',
  Edit = 'edit',
  Focus = 'focus',
  Blur = 'blur',
  Ready = 'ready',
  Command = 'command',
  OpenExternal = 'openExternal',
  OpenFile = 'openFile',
  SaveImage = 'saveImage',
  SaveImageResult = 'saveImageResult',
  ShowError = 'showError',
  LinkInput = 'linkInput',
  LinkInputResult = 'linkInputResult',
  GetSettings = 'getSettings',
  Settings = 'settings',
}

export interface InitMessage {
  type: MessageType.Init;
  content: string;
  settings: EditorSettings;
}

export interface UpdateMessage {
  type: MessageType.Update;
  content: string;
}

export interface EditMessage {
  type: MessageType.Edit;
  content: string;
}

export interface FocusMessage {
  type: MessageType.Focus;
}

export interface BlurMessage {
  type: MessageType.Blur;
}

export interface ReadyMessage {
  type: MessageType.Ready;
}

export interface CommandMessage {
  type: MessageType.Command;
  command: 'bold' | 'italic' | 'strikethrough' | 'link' | 'copyRich';
  args?: string;
}

export interface OpenExternalMessage {
  type: MessageType.OpenExternal;
  url: string;
}

export interface OpenFileMessage {
  type: MessageType.OpenFile;
  path: string;
}

export interface SaveImageMessage {
  type: MessageType.SaveImage;
  data: number[];
  filename: string;
}

export interface SaveImageResultMessage {
  type: MessageType.SaveImageResult;
  success: boolean;
  relativePath?: string;
  error?: string;
}

export interface ShowErrorMessage {
  type: MessageType.ShowError;
  message: string;
}

export interface LinkInputMessage {
  type: MessageType.LinkInput;
}

export interface LinkInputResultMessage {
  type: MessageType.LinkInputResult;
  url: string | undefined;
}

export interface GetSettingsMessage {
  type: MessageType.GetSettings;
}

export interface SettingsMessage {
  type: MessageType.Settings;
  settings: EditorSettings;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  shortcutsMode: 'hybrid' | 'hostOnly' | 'webviewOnly';
  emptySelectionBehavior: 'word' | 'markers';
  italicDelimiter: 'underscore' | 'asterisk';
  motionLevel: 'off' | 'subtle' | 'full';
  widgetDensity: 'comfortable' | 'compact';
  typographyScale: number;
}

export type HostMessage =
  | InitMessage
  | UpdateMessage
  | CommandMessage
  | SaveImageResultMessage
  | LinkInputResultMessage
  | SettingsMessage;

export type ClientMessage =
  | EditMessage
  | FocusMessage
  | BlurMessage
  | ReadyMessage
  | OpenExternalMessage
  | OpenFileMessage
  | SaveImageMessage
  | ShowErrorMessage
  | LinkInputMessage
  | GetSettingsMessage;
