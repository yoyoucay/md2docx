# MD2DOCX — Write in Markdown, Share as Word

Write in Markdown. Your boss, client, or colleague needs a Word document. MD2DOCX fixes this. Drop your `.md` file. Get a polished `.docx`. Done.

## Why Markdown?

Markdown is how you think with AI.

When you ask Claude, ChatGPT, or any AI assistant to draft a report or document — it writes Markdown. Because Markdown is clean, structured, and unambiguous. No hidden formatting. No bloated XML. Just text with meaning.

That structure is what makes AI output good. Headings tell the AI what is a section. Bold marks what matters. Lists signal hierarchy. The AI uses these signals to reason about your content.

So your workflow becomes:

```
Prompt AI → get Markdown → MD2DOCX → send Word doc
```

No reformatting. No copy-paste chaos. One click.

---

Desktop Markdown → Word (.docx) converter. Electron shell, Pandoc engine.

## Features
- Drag-drop or browse .md / .markdown / .txt
- Batch convert (queue many files)
- Custom style via reference.docx template
- Optional table of contents
- Choose output folder (or write beside each source)

## Setup (dev)
```bash
npm install
npm start
```

## Pandoc engine
App looks for pandoc in this order:
1. `vendor/pandoc/pandoc` (bundled — recommended)
2. system `PATH`

For zero-install distribution, drop the pandoc binary here:
```
vendor/pandoc/pandoc        # mac / linux
vendor/pandoc/pandoc.exe    # windows
```
Get binaries: https://github.com/jgm/pandoc/releases
(One binary per target OS. Build per-OS, or fall back to system pandoc in dev.)

## Build installers
```bash
npm run dist:win     # NSIS .exe
npm run dist:mac     # .dmg
npm run dist:linux   # AppImage
```
`vendor/pandoc` is copied into the packaged app via `extraResources`.

## Custom styling (reference.docx)
1. Generate a template: `pandoc -o ref.docx --print-default-data-file reference.docx`
2. Open in Word, edit the styles (Heading 1, Normal, etc.), save.
3. Pick it in the app under "Style template."

## Project layout
```
src/
  main.js       main process — pandoc spawn, dialogs, IPC
  preload.js    contextBridge API
  index.html    UI
  style.css     theme
  renderer.js   queue + convert logic
vendor/pandoc/  bundled engine (you add this)
```

## Notes
- `contextIsolation` on, `nodeIntegration` off — renderer talks to main only via `window.api`.
- Conversion runs `execFile`, no shell, so paths with spaces are safe.
