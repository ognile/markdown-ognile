import { DecorationSet, Decoration, WidgetType, EditorView } from '@codemirror/view';
import { StateField, Annotation } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Range, EditorState } from '@codemirror/state';
import {
  applyFormattingToActiveTableCell,
  commandFromKeyboardEvent,
  type FormatCommand,
  type FormattingOptions,
  type FormattingPreferences,
} from '../formatting';

// Annotation to mark transactions from table cell edits
const tableEditAnnotation = Annotation.define<boolean>();

let widgetFormattingPreferences: FormattingPreferences = {
  emptySelectionBehavior: 'word',
  italicDelimiter: 'underscore',
};
let widgetShortcutInterceptionEnabled = true;

export function setWidgetFormattingPreferences(preferences: FormattingPreferences) {
  widgetFormattingPreferences = preferences;
}

export function setWidgetShortcutInterceptionEnabled(enabled: boolean) {
  widgetShortcutInterceptionEnabled = enabled;
}

export function tryHandleTableWidgetCommand(
  command: FormatCommand,
  preferences: FormattingPreferences = widgetFormattingPreferences,
  options: FormattingOptions = {}
): boolean {
  return applyFormattingToActiveTableCell(command, preferences, options);
}

// ========== Helpers ==========

function isRangeSelected(
  selectionRanges: readonly { from: number; to: number }[],
  from: number,
  to: number
): boolean {
  for (const range of selectionRanges) {
    const cursorPos = range.from;
    if (cursorPos >= from && cursorPos <= to) return true;
    if (range.from !== range.to) {
      const selFrom = Math.min(range.from, range.to);
      const selTo = Math.max(range.from, range.to);
      if (selFrom < to && selTo > from) return true;
    }
  }
  return false;
}

/**
 * Get the end position of a block node's actual content.
 *
 * lezer-markdown block nodes (Table, FencedCode, Blockquote, etc.) may
 * include the trailing newline in their `to` position, placing it at the
 * start of the NEXT line. `doc.lineAt(to)` then returns the wrong line,
 * causing decorations to leak onto the subsequent line — adding unwanted
 * styles (e.g. blockquote padding) or replacing extra content (e.g. table
 * widget eating the next line).
 *
 * This function detects when `to` falls exactly at a line boundary and
 * steps back to the end of the previous line, returning the position of
 * the last character that actually belongs to the block content.
 *
 * Use this for ALL block node `to` values before calling doc.lineAt()
 * or using `to` as a loop bound.
 */
function blockEnd(doc: EditorState['doc'], from: number, to: number): number {
  const safeTo = Math.min(to, doc.length);
  if (safeTo > from) {
    const line = doc.lineAt(safeTo);
    if (line.from === safeTo) {
      // `to` is exactly at the start of a line — it's past the trailing
      // newline of the block's last line. Step back.
      return safeTo - 1;
    }
  }
  return safeTo;
}

// ========== List depth helpers ==========

function getListNestingDepth(state: EditorState, pos: number): number {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos);
  let depth = 0;
  while (node.parent) {
    node = node.parent;
    if (node.name === 'BulletList' || node.name === 'OrderedList') {
      depth++;
    }
  }
  return Math.max(0, depth - 1);
}

function computeOrderedListLabel(state: EditorState, pos: number): string {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos);

  // Walk up to the ListItem containing this mark
  while (node && node.name !== 'ListItem') {
    node = node.parent;
  }
  if (!node) return '';

  const segments: number[] = [];
  let currentItem: SyntaxNode | null = node;

  while (currentItem) {
    const parentList = currentItem.parent;
    if (!parentList || (parentList.name !== 'OrderedList' && parentList.name !== 'BulletList')) break;

    if (parentList.name === 'OrderedList') {
      let index = 0;
      let sibling: SyntaxNode | null = parentList.firstChild;
      while (sibling) {
        if (sibling.name === 'ListItem') {
          index++;
          if (sibling.from === currentItem.from && sibling.to === currentItem.to) break;
        }
        sibling = sibling.nextSibling;
      }
      segments.unshift(index);
    } else {
      // Parent is BulletList — stop hierarchical numbering
      break;
    }

    const grandparentItem = parentList.parent;
    if (grandparentItem && grandparentItem.name === 'ListItem') {
      currentItem = grandparentItem;
    } else {
      break;
    }
  }

  return segments.join('.');
}

