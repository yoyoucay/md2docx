const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const { execFile, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// --- Locate pandoc binary ---------------------------------------------------
// Priority: bundled (vendor/pandoc) > system PATH > where.exe search.
let _pandocCache = null;

function pandocPath() {
  if (_pandocCache) return _pandocCache;

  const exe = process.platform === "win32" ? "pandoc.exe" : "pandoc";

  // Packaged app: extraResources copies vendor/pandoc -> resources/pandoc
  const packaged = path.join(process.resourcesPath || "", "pandoc", exe);
  if (fs.existsSync(packaged)) return (_pandocCache = packaged);

  // Dev: vendor/pandoc in project root
  const dev = path.join(__dirname, "..", "vendor", "pandoc", exe);
  if (fs.existsSync(dev)) return (_pandocCache = dev);

  // Check common Windows install locations before falling back to PATH.
  if (process.platform === "win32") {
    const candidates = [
      path.join("C:\\Program Files\\Pandoc", exe),
      path.join("C:\\Program Files (x86)\\Pandoc", exe),
      path.join(process.env.LOCALAPPDATA || "", "Pandoc", exe),
      path.join(process.env.APPDATA || "", "Pandoc", exe),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return (_pandocCache = p);
    }
  }

  // Use where.exe (full path) / which to find pandoc as CMD/shell sees it.
  try {
    const finder = process.platform === "win32" ? "C:\\Windows\\System32\\where.exe" : "which";
    const found = execFileSync(finder, ["pandoc"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return (_pandocCache = found);
  } catch (_) {}

  return (_pandocCache = exe);
}

// --- Locate typst binary (PDF engine) ---------------------------------------
// Priority: bundled (vendor/typst) > system PATH. Null when unavailable.
let _typstCache;

function typstPath() {
  if (_typstCache !== undefined) return _typstCache;

  const exe = process.platform === "win32" ? "typst.exe" : "typst";

  const packaged = path.join(process.resourcesPath || "", "typst", exe);
  if (fs.existsSync(packaged)) return (_typstCache = packaged);

  const dev = path.join(__dirname, "..", "vendor", "typst", exe);
  if (fs.existsSync(dev)) return (_typstCache = dev);

  try {
    const finder = process.platform === "win32" ? "C:\\Windows\\System32\\where.exe" : "which";
    const found = execFileSync(finder, ["typst"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return (_typstCache = found);
  } catch (_) {}

  return (_typstCache = null);
}

// --- Locate a bundled Lua filter -------------------------------------------
function luaFilterPath(name) {
  const packaged = path.join(process.resourcesPath || "", "filters", name);
  if (fs.existsSync(packaged)) return packaged;

  const dev = path.join(__dirname, "..", "assets", name);
  if (fs.existsSync(dev)) return dev;

  return null;
}

// --- Locate a bundled static asset (root of resources) ----------------------
function assetPath(name) {
  const packaged = path.join(process.resourcesPath || "", name);
  if (fs.existsSync(packaged)) return packaged;

  const dev = path.join(__dirname, "..", "assets", name);
  if (fs.existsSync(dev)) return dev;

  return null;
}

// --- Locate bundled reference.docx -----------------------------------------
function bundledReferencePath() {
  // Packaged: extraResources copies assets/reference.docx -> resources/reference.docx
  const packaged = path.join(process.resourcesPath || "", "reference.docx");
  if (fs.existsSync(packaged)) return packaged;

  // Dev: assets/reference.docx in project root
  const dev = path.join(__dirname, "..", "assets", "reference.docx");
  if (fs.existsSync(dev)) return dev;

  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    backgroundColor: "#15171c",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
}

// --- CLI mode -----------------------------------------------------------------
// `md2docx file1.md file2.docx report.pdf [--out <dir>] [--toc] [--pdf]`
// converts headless and exits. --pdf sends markdown inputs to PDF instead of
// docx; .docx/.pdf inputs always come back as markdown.
function parseCli() {
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  const files = [];
  let outDir = null, toc = false, pdf = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") { outDir = argv[++i] || null; }
    else if (a === "--toc") { toc = true; }
    else if (a === "--pdf") { pdf = true; }
    else if (/\.(md|markdown|txt|docx|pdf)$/i.test(a) && fs.existsSync(a)) files.push(path.resolve(a));
  }
  return files.length ? { files, outDir, toc, pdf } : null;
}

const cli = parseCli();

app.whenReady().then(async () => {
  if (cli) {
    let failed = 0;
    for (const input of cli.files) {
      const direction = /\.docx$/i.test(input) ? "docx2md"
        : /\.pdf$/i.test(input) ? "pdf2md"
        : cli.pdf ? "md2pdf" : "md2docx";
      const r = await convertFile({ input, outDir: cli.outDir, toc: cli.toc, direction, collision: "rename" });
      if (r.ok) console.log(`OK  ${input} -> ${r.output}`);
      else { console.error(`ERR ${input}: ${r.error}`); failed++; }
    }
    app.exit(failed ? 1 : 0);
    return;
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC: pick markdown files ----------------------------------------------
ipcMain.handle("pick:md", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose Markdown files",
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    properties: ["openFile", "multiSelections"]
  });
  return r.canceled ? [] : r.filePaths;
});

// --- IPC: pick docx files --------------------------------------------------
ipcMain.handle("pick:docx", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose Word documents",
    filters: [{ name: "Word", extensions: ["docx"] }],
    properties: ["openFile", "multiSelections"]
  });
  return r.canceled ? [] : r.filePaths;
});

// --- IPC: pick pdf files -----------------------------------------------------
ipcMain.handle("pick:pdf", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose PDF documents",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["openFile", "multiSelections"]
  });
  return r.canceled ? [] : r.filePaths;
});

