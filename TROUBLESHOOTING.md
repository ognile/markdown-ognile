# Ognile Troubleshooting Log

## Problem: White screen / garbled rendering when decoration plugin is enabled

### What works

- CM6 editor WITHOUT decoration plugin: renders raw markdown correctly
- Sync (bidirectional with extension host) works
- Extension activation works (confirmed in exthost.log)

### What fails

- Enabling `decorationPlugin` in editor extensions → white screen (editor doesn't render)

### Attempts that failed

#### Attempt 1: Initial decoration system

- Used `RangeSetBuilder` with manual sorting + dedup
- All decoration builders accepted `SyntaxNode` type directly
- `tree.iterate({ enter(node: SyntaxNode) })` — but iterate passes `SyntaxNodeRef` (TreeCursor), not `SyntaxNode`
- Result: garbled single-line text (all content collapsed into one line)
- Root cause of garble: was the CSS (`* { margin: 0; padding: 0; box-sizing: border-box }` + `body { overflow: hidden }` + `#app { height: 100vh }`) — NOT the decorations

#### Attempt 2: Fixed SyntaxNodeRef, used Decoration.set()

- Changed to `cursor.node` to get SyntaxNode from TreeCursor
- Switched from `RangeSetBuilder` to `Decoration.set(ranges, true)` for auto-sorting
- Added try/catch around `Decoration.set()`
- Result: white screen

#### Attempt 3: Added RangeTracker to prevent overlapping replaces

- Created `RangeTracker` class that checks for overlapping replace decorations
- Used `isReplaceLike()` to detect replace decorations by inspecting internal properties
- Added try/catch in the ViewPlugin constructor AND in `collectDecorations`
- Added try/catch inside the `enter` callback for each node
- Result: white screen

### Suspected root causes (untested)

1. **`isReplaceLike()` detection is wrong** — `Decoration.replace({})` without widget might not be detected, causing overlapping replaces to sneak through
2. **CM6 crashes during rendering** not during `Decoration.set()` — the try/catch catches set creation errors but not rendering errors
3. **Frontmatter replace (0 to N) overlaps with other decorations** — tree nodes inside frontmatter range still get processed and create conflicting decorations
4. **Node names might differ** from what was assumed — e.g., `Link` children might not have `LinkLabel`, `URL` as expected

### Next steps to try

1. **Start with ZERO decorations enabled** — just the plugin returning `Decoration.none` always → verify editor renders
2. **Add ONE decoration type at a time** — headings first (line decoration + replace), test, then add bold, then italic, etc.
3. **Log node names** — dump all node names from the syntax tree to verify they match expectations
4. **Check if `cursor.node` works** — log `typeof cursor.node` and `cursor.node.name` to verify
5. **Remove frontmatter entirely** — it's the most likely source of overlapping replaces since it replaces a large block at position 0

### Architecture note

- The `enter` callback in `tree.iterate()` receives a `TreeCursor` (implements `SyntaxNodeRef`)
- Must call `.node` to get `SyntaxNode` with `.getChild()`, `.firstChild`, `.nextSibling`
- `Decoration.set(ranges, true)` sorts automatically but STILL throws on overlapping replace decorations
- Replace decorations: `Decoration.replace()` with `from < to` — hides content
- Mark decorations: `Decoration.mark()` — adds CSS class, can overlap
- Line decorations: `Decoration.line()` — `from === to` at line start, can overlap
- Widget decorations: `Decoration.widget()` — `from === to` point insertion