// ========== Decoration constants ==========

const hiddenReplace = Decoration.replace({});

const headingLineDecos: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: 'cm-heading-1' }),
  ATXHeading2: Decoration.line({ class: 'cm-heading-2' }),
  ATXHeading3: Decoration.line({ class: 'cm-heading-3' }),
  ATXHeading4: Decoration.line({ class: 'cm-heading-4' }),
  ATXHeading5: Decoration.line({ class: 'cm-heading-5' }),
  ATXHeading6: Decoration.line({ class: 'cm-heading-6' }),
};

const strongMark = Decoration.mark({ class: 'cm-strong' });
const emMark = Decoration.mark({ class: 'cm-emphasis' });
const strikeMark = Decoration.mark({ class: 'cm-strikethrough' });
const codeMark = Decoration.mark({ class: 'cm-inline-code' });
const blockquoteLine = Decoration.line({ class: 'cm-blockquote' });
const codeBlockLine = Decoration.line({ class: 'cm-code-block' });

// ========== Widget Classes ==========

class HrWidget extends WidgetType {
  toDOM() {
    // Wrapper with padding (not margin) — CM6 measures offsetHeight which
    // includes padding but excludes margin. Margin causes cumulative offset.
    const wrapper = document.createElement('div');
    wrapper.style.padding = '16px 0';
    const hr = document.createElement('hr');
    hr.className = 'cm-hr-widget';
    wrapper.appendChild(hr);
    return wrapper;
  }
  eq() { return true; }
  ignoreEvent() { return true; }
}

const BULLET_CHARS = ['\u25CF', '\u25CB', '\u25AA', '\u25AB']; // ●, ○, ▪, ▫

class BulletWidget extends WidgetType {
  constructor(private depth: number) { super(); }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-list-bullet';
    span.setAttribute('data-depth', String(this.depth));
    span.textContent = BULLET_CHARS[this.depth % BULLET_CHARS.length];
    return span;
  }
  eq(other: BulletWidget) { return this.depth === other.depth; }
  ignoreEvent() { return true; }
}

class OrderedNumberWidget extends WidgetType {
  constructor(private label: string) { super(); }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-list-ordered-number';
    span.textContent = this.label;
    return span;
  }
  eq(other: OrderedNumberWidget) { return this.label === other.label; }
  ignoreEvent() { return true; }
}

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private pos: number) { super(); }
  toDOM(view: EditorView) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'cm-checkbox-widget';
    cb.checked = this.checked;
    const pos = this.pos;
    const isChecked = this.checked;
    cb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: isChecked ? ' ' : 'x' }
      });
    });
    return cb;
  }
  eq(other: CheckboxWidget) { return this.checked === other.checked && this.pos === other.pos; }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(private src: string, private alt: string) { super(); }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-image-widget';
    // Inline padding — CM6 measures widget height before scoped CSS applies
    // (element isn't in the DOM tree yet), so CSS class padding gets missed.
    wrapper.style.padding = '8px 0';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    img.onload = () => view.requestMeasure();
    img.onerror = () => {
      wrapper.innerHTML = '';
      const p = document.createElement('div');
      p.className = 'cm-image-error';
      p.textContent = `[Image: ${this.alt || 'failed to load'}]`;
      wrapper.appendChild(p);
      view.requestMeasure();
    };
    wrapper.appendChild(img);
    return wrapper;
  }
  eq(other: ImageWidget) { return this.src === other.src; }
  ignoreEvent() { return true; }
}

class TableWidget extends WidgetType {
  constructor(
    private headers: string[],
    private rows: string[][],
    private alignments: ('left' | 'center' | 'right')[],
    private docFrom: number,
    private docTo: number,
  ) { super(); }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-table-wrapper';