// --- IPC: pick reference.docx template -------------------------------------
ipcMain.handle("pick:template", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose reference .docx (styling template)",
    filters: [{ name: "Word", extensions: ["docx"] }],
    properties: ["openFile"]
  });
  return r.canceled ? null : r.filePaths[0];
});

// --- IPC: pick output folder ------------------------------------------------
ipcMain.handle("pick:outdir", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose output folder",
    properties: ["openDirectory", "createDirectory"]
  });
  return r.canceled ? null : r.filePaths[0];
});

// --- IPC: open file in default app -----------------------------------------
ipcMain.handle("shell:open", (_e, filePath) => shell.openPath(filePath));

// --- IPC: open URL in default browser ----------------------------------------
ipcMain.handle("shell:openUrl", (_e, url) => {
  if (/^https?:\/\/|^mailto:/.test(url)) shell.openExternal(url);
});

// --- IPC: app info for About dialog ------------------------------------------
ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
}));

// --- IPC: expand dropped paths (folders recurse to matching files) ----------
ipcMain.handle("paths:expand", (_e, { paths, exts }) => {
  const allow = new Set(exts.map((s) => s.toLowerCase()));
  const out = [];
  const MAX_FILES = 500, MAX_DEPTH = 8;

  const walk = (p, depth) => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let st;
    try { st = fs.statSync(p); } catch (_) { return; }
    if (st.isDirectory()) {
      let entries;
      try { entries = fs.readdirSync(p); } catch (_) { return; }
      for (const name of entries) {
        if (name.startsWith(".") || name === "node_modules") continue;
        walk(path.join(p, name), depth + 1);
      }
    } else if (allow.has(path.extname(p).toLowerCase())) {
      out.push(p);
    }
  };

  for (const p of paths) walk(p, 0);
  return out;
});

// --- IPC: resize window to fit renderer content -----------------------------
ipcMain.on("win:resize", (e, contentHeight) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const [width, currentHeight] = win.getContentSize();
  const workArea = screen.getDisplayMatching(win.getBounds()).workAreaSize;
  const maxHeight = Math.round(workArea.height * 0.9);
  const target = Math.max(420, Math.min(Math.round(contentHeight), maxHeight));
  if (target === currentHeight) return;
  console.log(`[win:resize] content ${currentHeight} -> ${target}`);
  win.setContentSize(width, target);
});

// --- IPC: check GitHub for a newer release -----------------------------------
// Uses the /releases/latest redirect instead of the REST API: no rate limit,
// no JSON. Location header ends in /releases/tag/v<semver>.
const RELEASES_LATEST = "https://github.com/yoyoucay/md2docx/releases/latest";

function cmpVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

