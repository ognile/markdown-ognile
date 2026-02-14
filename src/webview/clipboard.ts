import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import TurndownService from 'turndown';
import { sendSaveImage, sendShowError, onSaveImageResult } from './sync';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Add table support to turndown
turndown.addRule('table', {
  filter: 'table',
  replacement(_content, node) {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const parseRow = (row: HTMLTableRowElement): string[] => {
      return Array.from(row.querySelectorAll('td, th')).map(
        (cell) => (cell.textContent || '').trim().replace(/\|/g, '\\|')
      );
    };

    const headerRow = parseRow(rows[0] as HTMLTableRowElement);
    const separator = headerRow.map(() => '---');
    const bodyRows = rows.slice(1).map((r) => parseRow(r as HTMLTableRowElement));

    const lines = [
      '| ' + headerRow.join(' | ') + ' |',
      '| ' + separator.join(' | ') + ' |',
      ...bodyRows.map((r) => '| ' + r.join(' | ') + ' |'),
    ];

    return '\n\n' + lines.join('\n') + '\n\n';
  },
});

/**
 * CM6 extension that handles smart paste (HTML→Markdown conversion, image paste).
 * Uses EditorView.domEventHandlers so returning `true` prevents CM6's own paste
 * handling — fixing the double-paste bug that occurred with a raw DOM listener.
 */
export const clipboardExtension: Extension = EditorView.domEventHandlers({
  paste(e: ClipboardEvent, view: EditorView) {
    const clipboard = e.clipboardData;
    if (!clipboard) return false;

    // Check for image data first
    const imageFile = Array.from(clipboard.files).find((f) => f.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      handleImagePaste(view, imageFile);
      return true;
    }

    // Check for HTML content (from Google Docs, browsers, etc.)
    const html = clipboard.getData('text/html');
    const plain = clipboard.getData('text/plain');

    if (html && plain) {
      // Check if the plain text is already markdown-like (skip conversion)
      if (looksLikeMarkdown(plain)) return false; // Let CM6 handle it normally

      e.preventDefault();
      const md = turndown.turndown(html);
      insertText(view, md);
      return true;
    }

    // Otherwise let CM6 handle it (plain text paste)
    return false;
  },
});

function looksLikeMarkdown(text: string): boolean {
  // If it has markdown syntax patterns, it's probably already markdown
  return /^#{1,6}\s|^\s*[-*+]\s|\*\*.*\*\*|__.*__|```/.test(text);
}

function handleImagePaste(view: EditorView, file: File) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

  file.arrayBuffer().then((buffer) => {
    const data = Array.from(new Uint8Array(buffer));
    sendSaveImage(data, filename);

    // Wait for result
    onSaveImageResult((success, relativePath, error) => {
      if (success && relativePath) {
        insertText(view, `![](${relativePath})`);
      } else {
        sendShowError(`Failed to save image: ${error || 'unknown error'}`);
      }
    });
  });
}

function insertText(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

export function copyAsRichText(view: EditorView) {
  const { from, to } = view.state.selection.main;
  if (from === to) return; // Nothing selected

  const rawMd = view.state.sliceDoc(from, to);
  const html = markdownToHtml(rawMd);

  navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([rawMd], { type: 'text/plain' }),
    }),
  ]).catch(() => {
    // Fallback: just copy plain text
    navigator.clipboard.writeText(rawMd);
  });
}

function markdownToHtml(md: string): string {
  // Simple markdown → HTML for rich copy
  let html = md;

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Line breaks → paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  return html;
}