    const table = document.createElement('table');
    table.className = 'cm-table-widget';
    const widget = this;

    // --- State for live mutations ---
    let liveHeaders = this.headers.map(h => h.trim());
    let liveRows = this.rows.map(r => r.map(c => c.trim()));
    let liveAligns = [...this.alignments];

    // --- Sync helper ---
    const sync = () => {
      const newText = widget.reconstructMarkdown(liveHeaders, liveRows, liveAligns);
      const currentText = view.state.doc.sliceString(widget.docFrom, widget.docTo);
      if (newText !== currentText) {
        const len = newText.length;
        view.dispatch({
          changes: { from: widget.docFrom, to: widget.docTo, insert: newText },
          annotations: tableEditAnnotation.of(true),
        });
        widget.docTo = widget.docFrom + len;
      }
    };

    // --- Read current state from DOM ---
    const readDOM = () => {
      const ths = table.querySelectorAll('thead th');
      liveHeaders = Array.from(ths).map(c => (c as HTMLElement).textContent || '');
      const trs = table.querySelectorAll('tbody tr');
      liveRows = Array.from(trs).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).textContent || '')
      );
    };

    // --- Build a new row in the DOM ---
    const addRowDOM = (tbody: HTMLTableSectionElement, focusColIdx?: number): HTMLTableRowElement => {
      const tr = tbody.insertRow();
      for (let i = 0; i < liveHeaders.length; i++) {
        const td = tr.insertCell();
        td.textContent = '';
        td.style.textAlign = liveAligns[i] || 'left';
        makeEditable(td);
      }
      liveRows.push(liveHeaders.map(() => ''));
      sync();
      if (focusColIdx !== undefined && tr.cells[focusColIdx]) {
        (tr.cells[focusColIdx] as HTMLElement).focus();
      }
      return tr;
    };

    // --- Add column ---
    const addColumnDOM = () => {
      readDOM();
      liveHeaders.push('');
      liveAligns.push('left');
      // Add header cell
      const headerRow = table.querySelector('thead tr') as HTMLTableRowElement;
      const th = document.createElement('th');
      th.textContent = '';
      th.style.textAlign = 'left';
      makeEditable(th);
      headerRow.appendChild(th);
      // Add cell to each body row
      const bodyRows = table.querySelectorAll('tbody tr');
      bodyRows.forEach((tr, ri) => {
        const td = (tr as HTMLTableRowElement).insertCell();
        td.textContent = '';
        td.style.textAlign = 'left';
        makeEditable(td);
        liveRows[ri].push('');
      });
      sync();
      th.focus();
    };

    // --- Delete row ---
    const deleteRowDOM = (rowIdx: number) => {
      readDOM();
      if (liveRows.length <= 1) return; // Keep at least 1 data row
      const tbody = table.querySelector('tbody')!;
      tbody.deleteRow(rowIdx);
      liveRows.splice(rowIdx, 1);
      sync();
    };

    // --- Delete column ---
    const deleteColumnDOM = (colIdx: number) => {
      readDOM();
      if (liveHeaders.length <= 2) return; // Keep at least 2 columns
      // Remove header cell
      const headerRow = table.querySelector('thead tr') as HTMLTableRowElement;
      headerRow.deleteCell(colIdx);
      liveHeaders.splice(colIdx, 1);
      liveAligns.splice(colIdx, 1);
      // Remove body cells
      const bodyRows = table.querySelectorAll('tbody tr');
      bodyRows.forEach((tr, ri) => {
        (tr as HTMLTableRowElement).deleteCell(colIdx);
        liveRows[ri].splice(colIdx, 1);
      });
      sync();
    };

    // --- Make a cell editable with keyboard handling ---
    const makeEditable = (cell: HTMLElement) => {
      cell.contentEditable = 'true';
      cell.spellcheck = false;

      cell.addEventListener('keydown', (e: KeyboardEvent) => {
        const formattingCommand = commandFromKeyboardEvent(e);
        if (formattingCommand) {
          e.preventDefault();
          e.stopPropagation();

          if (!widgetShortcutInterceptionEnabled) {
            view.dom.dispatchEvent(new CustomEvent('ognile:format-command', {
              bubbles: true,
              detail: { command: formattingCommand },
            }));
            return;
          }

          if (formattingCommand === 'link') {
            view.dom.dispatchEvent(new CustomEvent('ognile:request-link', { bubbles: true }));
          } else {
            applyFormattingToActiveTableCell(formattingCommand, widgetFormattingPreferences);
          }
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const cells = Array.from(table.querySelectorAll('th, td'));
          const idx = cells.indexOf(cell);
          const next = e.shiftKey ? idx - 1 : idx + 1;
          if (next >= 0 && next < cells.length) {
            (cells[next] as HTMLElement).focus();
          } else if (!e.shiftKey && next >= cells.length) {
            // Tab past last cell → add new row, focus first cell
            readDOM();
            const tbody = table.querySelector('tbody')!;
            addRowDOM(tbody, 0);
          }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const allRows = table.querySelectorAll('tr');
          const currentRow = cell.parentElement as HTMLTableRowElement;
          const colIdx = Array.from(currentRow.cells).indexOf(cell as HTMLTableCellElement);
          const rowIdx = Array.from(allRows).indexOf(currentRow);
          if (rowIdx + 1 < allRows.length) {
            const nextCell = allRows[rowIdx + 1].cells[colIdx];
            if (nextCell) (nextCell as HTMLElement).focus();
          } else {
            // Enter on last row → add new row, focus same column
            readDOM();
            const tbody = table.querySelector('tbody')!;
            addRowDOM(tbody, colIdx);
          }
        }
        if (e.key === 'Escape') {
          cell.blur();
          view.focus();
        }
        if (e.key === 'Backspace' && e.metaKey) {
          // Cmd+Backspace on a row → delete the row
          e.preventDefault();
          const currentRow = cell.parentElement as HTMLTableRowElement;
          const tbody = table.querySelector('tbody')!;
          const rowIdx = Array.from(tbody.rows).indexOf(currentRow);
          if (rowIdx >= 0 && liveRows.length > 1) {
            readDOM();
            deleteRowDOM(rowIdx);
          }
        }
      });

      cell.addEventListener('blur', () => {
        setTimeout(() => {
          if (!wrapper.contains(document.activeElement)) {
            readDOM();
            sync();
          }
        }, 0);
      });
    };

    // --- Build the table header ---
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    this.headers.forEach((h, i) => {
      const th = document.createElement('th');
      th.textContent = h.trim();
      th.style.textAlign = this.alignments[i] || 'left';
      makeEditable(th);
      headerRow.appendChild(th);
    });

    // --- Build the table body ---
    const tbody = table.createTBody();
    this.rows.forEach(row => {
      const tr = tbody.insertRow();
      for (let i = 0; i < this.headers.length; i++) {
        const td = tr.insertCell();
        td.textContent = (row[i] || '').trim();
        td.style.textAlign = this.alignments[i] || 'left';
        makeEditable(td);
      }
    });

    wrapper.appendChild(table);

    // --- Add Row button (shows on hover) ---
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.className = 'cm-table-control cm-table-add-row';
    addRowBtn.textContent = '+';
    addRowBtn.title = 'Add row';
    addRowBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      readDOM();
      addRowDOM(tbody, 0);
    });
    wrapper.appendChild(addRowBtn);

    // --- Add Column button (shows on hover, positioned at top-right) ---
    const addColBtn = document.createElement('button');
    addColBtn.type = 'button';
    addColBtn.className = 'cm-table-control cm-table-add-column';
    addColBtn.textContent = '+';
    addColBtn.title = 'Add column';
    addColBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addColumnDOM();
    });
    wrapper.appendChild(addColBtn);

    return wrapper;
  }

  private reconstructMarkdown(headers: string[], rows: string[][], alignments: ('left' | 'center' | 'right')[]): string {
    const pad = (s: string) => ` ${s} `;
    const headerLine = '|' + headers.map(pad).join('|') + '|';
    const sepLine = '|' + alignments.map(a => {
      if (a === 'center') return ' :---: ';
      if (a === 'right') return ' ---: ';
      return ' :--- ';
    }).join('|') + '|';
    const rowLines = rows.map(row => {
      const cells = [];
      for (let i = 0; i < headers.length; i++) {
        cells.push(pad(row[i] || ''));
      }
      return '|' + cells.join('|') + '|';
    });
    return [headerLine, sepLine, ...rowLines].join('\n');
  }

  eq(other: TableWidget) {
    return JSON.stringify(this.headers) === JSON.stringify(other.headers) &&
           JSON.stringify(this.rows) === JSON.stringify(other.rows);
  }
  ignoreEvent() { return true; }
}

