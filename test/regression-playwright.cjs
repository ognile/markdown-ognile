const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');

async function openStandalone(page, fileName) {
  const fileUrl = 'file://' + path.resolve('test', fileName);
  await page.goto(fileUrl);
  await page.waitForFunction(() => window.__editorView && window.__editorView.state.doc.length > 0);
}

async function postCommand(page, command, args) {
  await page.evaluate(async ({ command, args }) => {
    window.postMessage({ type: 'command', command, args }, '*');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }, { command, args });
}

async function setDocAndSelection(page, text, selectionSpec) {
  await page.evaluate(({ text, selectionSpec }) => {
    const view = window.__editorView;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: selectionSpec,
    });
  }, { text, selectionSpec });
}

async function getDoc(page) {
  return page.evaluate(() => window.__editorView.state.doc.toString());
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1) Host command formatting uses underscore italics and toggles cleanly.
    await openStandalone(page, 'standalone-bottom.html');
    await setDocAndSelection(page, 'A paragraph with a link inside.', { anchor: 2, head: 11 });
    await postCommand(page, 'italic');
    let doc = await getDoc(page);
    assert.equal(doc, 'A _paragraph_ with a link inside.');

    await setDocAndSelection(page, doc, { anchor: 3, head: 12 });
    await postCommand(page, 'italic');
    doc = await getDoc(page);
    assert.equal(doc, 'A paragraph with a link inside.');

    await setDocAndSelection(page, 'strike this text', { anchor: 0, head: 6 });
    await postCommand(page, 'strikethrough');
    doc = await getDoc(page);
    assert.equal(doc, '~~strike~~ this text');
    await setDocAndSelection(page, doc, { anchor: 2, head: 8 });
    await postCommand(page, 'strikethrough');
    doc = await getDoc(page);
    assert.equal(doc, 'strike this text');

    // 2) Empty selection defaults to current word, not full section.
    await setDocAndSelection(page, 'A paragraph with **bold** and link.', { anchor: 4 });
    await postCommand(page, 'italic');
    doc = await getDoc(page);
    assert.equal(doc, 'A _paragraph_ with **bold** and link.');

    // 3) Multi-cursor formatting applies to all ranges.
    const multiCursorDoc = await page.evaluate(async () => {
      const view = window.__editorView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'one two three' } });
      const Selection = view.state.selection.constructor;
      view.dispatch({
        selection: Selection.create([Selection.range(0, 3), Selection.range(4, 7)], 0),
      });
      window.postMessage({ type: 'command', command: 'bold' }, '*');
      await new Promise((resolve) => setTimeout(resolve, 80));
      return view.state.doc.toString();
    });
    assert.equal(multiCursorDoc, '**one** **two** three');

    // 4) Multi-cursor selections retain correct offsets after left-side edits.
    const farMultiCursor = await page.evaluate(async () => {
      const view = window.__editorView;
      const text = 'one two three four five six';
      const leftFrom = text.indexOf('one');
      const leftTo = leftFrom + 'one'.length;
      const rightFrom = text.indexOf('five');
      const rightTo = rightFrom + 'five'.length;

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      const Selection = view.state.selection.constructor;
      view.dispatch({
        selection: Selection.create([Selection.range(leftFrom, leftTo), Selection.range(rightFrom, rightTo)], 0),
      });

      window.postMessage({ type: 'command', command: 'bold' }, '*');
      await new Promise((resolve) => setTimeout(resolve, 80));

      const doc = view.state.doc.toString();
      const selectedTexts = view.state.selection.ranges.map((range) =>
        doc.slice(range.from, range.to)
      );
      return { doc, selectedTexts };
    });
    assert.equal(farMultiCursor.doc, '**one** two three four **five** six');
    assert.deepEqual(farMultiCursor.selectedTexts, ['one', 'five']);

    // 5) Webview shortcut routing applies formatting directly in-editor.
    const shortcutDoc = await page.evaluate(async () => {
      const view = window.__editorView;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'shortcut target word' },
        selection: { anchor: 0, head: 8 },
      });
      view.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'i',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { text: view.state.doc.toString(), prevented: event.defaultPrevented };
    });
    assert.equal(shortcutDoc.text, '_shortcut_ target word');
    assert.equal(shortcutDoc.prevented, true);

    // 6) Keyboard formatting in a long document must preserve scroll position.
    await openStandalone(page, 'standalone-scroll.html');
    const keyboardScroll = await page.evaluate(async () => {
      const view = window.__editorView;
      const scroller = view.scrollDOM || view.dom.querySelector('.cm-scroller');

      const lines = [];
      for (let i = 1; i <= 1200; i++) {
        lines.push(`Line ${i} alpha beta gamma delta epsilon zeta.`);
      }

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lines.join('\n') } });

      const targetLine = view.state.doc.line(950);
      view.dispatch({ selection: { anchor: targetLine.from + 5, head: targetLine.from + 9 } });
      view.focus();

      scroller.scrollTop = 20000;
      await new Promise((resolve) => setTimeout(resolve, 80));
      const before = scroller.scrollTop;

      const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || '');
      const event = new KeyboardEvent('keydown', {
        key: 'i',
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 120));

      const after = scroller.scrollTop;
      return {
        before,
        after,
        prevented: event.defaultPrevented,
        delta: Math.abs(after - before),
      };
    });
    assert.ok(keyboardScroll.before > 1000);
    assert.equal(keyboardScroll.prevented, true);
    assert.ok(keyboardScroll.delta <= 2);

    // 7) Host-routed formatting in a long document must preserve scroll position.
    const hostScroll = await page.evaluate(async () => {
      const view = window.__editorView;
      const scroller = view.scrollDOM || view.dom.querySelector('.cm-scroller');

      const lines = [];
      for (let i = 1; i <= 1200; i++) {
        lines.push(`Host Line ${i} alpha beta gamma delta epsilon zeta.`);
      }

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lines.join('\n') } });

      const targetLine = view.state.doc.line(900);
      view.dispatch({ selection: { anchor: targetLine.from + 5, head: targetLine.from + 9 } });
      view.focus();

      scroller.scrollTop = 20000;
      await new Promise((resolve) => setTimeout(resolve, 80));
      const before = scroller.scrollTop;

      window.postMessage({ type: 'command', command: 'bold' }, '*');
      await new Promise((resolve) => setTimeout(resolve, 120));

      const after = scroller.scrollTop;
      return {
        before,
        after,
        delta: Math.abs(after - before),
      };
    });
    assert.ok(hostScroll.before > 1000);
    assert.ok(hostScroll.delta <= 2);

    // 8) Table-cell command must not mutate unrelated document positions.
    await openStandalone(page, 'standalone.html');
    const tableResult = await page.evaluate(async () => {
      const view = window.__editorView;
      const before = view.state.doc.toString();

      // Force a stale editor selection near top of file.
      view.dispatch({ selection: { anchor: 0 } });

      const cell = document.querySelector('.cm-table-widget tbody td');
      cell.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(cell);
      sel.addRange(range);

      window.postMessage({ type: 'command', command: 'italic' }, '*');
      await new Promise((resolve) => setTimeout(resolve, 80));

      const after = view.state.doc.toString();
      return {
        startsWithBefore: before.slice(0, 8),
        startsWithAfter: after.slice(0, 8),
        firstLineAfter: after.split('\n')[0],
        cellHtml: cell.innerHTML,
      };
    });

    assert.equal(tableResult.startsWithBefore, '---\ntitl');
    assert.equal(tableResult.startsWithAfter, '---\ntitl');
    assert.equal(tableResult.firstLineAfter, '---');
    assert.ok(!tableResult.cellHtml.includes('<i>'));
    assert.ok(!tableResult.cellHtml.includes('<b>'));

    console.log('Regression suite passed.');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