ipcMain.handle("update:check", async () => {
  try {
    const res = await fetch(RELEASES_LATEST, {
      redirect: "manual",
      headers: { "User-Agent": `md2docx/${app.getVersion()}` },
      signal: AbortSignal.timeout(8000),
    });
    const loc = res.headers.get("location") || "";
    const m = loc.match(/\/releases\/tag\/v?(\d+(?:\.\d+)*)/);
    if (!m) return { update: false };
    const latest = m[1], current = app.getVersion();
    const update = cmpVersions(latest, current) > 0;
    console.log(`[update:check] current ${current}, latest ${latest}${update ? " — update available" : ""}`);
    return { update, latest, current, url: loc };
  } catch (err) {
    console.log("[update:check] skipped:", err.message); // offline etc. — never bother the user
    return { update: false };
  }
});

// --- IPC: check pandoc is reachable ----------------------------------------
ipcMain.handle("pandoc:check", async () => {
  const p = pandocPath();
  return new Promise((resolve) => {
    execFile(p, ["--version"], (err, stdout) => {
      if (err) {
        console.error("[pandoc:check] failed - path:", p);
        console.error("[pandoc:check]", err.message);
        return resolve({ ok: false, version: null });
      }
      const first = String(stdout).split("\n")[0].trim();
      const pdf = !!typstPath();
      console.log("[pandoc:check] OK -", first, pdf ? "(+typst)" : "(no typst)");
      resolve({ ok: true, version: first, pdf });
    });
  });
});

// --- Conversion core ---------------------------------------------------------
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) {
    const cand = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return p;
}

const activeJobs = new Map(); // jobId -> child process

// Lazy-load the PDF parser (pdfjs-based, ~2s require) only when first needed.
let _pdf2md = null;
function pdf2md(buf) {
  if (!_pdf2md) _pdf2md = require("@opendocsg/pdf2md");
  return _pdf2md(buf);
}

// Post-process converted markdown so it pastes cleanly into an AI chat:
// no trailing whitespace, no runs of blank lines, single trailing newline.
function cleanMarkdown(md) {
  return md
    .replace(/^\uFEFF/, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/, "\n");
}