class CodeBlockWidget extends WidgetType {
  constructor(private code: string, private language: string) { super(); }
  toDOM() {
    const outer = document.createElement('div');
    outer.style.padding = '8px 0';
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-codeblock-widget';

    // Header bar with language label and copy button
    const header = document.createElement('div');
    header.className = 'cm-codeblock-header';

    if (this.language) {
      const lang = document.createElement('span');
      lang.className = 'cm-codeblock-lang';
      lang.textContent = this.language;
      header.appendChild(lang);
    } else {
      header.appendChild(document.createElement('span')); // spacer
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cm-codeblock-copy';
    copyBtn.title = 'Copy code';
    copyBtn.textContent = 'Copy';
    const codeText = this.code;
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(codeText).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('cm-codeblock-copy--success');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('cm-codeblock-copy--success');
        }, 1500);
      });
    });
    header.appendChild(copyBtn);
    wrapper.appendChild(header);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = this.code;
    pre.appendChild(code);
    wrapper.appendChild(pre);
    outer.appendChild(wrapper);
    return outer;
  }
  eq(other: CodeBlockWidget) {
    return this.code === other.code && this.language === other.language;
  }
  ignoreEvent() { return true; }
}

class FrontmatterWidget extends WidgetType {
  constructor(private propertyCount: number) { super(); }
  toDOM() {
    const outer = document.createElement('div');
    outer.style.padding = '0 0 8px 0';
    const bar = document.createElement('div');
    bar.className = 'cm-frontmatter-widget';
    bar.textContent = this.propertyCount > 0
      ? `Frontmatter (${this.propertyCount} ${this.propertyCount === 1 ? 'property' : 'properties'})`
      : 'Frontmatter (empty)';
    outer.appendChild(bar);
    return outer;
  }
  eq(other: FrontmatterWidget) { return this.propertyCount === other.propertyCount; }
  ignoreEvent() { return true; }
}

