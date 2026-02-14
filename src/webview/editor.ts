import { EditorState, Annotation } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { createTheme } from './theme';
import { sendEdit } from './sync';
import { decorationField } from './decorations/index';
import { listKeymap } from './list-commands';
import { floatingToolbar } from './floating-toolbar';
import { wordCountPlugin } from './word-count';
import { createSlashCommands } from './slash-commands';
import { createFindReplace } from './find-replace';
import { clipboardExtension } from './clipboard';
import type { EditorSettings } from '../messages';

// Annotation to mark cursor-adjustment transactions (prevents re-adjustment loops)
const cursorAdjust = Annotation.define<boolean>();

/**
 * Fix: cursor jumps into heading prefix (###) on click.
 *
 * When ### is hidden via Decoration.replace and the user clicks on the
 * visible heading text, the click resolves correctly. But the decoration
 * rebuild reveals ###, shifting the text right. A tiny mousemove during
 * the click then re-resolves the same (x,y) coordinates against the NEW
 * layout, landing the cursor inside the ### prefix.
 *
 * This listener detects when a pointer selection lands inside a heading
 * prefix and nudges the cursor past it.
 */
const cursorRevealFix = EditorView.updateListener.of((update) => {
  if (update.docChanged || !update.selectionSet) return;

  // Don't re-adjust our own adjustment
  for (const tr of update.transactions) {
    if (tr.annotation(cursorAdjust)) return;
  }

  // Only adjust for pointer (mouse) selections
  let isPointer = false;
  for (const tr of update.transactions) {
    if (tr.isUserEvent('select.pointer')) { isPointer = true; break; }
  }
  if (!isPointer) return;

  const sel = update.state.selection.main;
  if (sel.from !== sel.to) return; // Only adjust cursor, not selection ranges

  const line = update.state.doc.lineAt(sel.from);
  const hashMatch = line.text.match(/^(#{1,6})\s/);
  if (!hashMatch) return;

  const prefixLen = hashMatch[0].length;

  // If cursor landed inside the heading prefix, nudge it past the prefix
  if (sel.from < line.from + prefixLen) {
    update.view.dispatch({
      selection: { anchor: line.from + prefixLen },
      annotations: cursorAdjust.of(true),
    });
  }
});

export function applyEditorSettings(settings: EditorSettings) {
  document.documentElement.style.setProperty('--ognile-font-family', settings.fontFamily);
  document.documentElement.style.setProperty('--ognile-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--ognile-line-height', String(settings.lineHeight));
  document.documentElement.style.setProperty('--ognile-typography-scale', String(settings.typographyScale));

  document.body.setAttribute('data-ognile-motion', settings.motionLevel);
  document.body.setAttribute('data-ognile-density', settings.widgetDensity);
}

export function createEditor(
  parent: HTMLElement,
  content: string,
  settings: EditorSettings
): EditorView {
  applyEditorSettings(settings);

  const state = EditorState.create({
    doc: content,
    extensions: [
      // Core
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),

      // Markdown language with GFM
      markdown({ extensions: [GFM] }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),

      // Theme
      createTheme(),

      // Live preview decorations (unified StateField for all decorations)
      decorationField,

      // Fix cursor landing in heading prefix on click
      cursorRevealFix,

      // Floating toolbar on text selection
      floatingToolbar,

      // Slash commands (/ menu)
      createSlashCommands(),

      // Find & Replace
      createFindReplace(),

      // Word count status bar
      wordCountPlugin,

      // Smart paste (HTML→Markdown, image paste)
      clipboardExtension,

      // Line wrapping
      EditorView.lineWrapping,

      // Placeholder
      placeholder('Start writing...'),

      // Tab size
      EditorState.tabSize.of(settings.tabSize),

      // Keymaps — list commands first (fall through to defaults when not on a list line)
      keymap.of([
        ...listKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),

      // Sync edits to extension host
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          sendEdit(update.state.doc.toString());
        }
      }),
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  return view;
}

export function updateEditorContent(view: EditorView, content: string) {
  const currentContent = view.state.doc.toString();
  if (currentContent === content) return;

  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: content,
    },
  });
}