// Cover page: promote the first H1 to pandoc title metadata (rendered as a
// title block before the TOC in both docx and pdf writers), then strip that
// H1 from the body so it isn't rendered twice.
function promoteH1(input, base) {
  let title = base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  try {
    const src = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "");
    const h1 = src.match(/^#\s+(.+?)\s*$/m);
    if (h1) {
      title = h1[1].trim();
      const body = (src.slice(0, h1.index) + src.slice(h1.index + h1[0].length)).replace(/^\s*\n/, "");
      const tempFile = path.join(os.tmpdir(), `md2docx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
      fs.writeFileSync(tempFile, body, "utf8");
      return { pandocInput: tempFile, title, tempFile };
    }
  } catch (_) {}
  return { pandocInput: input, title, tempFile: null }; // convert original untouched
}

// opts: { input, outDir, template, toc, direction, collision, extraArgs, jobId }
function convertFile(opts) {
  const { input, outDir, template, toc, direction, collision, extraArgs, jobId } = opts;
  const base = path.basename(input, path.extname(input));

  const toMd = direction === "docx2md" || direction === "pdf2md";
  const outExt = toMd ? ".md" : direction === "md2pdf" ? ".pdf" : ".docx";
  let out = path.join(outDir || path.dirname(input), base + outExt);

  // Collision policy: rename (default) | overwrite | skip
  if (fs.existsSync(out)) {
    if (collision === "skip") {
      return Promise.resolve({ ok: false, input, error: "output already exists (skip policy)" });
    }
    if (collision !== "overwrite") out = uniquePath(out);
  }

  // PDF -> MD runs in-process (pdfjs heuristics), not through pandoc.
  if (direction === "pdf2md") {
    return (async () => {
      try {
        const md = await pdf2md(fs.readFileSync(input));
        fs.writeFileSync(out, cleanMarkdown(md), "utf8");
        console.log("[convert] OK (pdf2md):", out);
        return { ok: true, input, output: out };
      } catch (err) {
        console.error("[convert] FAILED (pdf2md):", input, err.message);
        return { ok: false, input, error: err.message };
      }
    })();
  }

  let args, tempFile = null;
  if (direction === "docx2md") {
    // GFM keeps the output AI-friendly: pipe tables, ATX headings, no
    // pandoc attribute spans or raw OOXML leftovers, no hard line wraps.
    args = [input, "-f", "docx", "-t", "gfm-raw_html", "--wrap=none", "-o", out,
            "--extract-media", `${base}_media`];
  } else if (direction === "md2pdf") {
    const typst = typstPath();
    if (!typst) {
      return Promise.resolve({ ok: false, input, error: "PDF engine (typst) not found" });
    }
    const p = promoteH1(input, base);
    tempFile = p.tempFile;
    args = [p.pandocInput, "-f", "markdown", "-o", out, "--pdf-engine", typst, "--metadata", `title=${p.title}`];
    if (toc) args.push("--toc");
  } else {
    const p = promoteH1(input, base);
    tempFile = p.tempFile;
    args = [p.pandocInput, "-f", "markdown", "-t", "docx", "-o", out, "--metadata", `title=${p.title}`];

    const pageBreak = assetPath("pagebreak.xml");
    if (pageBreak) args.push("--include-before-body", pageBreak);

    if (toc) {
      args.push("--toc");
      const filter = luaFilterPath("toc-pagebreak.lua");
      if (filter) args.push("--lua-filter", filter);
    }
    const ref = template || bundledReferencePath();
    if (ref) args.push("--reference-doc", ref);
  }

  if (Array.isArray(extraArgs)) {
    for (const a of extraArgs) {
      if (typeof a === "string" && a.length && !a.includes("\0")) args.push(a);
    }
  }

  console.log("[convert] pandoc", args.join(" "));
  return new Promise((resolve) => {
    // cwd = output dir so --extract-media paths inside the md stay relative.
    const child = execFile(pandocPath(), args, { cwd: path.dirname(out) }, (err, _stdout, stderr) => {
      if (jobId != null) activeJobs.delete(jobId);
      if (tempFile) fs.unlink(tempFile, () => {});
      if (err) {
        if (err.killed || child.killed) {
          console.log("[convert] CANCELLED:", input);
          return resolve({ ok: false, input, cancelled: true, error: "cancelled" });
        }
        const msg = String(stderr || err.message).trim();
        console.error("[convert] FAILED:", input);
        console.error("[convert]", msg);
        resolve({ ok: false, input, error: msg });
      } else {
        if (toMd) {
          try { fs.writeFileSync(out, cleanMarkdown(fs.readFileSync(out, "utf8")), "utf8"); } catch (_) {}
        }
        console.log("[convert] OK:", out);
        resolve({ ok: true, input, output: out });
      }
    });
    if (jobId != null) activeJobs.set(jobId, child);
  });
}

// --- IPC: convert one file ----------------------------------------------------
ipcMain.handle("convert:one", (_e, opts) => convertFile(opts));

// --- IPC: cancel all running conversions ---------------------------------------
ipcMain.on("convert:cancelAll", () => {
  console.log(`[convert] cancel requested — killing ${activeJobs.size} job(s)`);
  for (const child of activeJobs.values()) {
    try { child.kill(); } catch (_) {}
  }
  activeJobs.clear();
});

// --- IPC: check a saved path still exists --------------------------------------
ipcMain.handle("fs:exists", (_e, p) => {
  try { return typeof p === "string" && fs.existsSync(p); } catch (_) { return false; }
});

// --- IPC: watch folder ----------------------------------------------------------
let watcher = null;
const watchNotified = new Set();

ipcMain.handle("watch:start", (e, { dir, exts }) => {
  if (watcher) { watcher.close(); watcher = null; }
  watchNotified.clear();
  try {
    watcher = fs.watch(dir, (_event, name) => {
      if (!name) return;
      const p = path.join(dir, name);
      if (!exts.some((x) => p.toLowerCase().endsWith(x))) return;
      // Delay: give the writing process time to finish the file.
      setTimeout(() => {
        if (!fs.existsSync(p) || watchNotified.has(p)) return;
        watchNotified.add(p);
        setTimeout(() => watchNotified.delete(p), 5000); // allow re-notify later
        if (!e.sender.isDestroyed()) e.sender.send("watch:file", p);
      }, 800);
    });
    console.log("[watch] watching", dir);
    return true;
  } catch (err) {
    console.error("[watch] failed:", err.message);
    return false;
  }
});

ipcMain.handle("watch:stop", () => {
  if (watcher) { watcher.close(); watcher = null; }
  watchNotified.clear();
  return true;
});

