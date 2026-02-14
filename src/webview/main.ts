import { createEditor, updateEditorContent, applyEditorSettings } from './editor';
import {
  sendReady,
  sendOpenExternal,
  sendOpenFile,
  sendLinkInput,
  sendFocus,
  sendBlur,
  onInit,
  onUpdate,
  onCommand,
  onLinkInputResult,
  onSettings,
  setEditorView,
} from './sync';
import { setupClipboard, copyAsRichText } from './clipboard';
import {
  applyFormattingToEditor,
  commandFromKeyboardEvent,
  isFormatCommand,
  type FormatCommand,
  type FormattingPreferences,
} from './formatting';
import {
  setWidgetFormattingPreferences,
  setWidgetShortcutInterceptionEnabled,
  tryHandleTableWidgetCommand,
} from './decorations/index';
import { openFind, openFindReplace } from './find-replace';
import type { EditorView } from '@codemirror/view';
import type { EditorSettings } from '../messages';

let editorView: EditorView | null = null;
let editorSettings: EditorSettings | null = null;

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontFamily: 'monospace',
  fontSize: 14,
  lineHeight: 1.6,
  tabSize: 4,
  shortcutsMode: 'hybrid',
  emptySelectionBehavior: 'word',
  italicDelimiter: 'underscore',
  motionLevel: 'subtle',
  widgetDensity: 'comfortable',
  typographyScale: 1,
};

function normalizeSettings(settings: EditorSettings): EditorSettings {
  const input = settings as Partial<EditorSettings>;
  const rawLineHeight = Number(input.lineHeight);
  let lineHeight = Number.isFinite(rawLineHeight) ? rawLineHeight : DEFAULT_EDITOR_SETTINGS.lineHeight;
  if (lineHeight <= 0) {
    lineHeight = DEFAULT_EDITOR_SETTINGS.lineHeight;
  } else if (lineHeight >= 4) {
    const baseFont = Number(input.fontSize) || DEFAULT_EDITOR_SETTINGS.fontSize;
    lineHeight = lineHeight / Math.max(baseFont, 12);
  }
  lineHeight = Math.max(1.2, Math.min(2.4, lineHeight));

  const typographyScale = Number(input.typographyScale);
  const clampedScale = Number.isFinite(typographyScale)
    ? Math.max(0.85, Math.min(1.35, typographyScale))
    : DEFAULT_EDITOR_SETTINGS.typographyScale;

  return {
    ...DEFAULT_EDITOR_SETTINGS,
    ...input,
    lineHeight,
    typographyScale: clampedScale,
  };
}

function getFormattingPreferences(settings: EditorSettings): FormattingPreferences {
  return {
    emptySelectionBehavior: settings.emptySelectionBehavior ?? 'word',
    italicDelimiter: settings.italicDelimiter ?? 'underscore',
  };
}

function currentFormattingPreferences(): FormattingPreferences {
  return getFormattingPreferences(editorSettings ?? DEFAULT_EDITOR_SETTINGS);
}

function executeFormattingCommand(command: FormatCommand, linkUrl?: string): boolean {
  if (!editorView) return false;

  if (command === 'link' && !linkUrl) {
    sendLinkInput();
    return true;
  }

  const preferences = currentFormattingPreferences();

  if (tryHandleTableWidgetCommand(command, preferences, { linkUrl })) {
    return true;
  }

  return applyFormattingToEditor(editorView, command, preferences, { linkUrl });
}

function setupFocusTracking(view: EditorView) {
  view.dom.addEventListener('focusin', () => {
    sendFocus();
  });

  view.dom.addEventListener('focusout', (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && view.dom.contains(next)) return;
    sendBlur();
  });
}

function setupKeyboardRouting(view: EditorView) {
  view.dom.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!editorSettings) return;
    if (editorSettings.shortcutsMode === 'hostOnly') return;
    if (event.defaultPrevented) return;

    const active = document.activeElement as HTMLElement | null;
    if (active && active.matches('td[contenteditable="true"], th[contenteditable="true"]') && active.closest('.cm-table-widget')) {
      return;
    }

    // Find & Replace shortcuts — intercept before VS Code can steal them
    const isMeta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    // Cmd+F / Ctrl+F: Open Find
    if (isMeta && key === 'f' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      openFind(view);
      return;
    }

    // Cmd+Opt+F (Mac) / Ctrl+H (Win/Linux): Open Find & Replace
    const isMac = navigator.platform.includes('Mac');
    if ((isMeta && event.altKey && key === 'f') || (!isMac && isMeta && key === 'h')) {
      event.preventDefault();
      event.stopPropagation();
      openFindReplace(view);
      return;
    }

    const command = commandFromKeyboardEvent(event);
    if (!command) return;

    event.preventDefault();
    event.stopPropagation();
    executeFormattingCommand(command);
  }, true);

  view.dom.addEventListener('ognile:request-link', (event) => {
    event.preventDefault();
    sendLinkInput();
  });

  view.dom.addEventListener('ognile:format-command', (event: Event) => {
    const custom = event as CustomEvent<{ command?: FormatCommand }>;
    const command = custom.detail?.command;
    if (!command) return;
    event.preventDefault();
    executeFormattingCommand(command);
  });
}

function setupLinkClicks(view: EditorView) {
  // Handle Cmd/Ctrl+click on links
  view.dom.addEventListener('click', (e: MouseEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;

    const target = e.target as HTMLElement;

    // Standard links
    const link = target.closest('[data-url]') as HTMLElement | null;
    if (link) {
      e.preventDefault();
      sendOpenExternal(link.getAttribute('data-url')!);
      return;
    }

    // Wiki links
    const wikiLink = target.closest('[data-wiki-target]') as HTMLElement | null;
    if (wikiLink) {
      e.preventDefault();
      sendOpenFile(wikiLink.getAttribute('data-wiki-target')!);
    }
  });
}

onInit((content, settings) => {
  const initialSettings = normalizeSettings(settings);
  editorSettings = initialSettings;
  setWidgetFormattingPreferences(getFormattingPreferences(initialSettings));
  setWidgetShortcutInterceptionEnabled(initialSettings.shortcutsMode !== 'hostOnly');

  const app = document.getElementById('app')!;
  app.innerHTML = '';

  // Wait for next frame to ensure layout is computed
  requestAnimationFrame(() => {
    editorView = createEditor(app, content, initialSettings);
    setEditorView(editorView);
    setupClipboard(editorView);
    setupFocusTracking(editorView);
    setupKeyboardRouting(editorView);
    setupLinkClicks(editorView);
    (window as any).__editorView = editorView;
  });
});

onUpdate((content) => {
  if (editorView) {
    updateEditorContent(editorView, content);
  }
});

onSettings((settings) => {
  editorSettings = normalizeSettings(settings);
  setWidgetFormattingPreferences(getFormattingPreferences(editorSettings));
  setWidgetShortcutInterceptionEnabled(editorSettings.shortcutsMode !== 'hostOnly');
  applyEditorSettings(editorSettings);
});

onCommand((command, args) => {
  if (!editorView) return;

  if (isFormatCommand(command)) {
    executeFormattingCommand(command, args);
    return;
  }

  switch (command) {
    case 'copyRich':
      copyAsRichText(editorView);
      break;
  }
});

onLinkInputResult((url) => {
  if (url) {
    executeFormattingCommand('link', url);
  }
});

sendReady();
