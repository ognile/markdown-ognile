# Markdown Ognile

Obsidian-style live preview markdown editor for VS Code.

## Features

- **Inline live preview** -- rendered markdown as you type, no split pane needed
- **Formatting shortcuts** -- Bold (`Cmd/Ctrl+B`), Italic (`Cmd/Ctrl+I`), Strikethrough (`Cmd/Ctrl+Shift+X`), Links (`Cmd/Ctrl+K`)
- **Smart formatting** -- toggles on/off, expands to word when nothing is selected, works with multiple cursors
- **Copy as Rich Text** (`Cmd/Ctrl+Shift+C`) -- paste formatted markdown into other apps
- **Smart paste** -- paste HTML and it converts to markdown automatically
- **Image paste** -- paste images directly, saved to `assets/` folder
- **Inline table editing** -- edit table cells directly in the live preview
- **Link navigation** -- `Ctrl/Cmd+Click` to open links; internal `.md` links open in the workspace
- **Switch editors** -- toggle between Ognile and the raw text editor with `Cmd/Ctrl+K Y`

## Configuration

| Setting | Description | Default |
|---|---|---|
| `ognile.shortcuts.mode` | Shortcut routing: `hybrid`, `hostOnly`, or `webviewOnly` | `hybrid` |
| `ognile.formatting.emptySelectionBehavior` | Format with no selection: `word` or `markers` | `word` |
| `ognile.formatting.italicDelimiter` | Italic style: `underscore` or `asterisk` | `underscore` |
| `ognile.ui.motionLevel` | Animation intensity: `off`, `subtle`, or `full` | `subtle` |
| `ognile.ui.widgetDensity` | Widget spacing: `comfortable` or `compact` | `comfortable` |
| `ognile.ui.typographyScale` | Heading size multiplier (0.85 - 1.35) | `1` |

## License

MIT
