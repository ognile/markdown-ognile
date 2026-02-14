import { StateField, type EditorState } from '@codemirror/state';
import { showTooltip, EditorView, type Tooltip } from '@codemirror/view';

const DEBOUNCE_MS = 150;

function getSelectionTooltip(state: EditorState): Tooltip | null {
  const sel = state.selection.main;
  if (sel.empty) return null;

  return {
    pos: sel.from,
    above: true,
    strictSide: true,
    arrow: false,
    create(view: EditorView) {
      const dom = document.createElement('div');
      dom.className = 'cm-floating-toolbar';
      dom.style.opacity = '0';

      const buttons: { label: string; html: string; command: string }[] = [
        { label: 'Bold', html: '<strong>B</strong>', command: 'bold' },
        { label: 'Italic', html: '<em>I</em>', command: 'italic' },
        { label: 'Strikethrough', html: '<s>S</s>', command: 'strikethrough' },
        { label: 'Link', html: '\u{1F517}', command: 'link' },
      ];

      for (const btn of buttons) {
        const button = document.createElement('button');
        button.className = 'cm-toolbar-btn';
        button.title = btn.label;
        button.type = 'button';
        button.innerHTML = btn.html;
        button.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (btn.command === 'link') {
            view.dom.dispatchEvent(new CustomEvent('ognile:request-link', { bubbles: true }));
          } else {
            view.dom.dispatchEvent(new CustomEvent('ognile:format-command', {
              bubbles: true,
              detail: { command: btn.command },
            }));
          }
        });
        dom.appendChild(button);
      }

      // Debounced fade-in
      setTimeout(() => {
        // Verify selection still exists
        if (!view.state.selection.main.empty) {
          dom.style.opacity = '1';
        }
      }, DEBOUNCE_MS);

      return { dom };
    },
  };
}

export const floatingToolbar = StateField.define<Tooltip | null>({
  create(state) {
    return getSelectionTooltip(state);
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return getSelectionTooltip(tr.state);
  },
  provide: f => showTooltip.from(f),
});
