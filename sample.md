# Quarterly Project Report

## Executive Summary

This document is a **sample Markdown file** for testing MD2DOCX conversion. It covers every common element: headings, lists, tables, code, quotes, and links. The first heading above becomes the *cover page title*, and this section should start on a new page when Table of Contents is enabled.

## Project Status

Work progressed across three tracks this quarter. The team shipped the desktop converter, upgraded core dependencies, and fixed several long-standing UI issues.

### Completed

- Upgraded Electron runtime to version 43
- Fixed drag-and-drop file handling
- Added automatic window resizing
- Bundled Pandoc 3.10 with the installer

### In Progress

1. Folder drag-and-drop support
2. Batch conversion progress indicator
3. PDF export option

> **Note:** items in progress are targeted for the next release. Priorities may shift based on user feedback.

## Metrics

| Metric              | Q1     | Q2     | Change |
|---------------------|--------|--------|--------|
| Active users        | 1,240  | 2,180  | +76%   |
| Conversions per day | 350    | 890    | +154%  |
| Crash reports       | 14     | 2      | -86%   |

## Technical Notes

Conversion is handled by Pandoc under the hood. A typical invocation looks like this:

```bash
pandoc input.md -f markdown -t docx -o output.docx \
  --toc --reference-doc reference.docx
```

Inline code such as `--metadata title=` is used to set the cover page title. See the [Pandoc manual](https://pandoc.org/MANUAL.html) for the full option list.

### Definition List

Reference document
:   A .docx file whose named styles (Title, Heading 1, Body Text) control the look of the converted output.

Lua filter
:   A small script Pandoc runs during conversion; this app uses one to insert a page break after the table of contents.

---

## Conclusion

If this file converts with a cover page, a table of contents on its own page, styled headings, a readable table, and highlighted code, the pipeline works end to end.