// ========== Table Parser ==========

function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(c => c.trim());
}

function parseTableText(text: string): { headers: string[]; rows: string[][]; alignments: ('left' | 'center' | 'right')[] } | null {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;
  const headers = parseTableRow(lines[0]);
  if (headers.length === 0) return null;
  const alignRow = parseTableRow(lines[1]);
  if (!alignRow.every(cell => /^:?-+:?$/.test(cell.trim()))) return null;
  const alignments: ('left' | 'center' | 'right')[] = alignRow.map(cell => {
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
  const rows = lines.slice(2).map(parseTableRow);
  return { headers, rows, alignments };
}

// ========== Frontmatter detection ==========

function detectFrontmatter(doc: EditorState['doc']): { end: number; propCount: number } {
  if (doc.lines < 2) return { end: 0, propCount: 0 };
  const firstLine = doc.line(1);
  if (firstLine.text.trim() !== '---') return { end: 0, propCount: 0 };
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') {
      let propCount = 0;
      for (let j = 2; j < i; j++) {
        const lt = doc.line(j).text.trim();
        if (lt && lt.includes(':')) propCount++;
      }
      return { end: doc.line(i).to, propCount };
    }
  }
  return { end: 0, propCount: 0 };
}

// ========== Iterate lines within a block node ==========

