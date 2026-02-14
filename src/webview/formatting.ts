import { ChangeSet, EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type FormatCommand = 'bold' | 'italic' | 'strikethrough' | 'link';

export interface FormattingPreferences {
  emptySelectionBehavior: 'word' | 'markers';
  italicDelimiter: 'underscore' | 'asterisk';
}

export interface FormattingOptions {
  linkUrl?: string;
  linkText?: string;
}

export interface TextSelection {
  from: number;
  to: number;
}

interface TextFormatResult {
  text: string;
  selection: TextSelection;
  changed: boolean;
  change?: {
    from: number;
    to: number;
    insert: string;
  };
}

const WORD_CHAR = /[A-Za-z0-9_]/;

function isWordChar(char: string | undefined): boolean {
  return !!char && WORD_CHAR.test(char);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSelection(selection: TextSelection, maxLength: number): TextSelection {
  const from = clamp(selection.from, 0, maxLength);
  const to = clamp(selection.to, 0, maxLength);
  if (from <= to) return { from, to };
  return { from: to, to: from };
}

function replaceRange(text: string, from: number, to: number, replacement: string): string {
  return text.slice(0, from) + replacement + text.slice(to);
}

function expandSelectionToWord(text: string, pos: number): TextSelection | null {
  if (text.length === 0) return null;

  let pivot = clamp(pos, 0, text.length);
  if (pivot < text.length && isWordChar(text[pivot])) {
    // Keep pivot.
  } else if (pivot > 0 && isWordChar(text[pivot - 1])) {
    pivot -= 1;
  } else {
    return null;
  }

  let from = pivot;
  let to = pivot + 1;

  while (from > 0 && isWordChar(text[from - 1])) from -= 1;
  while (to < text.length && isWordChar(text[to])) to += 1;

  return { from, to };
}

function resolveTargetSelection(
  text: string,
  selection: TextSelection,
  preferences: FormattingPreferences
): TextSelection {
  const normalized = normalizeSelection(selection, text.length);
  if (normalized.from !== normalized.to) return normalized;

  if (preferences.emptySelectionBehavior === 'word') {
    return expandSelectionToWord(text, normalized.from) ?? normalized;
  }

  return normalized;
}

function isWrappedSelection(selected: string, marker: string): boolean {
  if (selected.length < marker.length * 2) return false;
  if (!selected.startsWith(marker) || !selected.endsWith(marker)) return false;

  if (marker.length === 1) {
    const repeated = marker + marker;
    if (selected.startsWith(repeated) || selected.endsWith(repeated)) return false;
  }

  return true;
}

function hasSurroundingMarkers(text: string, from: number, to: number, marker: string): boolean {
  if (from < marker.length || to + marker.length > text.length) return false;

  const before = text.slice(from - marker.length, from);
  const after = text.slice(to, to + marker.length);
  if (before !== marker || after !== marker) return false;

  if (marker.length === 1) {
    const beforeBefore = text[from - marker.length - 1];
    const afterAfter = text[to + marker.length];
    if (beforeBefore === marker || afterAfter === marker) return false;
  }

  return true;
}

function formatMarker(
  text: string,
  selection: TextSelection,
  marker: string,
  preferences: FormattingPreferences
): TextFormatResult {
  const target = resolveTargetSelection(text, selection, preferences);
  const selected = text.slice(target.from, target.to);

  if (target.from === target.to) {
    const insertion = marker + marker;
    const updated = replaceRange(text, target.from, target.to, insertion);
    const caret = target.from + marker.length;
    return {
      text: updated,
      selection: { from: caret, to: caret },
      changed: updated !== text,
      change: {
        from: target.from,
        to: target.to,
        insert: insertion,
      },
    };
  }

  if (isWrappedSelection(selected, marker)) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    const updated = replaceRange(text, target.from, target.to, inner);
    return {
      text: updated,
      selection: { from: target.from, to: target.from + inner.length },
      changed: updated !== text,
      change: {
        from: target.from,
        to: target.to,
        insert: inner,
      },
    };
  }

  if (hasSurroundingMarkers(text, target.from, target.to, marker)) {
    const start = target.from - marker.length;
    const end = target.to + marker.length;
    const updated = replaceRange(text, start, end, selected);
    return {
      text: updated,
      selection: { from: start, to: start + selected.length },
      changed: updated !== text,
      change: {
        from: start,
        to: end,
        insert: selected,
      },
    };
  }

  const wrapped = marker + selected + marker;
  const updated = replaceRange(text, target.from, target.to, wrapped);
  return {
    text: updated,
    selection: {
      from: target.from + marker.length,
      to: target.to + marker.length,
    },
    changed: updated !== text,
    change: {
      from: target.from,
      to: target.to,
      insert: wrapped,
    },
  };
}

function tryUnwrapFullLink(selectionText: string): string | null {
  const full = selectionText.match(/^\[([^\]]+)\]\(([^\n)]+)\)$/);
  if (!full) return null;
  return full[1];
}

