import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export function createTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: 'var(--ognile-font-size, 16px)',
      color: 'var(--vscode-editor-foreground)',
      backgroundColor: 'var(--vscode-editor-background)',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'var(--ognile-font-family, var(--vscode-editor-font-family, monospace))',
      lineHeight: 'var(--ognile-line-height, 1.7)',
      paddingTop: 'var(--ognile-content-pad-y, 24px)',
      paddingBottom: 'var(--ognile-content-pad-y, 24px)',
    },
    '.cm-content': {
      width: '100%',
      boxSizing: 'border-box',
      padding: '0 var(--ognile-content-gutter, 40px)',
      maxWidth: 'var(--ognile-content-max-width, 780px)',
      caretColor: 'var(--vscode-editorCursor-foreground)',
    },
    '.cm-focused': {
      outline: 'none',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--vscode-editorCursor-foreground)',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '.cm-placeholder': {
      color: 'var(--vscode-editorGhostText-foreground, rgba(128,128,128,0.5))',
      fontStyle: 'italic',
    },

    // Headings
    '.cm-heading-1': { fontSize: 'calc(2em * var(--ognile-typography-scale, 1))', fontWeight: '700', lineHeight: '1.2' },
    '.cm-heading-2': { fontSize: 'calc(1.5em * var(--ognile-typography-scale, 1))', fontWeight: '600', lineHeight: '1.25' },
    '.cm-heading-3': { fontSize: 'calc(1.25em * var(--ognile-typography-scale, 1))', fontWeight: '600', lineHeight: '1.3' },
    '.cm-heading-4': { fontSize: 'calc(1.1em * var(--ognile-typography-scale, 1))', fontWeight: '600' },
    '.cm-heading-5, .cm-heading-6': { fontSize: 'calc(1em * var(--ognile-typography-scale, 1))', fontWeight: '600' },

    // Inline styles
    '.cm-strong': { fontWeight: '700' },
    '.cm-emphasis': { fontStyle: 'italic' },
    '.cm-strikethrough': { textDecoration: 'line-through', opacity: '0.75' },
    '.cm-inline-code': {
      fontFamily: 'var(--vscode-editor-font-family, monospace)',
      fontSize: '0.9em',
      backgroundColor: 'var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15))',
      padding: '1px 4px',
      borderRadius: '3px',
    },

    // Links
    '.cm-link, .cm-wiki-link': {
      color: 'var(--vscode-textLink-foreground)',
      textDecoration: 'none',
      cursor: 'pointer',
    },
    '.cm-link:hover, .cm-wiki-link:hover': {
      textDecoration: 'underline',
    },

    // Block-level lines
    '.cm-blockquote': {
      borderLeft: '3px solid var(--vscode-textBlockQuote-border, #007acc)',
      paddingLeft: '12px',
      backgroundColor: 'var(--vscode-textBlockQuote-background, rgba(127,127,127,0.05))',
    },
    '.cm-code-block': {
      backgroundColor: 'var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1))',
      fontFamily: 'var(--vscode-editor-font-family, monospace)',
      fontSize: '0.9em',
    },

    // Widget visuals are in CSS to keep a single style authority.
  });
}
