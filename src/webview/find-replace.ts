import {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  setSearchQuery,
  SearchQuery,
  getSearchQuery,
  highlightSelectionMatches,
} from '@codemirror/search';
import { keymap, EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

// ── SVG icons ──────────────────────────────────────────────────────

function chevronSvg(direction: 'up' | 'down'): string {
  const d = direction === 'up' ? 'M10 9L7 6L4 9' : 'M4 5L7 8L10 5';
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function closeSvg(): string {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

function expandSvg(): string {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 4L9 7L5 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// ── State shared across panel open/close ───────────────────────────

let nextPanelShowsReplace = false;

// ── Match counting ─────────────────────────────────────────────────

const MAX_MATCH_COUNT = 10_000;

interface MatchInfo {
  total: number;
  current: number; // 1-based, 0 = no current match
}

function countMatches(view: EditorView): MatchInfo {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return { total: 0, current: 0 };

  const cursor = query.getCursor(view.state);
  const mainSel = view.state.selection.main;
  let total = 0;
  let current = 0;

  let result = cursor.next();
  while (!result.done) {
    total++;
    if (total > MAX_MATCH_COUNT) return { total: MAX_MATCH_COUNT + 1, current: 0 };
    if (current === 0 && result.value.from === mainSel.from && result.value.to === mainSel.to) {
      current = total;
    }
    result = cursor.next();
  }

  return { total, current };
}

// ── Scrollbar match markers ────────────────────────────────────────

function updateScrollbarMarkers(view: EditorView, container: HTMLElement) {
  container.innerHTML = '';
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return;

  const scroller = view.scrollDOM;
  const scrollHeight = scroller.scrollHeight;
  const clientHeight = scroller.clientHeight;
  if (scrollHeight <= 0) return;

  const docLength = view.state.doc.length;
  if (docLength === 0) return;

  const mainSel = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let count = 0;

  let result = cursor.next();
  while (!result.done) {
    count++;
    if (count > MAX_MATCH_COUNT) break;

    const ratio = result.value.from / docLength;
    const top = Math.round(ratio * clientHeight);
    const isCurrent = result.value.from === mainSel.from && result.value.to === mainSel.to;

    const mark = document.createElement('div');
    mark.className = isCurrent ? 'ognile-scrollbar-mark ognile-scrollbar-mark--current' : 'ognile-scrollbar-mark';
    mark.style.top = `${top}px`;
    container.appendChild(mark);

    result = cursor.next();
  }
}

// ── Custom panel factory ───────────────────────────────────────────

function ognileFindPanel(view: EditorView): Panel {
  // State
  let caseSensitive = false;
  let wholeWord = false;
  let useRegexp = false;
  let replaceVisible = nextPanelShowsReplace;
  let lastNoMatchTrigger = 0;
  let successTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── DOM construction ──

  const dom = document.createElement('div');
  dom.className = 'ognile-find-panel';

  // Expand button (toggle replace row)
  const expandBtn = document.createElement('button');
  expandBtn.className = replaceVisible ? 'ognile-find-expand ognile-find-expand--open' : 'ognile-find-expand';
  expandBtn.title = 'Toggle Replace';
  expandBtn.type = 'button';
  expandBtn.innerHTML = expandSvg();

  // Find row
  const findRow = document.createElement('div');
  findRow.className = 'ognile-find-row';

  const findInput = document.createElement('input');
  findInput.className = 'ognile-find-input';
  findInput.type = 'text';
  findInput.placeholder = 'Find';
  findInput.setAttribute('main-field', 'true');
  findInput.spellcheck = false;

  // Toggles
  const togglesDiv = document.createElement('div');
  togglesDiv.className = 'ognile-find-toggles';

  function makeToggle(mode: string, label: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ognile-find-toggle';
    btn.setAttribute('data-mode', mode);
    btn.title = title;
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', 'false');
    return btn;
  }

  const caseBtn = makeToggle('case', 'Aa', 'Match Case (Alt+C)');
  const wordBtn = makeToggle('word', 'Ab|', 'Whole Word (Alt+W)');
  const regexBtn = makeToggle('regex', '.*', 'Regex (Alt+R)');
  togglesDiv.append(caseBtn, wordBtn, regexBtn);

  // Match counter
  const countSpan = document.createElement('span');
  countSpan.className = 'ognile-find-count';

  // Nav buttons
  const prevBtn = document.createElement('button');
  prevBtn.className = 'ognile-find-nav';
  prevBtn.title = 'Previous Match (Shift+Enter)';
  prevBtn.type = 'button';
  prevBtn.innerHTML = chevronSvg('up');

  const nextBtn = document.createElement('button');
  nextBtn.className = 'ognile-find-nav';
  nextBtn.title = 'Next Match (Enter)';
  nextBtn.type = 'button';
  nextBtn.innerHTML = chevronSvg('down');

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ognile-find-close';
  closeBtn.title = 'Close (Escape)';
  closeBtn.type = 'button';
  closeBtn.innerHTML = closeSvg();

  findRow.append(findInput, togglesDiv, countSpan, prevBtn, nextBtn, closeBtn);

  // Replace row
  const replaceRow = document.createElement('div');
  replaceRow.className = replaceVisible ? 'ognile-replace-row ognile-replace-row--visible' : 'ognile-replace-row';

  const replaceInput = document.createElement('input');
  replaceInput.className = 'ognile-replace-input';
  replaceInput.type = 'text';
  replaceInput.placeholder = 'Replace';
  replaceInput.spellcheck = false;

  const replaceOneBtn = document.createElement('button');
  replaceOneBtn.className = 'ognile-replace-btn';
  replaceOneBtn.type = 'button';
  replaceOneBtn.textContent = 'Replace';

  const replaceAllBtn = document.createElement('button');
  replaceAllBtn.className = 'ognile-replace-btn';
  replaceAllBtn.type = 'button';
  replaceAllBtn.textContent = 'Replace All';

  replaceRow.append(replaceInput, replaceOneBtn, replaceAllBtn);

  // Wrap rows in a vertical column so they stack, not compete for horizontal space
  const rowsWrapper = document.createElement('div');
  rowsWrapper.className = 'ognile-find-rows';
  rowsWrapper.append(findRow, replaceRow);

  dom.append(expandBtn, rowsWrapper);

  // Scrollbar markers container
  const scrollMarks = document.createElement('div');
  scrollMarks.className = 'ognile-scrollbar-marks';

  // ── Helpers ──

  function dispatchQuery() {
    const query = new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive,
      regexp: useRegexp,
      wholeWord,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
  }

  function updateCount() {
    if (successTimeout !== null) return; // don't overwrite success flash

    const searchText = findInput.value;
    if (!searchText) {
      countSpan.textContent = '';
      countSpan.className = 'ognile-find-count';
      findInput.classList.remove('ognile-find-input--no-match');
      return;
    }

    // Check for regex errors
    if (useRegexp) {
      try {
        new RegExp(searchText);
      } catch {
        countSpan.textContent = 'Invalid regex';
        countSpan.className = 'ognile-find-count ognile-find-count--no-match';
        findInput.classList.add('ognile-find-input--no-match');
        return;
      }
    }

    const info = countMatches(view);

    if (info.total === 0) {
      countSpan.textContent = 'No results';
      countSpan.className = 'ognile-find-count ognile-find-count--no-match';

      // Trigger shake animation (remove + re-add class to re-trigger)
      const now = Date.now();
      if (now - lastNoMatchTrigger > 100) {
        findInput.classList.remove('ognile-find-input--no-match');
        // Force reflow to re-trigger animation
        void findInput.offsetWidth;
        findInput.classList.add('ognile-find-input--no-match');
        lastNoMatchTrigger = now;
      }
    } else {
      findInput.classList.remove('ognile-find-input--no-match');
      countSpan.className = 'ognile-find-count';
      if (info.total > MAX_MATCH_COUNT) {
        countSpan.textContent = `${MAX_MATCH_COUNT.toLocaleString()}+`;
      } else if (info.current > 0) {
        countSpan.textContent = `${info.current} of ${info.total}`;
      } else {
        countSpan.textContent = `${info.total} result${info.total === 1 ? '' : 's'}`;
      }
    }
  }

  function updateScrollMarks() {
    updateScrollbarMarkers(view, scrollMarks);
  }

  function toggleReplace() {
    replaceVisible = !replaceVisible;
    expandBtn.classList.toggle('ognile-find-expand--open', replaceVisible);
    replaceRow.classList.toggle('ognile-replace-row--visible', replaceVisible);
    if (replaceVisible) {
      replaceInput.focus();
    }
  }

  function setToggleState(btn: HTMLButtonElement, active: boolean) {
    btn.classList.toggle('ognile-find-toggle--active', active);
    btn.setAttribute('aria-pressed', String(active));
  }

  // ── Event listeners ──

  findInput.addEventListener('input', () => {
    dispatchQuery();
    updateCount();
    updateScrollMarks();
  });

  replaceInput.addEventListener('input', () => {
    dispatchQuery();
  });

  expandBtn.addEventListener('click', toggleReplace);

  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    setToggleState(caseBtn, caseSensitive);
    dispatchQuery();
    updateCount();
    updateScrollMarks();
  });

  wordBtn.addEventListener('click', () => {
    wholeWord = !wholeWord;
    setToggleState(wordBtn, wholeWord);
    dispatchQuery();
    updateCount();
    updateScrollMarks();
  });

  regexBtn.addEventListener('click', () => {
    useRegexp = !useRegexp;
    setToggleState(regexBtn, useRegexp);
    dispatchQuery();
    updateCount();
    updateScrollMarks();
  });

  prevBtn.addEventListener('click', () => {
    findPrevious(view);
    view.focus();
    findInput.focus();
  });

  nextBtn.addEventListener('click', () => {
    findNext(view);
    view.focus();
    findInput.focus();
  });

  closeBtn.addEventListener('click', () => {
    closeSearchPanel(view);
    view.focus();
  });

  replaceOneBtn.addEventListener('click', () => {
    replaceNext(view);
    updateCount();
    updateScrollMarks();
  });

  replaceAllBtn.addEventListener('click', () => {
    const before = countMatches(view);
    replaceAll(view);
    const replaced = before.total;

    // Success flash
    if (replaced > 0) {
      countSpan.textContent = `${replaced} replaced`;
      countSpan.className = 'ognile-find-count ognile-find-count--success';
      if (successTimeout) clearTimeout(successTimeout);
      successTimeout = setTimeout(() => {
        successTimeout = null;
        updateCount();
      }, 1500);
    }
    updateScrollMarks();
  });

  // Panel-level keyboard handler
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
      return;
    }

    // Enter / Shift+Enter in find input
    if (e.key === 'Enter' && document.activeElement === findInput) {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious(view);
      } else {
        findNext(view);
      }
      updateCount();
      updateScrollMarks();
      return;
    }

    // Enter in replace input
    if (e.key === 'Enter' && document.activeElement === replaceInput) {
      e.preventDefault();
      replaceNext(view);
      updateCount();
      updateScrollMarks();
      return;
    }

    // Alt+C: toggle case
    if (e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      caseSensitive = !caseSensitive;
      setToggleState(caseBtn, caseSensitive);
      dispatchQuery();
      updateCount();
      updateScrollMarks();
      return;
    }

    // Alt+W: toggle whole word
    if (e.altKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      wholeWord = !wholeWord;
      setToggleState(wordBtn, wholeWord);
      dispatchQuery();
      updateCount();
      updateScrollMarks();
      return;
    }

    // Alt+R: toggle regex
    if (e.altKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      useRegexp = !useRegexp;
      setToggleState(regexBtn, useRegexp);
      dispatchQuery();
      updateCount();
      updateScrollMarks();
      return;
    }

    // Tab / Shift+Tab: focus cycling
    if (e.key === 'Tab') {
      const focusable = Array.from(dom.querySelectorAll('input, button:not([disabled])')) as HTMLElement[];
      // Only cycle through visible elements
      const visible = focusable.filter((el) => el.offsetParent !== null);
      const idx = visible.indexOf(document.activeElement as HTMLElement);
      if (idx >= 0) {
        e.preventDefault();
        const next = e.shiftKey
          ? visible[(idx - 1 + visible.length) % visible.length]
          : visible[(idx + 1) % visible.length];
        next.focus();
      }
    }
  });

  // ── Panel interface ──

  return {
    dom,
    top: true,
    mount() {
      // Attach scrollbar markers to the scroller
      view.scrollDOM.style.position = 'relative';
      view.scrollDOM.appendChild(scrollMarks);

      // Auto-populate from selection
      const sel = view.state.selection.main;
      if (!sel.empty) {
        const text = view.state.sliceDoc(sel.from, sel.to);
        if (!text.includes('\n')) {
          findInput.value = text;
        }
      }

      // Dispatch initial query and jump to first match
      if (findInput.value) {
        dispatchQuery();
        // Small delay to let CM6 process the query before jumping
        requestAnimationFrame(() => {
          findNext(view);
          updateCount();
          updateScrollMarks();
        });
      }

      findInput.focus();
      findInput.select();
    },
    update(update: ViewUpdate) {
      // Update count when doc changes or selection moves
      if (update.docChanged || update.selectionSet) {
        updateCount();
        updateScrollMarks();
      }
      // Also react to external query changes
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            updateCount();
            updateScrollMarks();
          }
        }
      }
    },
    destroy() {
      if (successTimeout) clearTimeout(successTimeout);
      // Remove scrollbar markers
      scrollMarks.remove();
      // Animate out: clone, animate, remove
      const parent = dom.parentElement;
      if (parent) {
        const clone = dom.cloneNode(true) as HTMLElement;
        clone.style.pointerEvents = 'none';
        clone.style.animation = 'ognile-find-panel-out var(--ognile-transition-med, 180ms) ease forwards';
        parent.insertBefore(clone, dom);
        const cleanup = () => clone.remove();
        clone.addEventListener('animationend', cleanup);
        // Fallback removal if animation is disabled
        setTimeout(cleanup, 300);
      }
    },
  };
}

