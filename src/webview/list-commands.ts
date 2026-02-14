import type { EditorView, KeyBinding } from '@codemirror/view';

function isListLine(lineText: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s/.test(lineText);
}

function indentListItem(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!isListLine(state.doc.lineAt(main.head).text)) return false;

  const tabSize = state.tabSize;
  const indent = ' '.repeat(tabSize);
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      const line = state.doc.line(lineNum);
      if (isListLine(line.text)) {
        changes.push({ from: line.from, to: line.from, insert: indent });
      }
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}

function outdentListItem(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (!isListLine(state.doc.lineAt(main.head).text)) return false;

  const tabSize = state.tabSize;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      const line = state.doc.line(lineNum);
      const match = line.text.match(/^(\s+)/);
      if (match) {
        const removeCount = Math.min(tabSize, match[1].length);
        changes.push({ from: line.from, to: line.from + removeCount, insert: '' });
      }
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}

function smartEnter(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;

  // Only handle single cursor, not selection
  if (main.from !== main.to) return false;

  const line = state.doc.lineAt(main.head);

  // Match task list: "  - [ ] " or "  - [x] "
  const taskMatch = line.text.match(/^(\s*)([-*+])\s\[[ x]\]\s(.*)/);
  if (taskMatch) {
    const [, indent, marker, content] = taskMatch;
    if (content.trim() === '') {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: { anchor: line.from },
        userEvent: 'input',
      });
      return true;
    }
    const insertion = `\n${indent}${marker} [ ] `;
    view.dispatch({
      changes: { from: main.head, to: main.head, insert: insertion },
      selection: { anchor: main.head + insertion.length },
      userEvent: 'input',
    });
    return true;
  }

  // Match bullet list: "  - ", "  * ", "  + "
  const bulletMatch = line.text.match(/^(\s*)([-*+])\s(.*)/);
  if (bulletMatch) {
    const [, indent, marker, content] = bulletMatch;
    if (content.trim() === '') {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: { anchor: line.from },
        userEvent: 'input',
      });
      return true;
    }
    const insertion = `\n${indent}${marker} `;
    view.dispatch({
      changes: { from: main.head, to: main.head, insert: insertion },
      selection: { anchor: main.head + insertion.length },
      userEvent: 'input',
    });
    return true;
  }

  // Match ordered list: "  1. "
  const orderedMatch = line.text.match(/^(\s*)(\d+)\.\s(.*)/);
  if (orderedMatch) {
    const [, indent, numStr, content] = orderedMatch;
    if (content.trim() === '') {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: { anchor: line.from },
        userEvent: 'input',
      });
      return true;
    }
    const nextNum = parseInt(numStr, 10) + 1;
    const insertion = `\n${indent}${nextNum}. `;
    view.dispatch({
      changes: { from: main.head, to: main.head, insert: insertion },
      selection: { anchor: main.head + insertion.length },
      userEvent: 'input',
    });
    return true;
  }

  return false;
}

export const listKeymap: KeyBinding[] = [
  { key: 'Tab', run: indentListItem },
  { key: 'Shift-Tab', run: outdentListItem },
  { key: 'Enter', run: smartEnter },
];