/**
 * Iterate over each line within a block node's range, correctly handling
 * lezer-markdown's convention of sometimes including the trailing newline.
 * Uses blockEnd() to compute the true content boundary.
 */
function forEachBlockLine(
  doc: EditorState['doc'],
  from: number,
  to: number,
  callback: (line: { from: number; to: number; text: string; number: number }) => void
) {
  const end = blockEnd(doc, from, to);
  let pos = from;
  while (pos <= end) {
    const line = doc.lineAt(pos);
    callback(line);
    if (line.to >= end || line.number >= doc.lines) break;
    pos = line.to + 1;
  }
}


// =====================================================================
// UNIFIED DECORATIONS — Single StateField for ALL decorations
// =====================================================================

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const sel = state.selection.ranges;
  const doc = state.doc;
  const fm = detectFrontmatter(doc);

  // --- Frontmatter ---
  if (fm.end > 0) {
    const fmFrom = doc.line(1).from;
    if (!isRangeSelected(sel, fmFrom, fm.end)) {
      ranges.push(Decoration.replace({
        widget: new FrontmatterWidget(fm.propCount),
        block: true,
      }).range(fmFrom, fm.end));
    } else {
      const endLine = doc.lineAt(fm.end);
      for (let i = 1; i <= endLine.number; i++) {
        const line = doc.line(i);
        ranges.push(Decoration.line({ class: 'cm-frontmatter-line' }).range(line.from));
      }
    }
  }

  // --- Wiki links (full document regex scan) ---
  const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const fullText = doc.toString();
  let match;
  while ((match = wikiRegex.exec(fullText)) !== null) {
    const absFrom = match.index;
    const absTo = absFrom + match[0].length;
    if (fm.end > 0 && absFrom < fm.end) continue;
    const selected = isRangeSelected(sel, absFrom, absTo);

    if (match[2]) {
      const pipePos = absFrom + 2 + match[1].length;
      ranges.push(Decoration.mark({
        class: 'cm-wiki-link',
        attributes: { 'data-wiki-target': match[1] },
      }).range(pipePos + 1, absTo - 2));
      if (!selected) {
        ranges.push(hiddenReplace.range(absFrom, pipePos + 1));
        ranges.push(hiddenReplace.range(absTo - 2, absTo));
      }
    } else {
      ranges.push(Decoration.mark({
        class: 'cm-wiki-link',
        attributes: { 'data-wiki-target': match[1] },
      }).range(absFrom + 2, absTo - 2));
      if (!selected) {
        ranges.push(hiddenReplace.range(absFrom, absFrom + 2));
        ranges.push(hiddenReplace.range(absTo - 2, absTo));
      }
    }
  }

  // --- Syntax tree decorations (full document) ---
  const tree = syntaxTree(state);
  tree.iterate({
    enter(cursor) {
      const { name, from, to } = cursor;

      // Skip inside frontmatter
      if (fm.end > 0 && to <= fm.end) return false;

      // === Table (block widget) ===
      if (name === 'Table') {
        if (!isRangeSelected(sel, from, to)) {
          const end = blockEnd(doc, from, to);
          const firstLine = doc.lineAt(from);
          const lastLine = doc.lineAt(end);
          const text = doc.sliceString(firstLine.from, lastLine.to);
          const parsed = parseTableText(text);
          if (parsed) {
            ranges.push(Decoration.replace({
              widget: new TableWidget(parsed.headers, parsed.rows, parsed.alignments, firstLine.from, lastLine.to),
              block: true,
            }).range(firstLine.from, lastLine.to));
          }
        }
        return false;
      }

      // === Image (block widget) ===
      if (name === 'Image') {
        if (!isRangeSelected(sel, from, to)) {
          const text = doc.sliceString(from, to);
          const m = text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
          if (m) {
            const line = doc.lineAt(from);
            if (line.from === from || doc.sliceString(line.from, from).trim() === '') {
              ranges.push(Decoration.replace({
                widget: new ImageWidget(m[2], m[1]),
                block: true,
              }).range(line.from, line.to));
            }
          }
        }
        return false;
      }

      // === Horizontal Rule (block widget) ===
      if (name === 'HorizontalRule') {
        if (!isRangeSelected(sel, from, to)) {
          const line = doc.lineAt(from);
          ranges.push(Decoration.replace({
            widget: new HrWidget(),
            block: true,
          }).range(line.from, line.to));
        }
        return false;
      }

      // === Fenced Code (block widget or line styling) ===
      if (name === 'FencedCode') {
        if (!isRangeSelected(sel, from, to)) {
          const end = blockEnd(doc, from, to);
          const firstLine = doc.lineAt(from);
          const lastLine = doc.lineAt(end);
          // Safety: verify closing fence exists (parser may return incomplete range)
          if (!lastLine.text.match(/^[`~]{3,}\s*$/)) return false;
          const langMatch = firstLine.text.match(/^`{3,}(\S+)?/);
          const language = langMatch?.[1] || '';
          const codeStart = firstLine.to + 1;
          const codeEnd = lastLine.from > 0 ? lastLine.from - 1 : lastLine.from;
          const code = codeStart <= codeEnd ? doc.sliceString(codeStart, codeEnd) : '';
          ranges.push(Decoration.replace({
            widget: new CodeBlockWidget(code, language),
            block: true,
          }).range(firstLine.from, lastLine.to));
        } else {
          // Cursor inside: apply code block line styling
          forEachBlockLine(doc, from, to, (line) => {
            ranges.push(codeBlockLine.range(line.from));
          });
        }
        return false;
      }

      // === Headings ===
      const headingDeco = headingLineDecos[name];
      if (headingDeco) {
        const line = doc.lineAt(from);
        ranges.push(headingDeco.range(line.from));
        if (!isRangeSelected(sel, from, to)) {
          const lineText = line.text;
          const hashMatch = lineText.match(/^(#{1,6})\s/);
          if (hashMatch) {
            ranges.push(hiddenReplace.range(line.from, line.from + hashMatch[0].length));
          }
        }
        return; // visit children for inline formatting in headings
      }

      // === StrongEmphasis ===
      if (name === 'StrongEmphasis') {
        const selected = isRangeSelected(sel, from, to);
        const text = doc.sliceString(from, Math.min(from + 4, to));
        const markerLen = text.startsWith('***') ? 3 : 2;
        const cFrom = from + markerLen;
        const cTo = to - markerLen;
        if (cFrom >= cTo) return false;
        ranges.push(strongMark.range(cFrom, cTo));
        if (markerLen === 3) ranges.push(emMark.range(cFrom, cTo));
        if (!selected) {
          ranges.push(hiddenReplace.range(from, cFrom));
          ranges.push(hiddenReplace.range(cTo, to));
        }
        return markerLen === 3 ? false : undefined;
      }

      // === Emphasis ===
      if (name === 'Emphasis') {
        const selected = isRangeSelected(sel, from, to);
        const text = doc.sliceString(from, Math.min(from + 4, to));
        const isTriple = text.startsWith('***');
        const markerLen = isTriple ? 3 : 1;
        const cFrom = from + markerLen;
        const cTo = to - markerLen;
        if (cFrom >= cTo) return false;
        ranges.push(emMark.range(cFrom, cTo));
        if (isTriple) ranges.push(strongMark.range(cFrom, cTo));
        if (!selected) {
          ranges.push(hiddenReplace.range(from, cFrom));
          ranges.push(hiddenReplace.range(cTo, to));
        }
        return isTriple ? false : undefined;
      }

      // === Strikethrough ===
      if (name === 'Strikethrough') {
        const selected = isRangeSelected(sel, from, to);
        const cFrom = from + 2;
        const cTo = to - 2;
        if (cFrom >= cTo) return false;
        ranges.push(strikeMark.range(cFrom, cTo));
        if (!selected) {
          ranges.push(hiddenReplace.range(from, cFrom));
          ranges.push(hiddenReplace.range(cTo, to));
        }
        return false;
      }

      // === InlineCode ===
      if (name === 'InlineCode') {
        const selected = isRangeSelected(sel, from, to);
        const text = doc.sliceString(from, to);
        const openLen = text.match(/^`+/)?.[0].length || 1;
        const closeLen = text.match(/`+$/)?.[0].length || 1;
        const cFrom = from + openLen;
        const cTo = to - closeLen;
        if (cFrom >= cTo) return false;
        ranges.push(codeMark.range(cFrom, cTo));
        if (!selected) {
          ranges.push(hiddenReplace.range(from, cFrom));
          ranges.push(hiddenReplace.range(cTo, to));
        }
        return false;
      }

      // === Links ===
      if (name === 'Link') {
        const selected = isRangeSelected(sel, from, to);
        const text = doc.sliceString(from, to);
        const bracketClose = text.indexOf('](');
        if (bracketClose > 0) {
          const url = text.slice(bracketClose + 2, -1);
          ranges.push(Decoration.mark({
            class: 'cm-link',
            attributes: { 'data-url': url },
          }).range(from + 1, from + bracketClose));
          if (!selected) {
            ranges.push(hiddenReplace.range(from, from + 1)); // hide [
            ranges.push(hiddenReplace.range(from + bracketClose, to)); // hide ](url)
          }
        }
        return; // visit children for inline formatting inside links
      }

      // === TaskMarker (checkbox) ===
      if (name === 'TaskMarker') {
        const selected = isRangeSelected(sel, from, to);
        if (!selected) {
          const text = doc.sliceString(from, to);
          const isChecked = text.includes('x');
          ranges.push(Decoration.replace({
            widget: new CheckboxWidget(isChecked, from),
          }).range(from, to));
        }
        return false;
      }

      // === ListMark (bullet + ordered list styling) ===
      if (name === 'ListMark') {
        const text = doc.sliceString(from, to).trim();

        // Bullet list marks
        if ((text === '-' || text === '*' || text === '+') && !isRangeSelected(sel, from, to)) {
          const lineText = doc.lineAt(from).text;
          const isTask = /^\s*[-*+]\s+\[[ x]\]/.test(lineText);
          if (isTask) {
            ranges.push(hiddenReplace.range(from, from + 1));
          } else {
            const depth = getListNestingDepth(state, from);
            ranges.push(Decoration.replace({
              widget: new BulletWidget(depth),
            }).range(from, from + 1));
          }
        }

        // Ordered list marks (e.g. "1.", "2.", "10.")
        if (/^\d+\.$/.test(text) && !isRangeSelected(sel, from, to)) {
          const label = computeOrderedListLabel(state, from);
          if (label) {
            ranges.push(Decoration.replace({
              widget: new OrderedNumberWidget(label + '.'),
            }).range(from, to));
          }
        }

        return false;
      }

      // === Escape sequences ===
      if (name === 'Escape') {
        if (!isRangeSelected(sel, from, to)) {
          ranges.push(hiddenReplace.range(from, from + 1));
        }
        return false;
      }

      // === Blockquote ===
      if (name === 'Blockquote') {
        const selected = isRangeSelected(sel, from, to);
        forEachBlockLine(doc, from, to, (line) => {
          ranges.push(blockquoteLine.range(line.from));
          if (!selected) {
            const m = line.text.match(/^>\s?/);
            if (m) ranges.push(hiddenReplace.range(line.from, line.from + m[0].length));
          }
        });
        return; // visit children for inline formatting
      }

      // Skip HTML
      if (name === 'HTMLBlock' || name === 'HTMLTag') return false;
    },
  });

  // Pass true to have CM6 sort the ranges — they come from multiple
  // sources (wiki links regex + tree iteration) and may not be in order
  return Decoration.set(ranges, true);
}

export const decorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(decos, tr) {
    // When edit came from a table widget, map existing decorations
    // instead of rebuilding — this preserves the widget DOM and focus
    if (tr.annotation(tableEditAnnotation)) {
      return decos.map(tr.changes);
    }
    return buildDecorations(tr.state);
  },
  provide: f => EditorView.decorations.from(f),
});
