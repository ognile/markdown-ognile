import { ViewPlugin, type ViewUpdate } from '@codemirror/view';

function countWords(text: string): number {
  const cleaned = text
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~`>|]/g, '')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(w => w.length > 0).length;
}

export const wordCountPlugin = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    words = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(view: import('@codemirror/view').EditorView) {
      this.words = countWords(view.state.doc.toString());
      this.dom = document.createElement('div');
      this.dom.className = 'cm-word-count';
      this.render();
      view.dom.appendChild(this.dom);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.words = countWords(update.state.doc.toString());
          this.render();
        }, 300);
      }
    }

    render() {
      const readTime = Math.max(1, Math.ceil(this.words / 200));
      this.dom.textContent = `${this.words.toLocaleString()} words \u00B7 ${readTime} min read`;
    }

    destroy() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.dom.remove();
    }
  }
);