// ── Exported API ───────────────────────────────────────────────────

export function createFindReplace(): Extension {
  return [
    search({ createPanel: ognileFindPanel, top: true }),
    highlightSelectionMatches(),
    keymap.of(searchKeymap),
  ];
}

export function openFind(view: EditorView) {
  nextPanelShowsReplace = false;
  openSearchPanel(view);
  // If panel already open, just refocus
  const input = view.dom.ownerDocument.querySelector('.ognile-find-input') as HTMLInputElement | null;
  if (input) {
    // Re-populate from selection if changed
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (!text.includes('\n')) {
        input.value = text;
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({ search: text, replace: '' }),
          ),
        });
      }
    }
    input.focus();
    input.select();
  }
}

export function openFindReplace(view: EditorView) {
  nextPanelShowsReplace = true;
  openSearchPanel(view);
  const input = view.dom.ownerDocument.querySelector('.ognile-find-input') as HTMLInputElement | null;
  if (input) {
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (!text.includes('\n')) {
        input.value = text;
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({ search: text, replace: '' }),
          ),
        });
      }
    }
    input.focus();
    input.select();
  }
  // Ensure replace row is visible
  const replaceRow = view.dom.ownerDocument.querySelector('.ognile-replace-row') as HTMLElement | null;
  if (replaceRow && !replaceRow.classList.contains('ognile-replace-row--visible')) {
    replaceRow.classList.add('ognile-replace-row--visible');
    const expand = view.dom.ownerDocument.querySelector('.ognile-find-expand') as HTMLElement | null;
    if (expand) expand.classList.add('ognile-find-expand--open');
  }
}
