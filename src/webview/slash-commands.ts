import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void;

function makeApply(insert: string, cursorOffset?: number): ApplyFn {
  return (view, _completion, from, to) => {
    // from points after the /, we also need to eat the / itself
    const slashPos = from - 1;
    view.dispatch({
      changes: { from: slashPos, to, insert },
      selection: { anchor: slashPos + (cursorOffset ?? insert.length) },
    });
  };
}

const slashCommands: Completion[] = [
  {
    label: 'heading1',
    displayLabel: 'Heading 1',
    detail: 'Large section heading',
    apply: makeApply('# ', 2),
  },
  {
    label: 'heading2',
    displayLabel: 'Heading 2',
    detail: 'Medium section heading',
    apply: makeApply('## ', 3),
  },
  {
    label: 'heading3',
    displayLabel: 'Heading 3',
    detail: 'Small section heading',
    apply: makeApply('### ', 4),
  },
  {
    label: 'bullet',
    displayLabel: 'Bullet List',
    detail: 'Unordered list item',
    apply: makeApply('- ', 2),
  },
  {
    label: 'numbered',
    displayLabel: 'Numbered List',
    detail: 'Ordered list item',
    apply: makeApply('1. ', 3),
  },
  {
    label: 'task',
    displayLabel: 'Task',
    detail: 'Checkbox item',
    apply: makeApply('- [ ] ', 6),
  },
  {
    label: 'code',
    displayLabel: 'Code Block',
    detail: 'Fenced code block',
    apply: makeApply('```\n\n```', 4),
  },
  {
    label: 'quote',
    displayLabel: 'Blockquote',
    detail: 'Quoted text block',
    apply: makeApply('> ', 2),
  },
  {
    label: 'divider',
    displayLabel: 'Divider',
    detail: 'Horizontal rule',
    apply: makeApply('---\n', 4),
  },
  {
    label: 'table',
    displayLabel: 'Table',
    detail: '2\u00D72 table',
    apply: (view, _c, from, to) => {
      const slashPos = from - 1;
      const table = '| Header | Header |\n| :--- | :--- |\n|  |  |';
      view.dispatch({
        changes: { from: slashPos, to, insert: table },
        selection: { anchor: slashPos + 2, head: slashPos + 8 },
      });
    },
  },
  {
    label: 'image',
    displayLabel: 'Image',
    detail: 'Image embed',
    apply: (view, _c, from, to) => {
      const slashPos = from - 1;
      view.dispatch({
        changes: { from: slashPos, to, insert: '![alt](url)' },
        selection: { anchor: slashPos + 2, head: slashPos + 5 },
      });
    },
  },
  {
    label: 'link',
    displayLabel: 'Link',
    detail: 'Hyperlink',
    apply: (view, _c, from, to) => {
      const slashPos = from - 1;
      view.dispatch({
        changes: { from: slashPos, to, insert: '[text](url)' },
        selection: { anchor: slashPos + 1, head: slashPos + 5 },
      });
    },
  },
];

function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);

  // Only trigger at start of line (optionally with leading whitespace)
  const match = textBefore.match(/^(\s*)(\/\w*)$/);
  if (!match) return null;

  return {
    from: pos - match[2].length + 1, // after the /
    options: slashCommands,
    filter: true,
  };
}

export function createSlashCommands(): Extension {
  return autocompletion({
    override: [slashCommandSource],
    defaultKeymap: true,
    icons: false,
  });
}
