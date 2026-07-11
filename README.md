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

Desktop Markdown → Word (.docx) / PDF converter. Electron shell, Pandoc engine, Typst PDF backend.

## Features
- Drag-drop or browse .md / .markdown / .txt
- Four directions: MD → DOCX, MD → PDF, DOCX → MD, PDF → MD
- AI-ready Markdown output: GitHub-flavored (pipe tables, ATX headings),
  no pandoc attribute junk, no hard line wraps — paste straight into AI chat
- Batch convert (queue many files, 3 in parallel, cancellable)
- Custom style via reference.docx template (docx output)
- Optional table of contents
- Choose output folder (or write beside each source)
- Convert-on-drop, watch folder, recent outputs, headless CLI
- Update check on launch (GitHub releases; silent when offline)

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

## PDF engine (typst)
PDF output routes through pandoc's `--pdf-engine` using Typst. Lookup order:
1. `vendor/typst/typst` (bundled — `typst.exe` on Windows)
2. system `PATH`

Get binaries: https://github.com/typst/typst/releases
If typst is missing the MD → PDF toggle is disabled; docx conversion is unaffected.

## PDF → MD
Pandoc cannot read PDF, so this direction uses `@opendocsg/pdf2md` (pdfjs text
extraction + layout heuristics) in-process. Headings, lists, and emphasis
survive; complex tables and multi-column layouts degrade to plain text — PDFs
carry no semantic structure to recover.

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
vendor/typst/   bundled PDF engine (you add this)
```

## Notes
- `contextIsolation` on, `nodeIntegration` off — renderer talks to main only via `window.api`.
- Conversion runs `execFile`, no shell, so paths with spaces are safe.

## Bundled binaries & licensing
- App code: MIT.
- Pandoc is GPL-2.0-or-later; its `COPYING.md` / `COPYRIGHT.txt` ship next to the binary in the installed app (`resources/pandoc/`). Source: https://github.com/jgm/pandoc
- Typst is Apache-2.0; its `LICENSE` / `NOTICE` ship in `resources/typst/`. Source: https://github.com/typst/typst