function tryUnwrapLinkAroundSelection(text: string, selection: TextSelection): TextFormatResult | null {
  if (selection.from === 0 || text[selection.from - 1] !== '[') return null;
  const labelEnd = text.indexOf('](', selection.to);
  if (labelEnd !== selection.to) return null;
  const urlEnd = text.indexOf(')', labelEnd + 2);
  if (urlEnd === -1) return null;

  const label = text.slice(selection.from, selection.to);
  const updated = replaceRange(text, selection.from - 1, urlEnd + 1, label);
  return {
    text: updated,
    selection: { from: selection.from - 1, to: selection.from - 1 + label.length },
    changed: updated !== text,
    change: {
      from: selection.from - 1,
      to: urlEnd + 1,
      insert: label,
    },
  };
}

function formatLink(
  text: string,
  selection: TextSelection,
  preferences: FormattingPreferences,
  options: FormattingOptions
): TextFormatResult {
  const target = resolveTargetSelection(text, selection, preferences);
  const selected = text.slice(target.from, target.to);

  const fullyWrapped = tryUnwrapFullLink(selected);
  if (fullyWrapped !== null) {
    const updated = replaceRange(text, target.from, target.to, fullyWrapped);
    return {
      text: updated,
      selection: {
        from: target.from,
        to: target.from + fullyWrapped.length,
      },
      changed: updated !== text,
      change: {
        from: target.from,
        to: target.to,
        insert: fullyWrapped,
      },
    };
  }

  const surrounding = tryUnwrapLinkAroundSelection(text, target);
  if (surrounding) return surrounding;

  const url = options.linkUrl ?? 'https://';
  if (target.from === target.to) {
    const label = options.linkText ?? 'link text';
    const markdown = `[${label}](${url})`;
    const updated = replaceRange(text, target.from, target.to, markdown);
    return {
      text: updated,
      selection: {
        from: target.from + 1,
        to: target.from + 1 + label.length,
      },
      changed: updated !== text,
      change: {
        from: target.from,
        to: target.to,
        insert: markdown,
      },
    };
  }

  const markdown = `[${selected}](${url})`;
  const updated = replaceRange(text, target.from, target.to, markdown);
  return {
    text: updated,
    selection: {
      from: target.from + 1,
      to: target.from + 1 + selected.length,
    },
    changed: updated !== text,
    change: {
      from: target.from,
      to: target.to,
      insert: markdown,
    },
  };
}

export function applyCommandToText(
  text: string,
  selection: TextSelection,
  command: FormatCommand,
  preferences: FormattingPreferences,
  options: FormattingOptions = {}
): TextFormatResult {
  switch (command) {
    case 'bold':
      return formatMarker(text, selection, '**', preferences);
    case 'italic': {
      const italicMarker = preferences.italicDelimiter === 'underscore' ? '_' : '*';
      return formatMarker(text, selection, italicMarker, preferences);
    }
    case 'strikethrough':
      return formatMarker(text, selection, '~~', preferences);
    case 'link':
      return formatLink(text, selection, preferences, options);
  }
}

export function applyFormattingToEditor(
  view: EditorView,
  command: FormatCommand,
  preferences: FormattingPreferences,
  options: FormattingOptions = {}
): boolean {
  let nextText = view.state.doc.toString();
  const textLength = view.state.doc.length;

  const ranges = view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }));
  const order = ranges
    .map((range, index) => ({ ...range, index }))
    .sort((a, b) => {
      if (a.from !== b.from) return b.from - a.from;
      return b.to - a.to;
    });

  const processedIndices: number[] = [];
  const changes: { from: number; to: number; insert: string }[] = [];
  let hasDocumentChange = false;
  let overlapGuard = Number.MAX_SAFE_INTEGER;

  for (const entry of order) {
    const current = ranges[entry.index];
    if (current.to > overlapGuard) continue;

    const beforeText = nextText;
    const result = applyCommandToText(beforeText, current, command, preferences, options);
    nextText = result.text;
    ranges[entry.index] = result.selection;

    if (result.changed && result.change) {
      const map = ChangeSet.of([result.change], beforeText.length);
      for (const processedIndex of processedIndices) {
        const processed = ranges[processedIndex];
        ranges[processedIndex] = {
          from: map.mapPos(processed.from, -1),
          to: map.mapPos(processed.to, 1),
        };
      }

      changes.push(result.change);
      hasDocumentChange = true;
    }

    processedIndices.push(entry.index);
    overlapGuard = Math.min(overlapGuard, result.change ? result.change.from : current.from);
  }

  if (!hasDocumentChange) return false;

  const nextSelection = EditorSelection.create(
    ranges.map((range) => EditorSelection.range(range.from, range.to)),
    view.state.selection.mainIndex
  );

  const changeSet = ChangeSet.of(
    changes
      .slice()
      .sort((a, b) => a.from - b.from || a.to - b.to)
      .map((change) => ({ from: change.from, to: change.to, insert: change.insert })),
    textLength
  );

  const scrollTopBefore = view.scrollDOM.scrollTop;
  const scrollLeftBefore = view.scrollDOM.scrollLeft;

  view.dispatch({
    changes: changeSet,
    selection: nextSelection,
    userEvent: 'input',
  });

  requestAnimationFrame(() => {
    const topDrift = Math.abs(view.scrollDOM.scrollTop - scrollTopBefore);
    const leftDrift = Math.abs(view.scrollDOM.scrollLeft - scrollLeftBefore);
    if (topDrift > 2 || leftDrift > 2) {
      view.scrollDOM.scrollTop = scrollTopBefore;
      view.scrollDOM.scrollLeft = scrollLeftBefore;
    }
  });

  return true;
}

function getSelectionOffsetsInElement(element: HTMLElement): TextSelection {
  const textLength = element.textContent?.length ?? 0;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { from: textLength, to: textLength };
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return { from: textLength, to: textLength };
  }

  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(element);
  beforeStart.setEnd(range.startContainer, range.startOffset);

  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(element);
  beforeEnd.setEnd(range.endContainer, range.endOffset);

  const from = beforeStart.toString().length;
  const to = beforeEnd.toString().length;
  if (from <= to) return { from, to };
  return { from: to, to: from };
}

function resolveTextNodeAtOffset(root: HTMLElement, offset: number): { node: Text; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.textContent?.length ?? 0;
    if (offset <= traversed + length) {
      return { node, offset: offset - traversed };
    }
    traversed += length;
  }

  if (!root.firstChild) {
    const node = document.createTextNode('');
    root.appendChild(node);
    return { node, offset: 0 };
  }

  const fallback = root.lastChild;
  if (fallback && fallback.nodeType === Node.TEXT_NODE) {
    const node = fallback as Text;
    return { node, offset: node.textContent?.length ?? 0 };
  }

  const node = document.createTextNode('');
  root.appendChild(node);
  return { node, offset: 0 };
}

function setSelectionOffsetsInElement(element: HTMLElement, from: number, to: number): void {
  const normalized = normalizeSelection({ from, to }, element.textContent?.length ?? 0);
  const start = resolveTextNodeAtOffset(element, normalized.from);
  const end = resolveTextNodeAtOffset(element, normalized.to);

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

export function getActiveTableCell(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return null;

  if (
    (active.matches('td[contenteditable="true"], th[contenteditable="true"]') &&
      !!active.closest('.cm-table-widget'))
  ) {
    return active;
  }

  const closest = active.closest('td[contenteditable="true"], th[contenteditable="true"]');
  if (!closest || !(closest instanceof HTMLElement)) return null;
  if (!closest.closest('.cm-table-widget')) return null;

  return closest;
}

export function applyFormattingToActiveTableCell(
  command: FormatCommand,
  preferences: FormattingPreferences,
  options: FormattingOptions = {}
): boolean {
  const cell = getActiveTableCell();
  if (!cell) return false;

  const originalText = cell.textContent ?? '';
  const selection = getSelectionOffsetsInElement(cell);
  const result = applyCommandToText(originalText, selection, command, preferences, options);

  if (!result.changed) return true;

  cell.textContent = result.text;
  setSelectionOffsetsInElement(cell, result.selection.from, result.selection.to);
  cell.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
}

function isMac(): boolean {
  const platform = navigator.platform || '';
  return /Mac|iPod|iPhone|iPad/.test(platform);
}

function hasPrimaryModifier(event: KeyboardEvent): boolean {
  if (isMac()) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey;
}

export function commandFromKeyboardEvent(event: KeyboardEvent): FormatCommand | null {
  if (!hasPrimaryModifier(event) || event.altKey) return null;

  const key = event.key.toLowerCase();
  if (!event.shiftKey && key === 'b') return 'bold';
  if (!event.shiftKey && key === 'i') return 'italic';
  if (!event.shiftKey && key === 'k') return 'link';
  if (event.shiftKey && key === 'x') return 'strikethrough';

  return null;
}

export function isFormatCommand(command: string): command is FormatCommand {
  return command === 'bold' || command === 'italic' || command === 'strikethrough' || command === 'link';
}
