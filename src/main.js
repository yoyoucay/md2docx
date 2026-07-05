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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
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
      console.log("[pandoc:check] OK -", first);
      resolve({ ok: true, version: first });
    });
  });
});

// --- IPC: convert one file --------------------------------------------------
// opts: { input, outDir, template, toc, direction }
ipcMain.handle("convert:one", async (_e, opts) => {
  const { input, outDir, template, toc, direction } = opts;
  const base = path.basename(input, path.extname(input));

  let args, out;
  let tempFile = null;

  if (direction === "docx2md") {
    out = path.join(outDir || path.dirname(input), base + ".md");
    args = [input, "-f", "docx", "-t", "markdown", "-o", out];
  } else {
    out = path.join(outDir || path.dirname(input), base + ".docx");

    // Cover page: promote the first H1 to a real title page via pandoc's
    // title metadata (which the docx writer always places before the TOC),
    // then strip that H1 from the body so it isn't rendered twice.
    let pandocInput = input;
    let title = base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    try {
      const src = fs.readFileSync(input, "utf8");
      const h1 = src.match(/^#\s+(.+?)\s*$/m);
      if (h1) {
        title = h1[1].trim();
        const body = (src.slice(0, h1.index) + src.slice(h1.index + h1[0].length)).replace(/^\s*\n/, "");
        tempFile = path.join(os.tmpdir(), `md2docx-${process.pid}-${Date.now()}.md`);
        fs.writeFileSync(tempFile, body, "utf8");
        pandocInput = tempFile;
      }
    } catch (_) {
      pandocInput = input; // fall back to converting the original file untouched
    }

    args = [pandocInput, "-f", "markdown", "-t", "docx", "-o", out, "--metadata", `title=${title}`];

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

  console.log("[convert] pandoc", args.join(" "));
  return new Promise((resolve) => {
    execFile(pandocPath(), args, (err, _stdout, stderr) => {
      if (tempFile) fs.unlink(tempFile, () => {});
      if (err) {
        const msg = String(stderr || err.message).trim();
        console.error("[convert] FAILED:", input);
        console.error("[convert]", msg);
        resolve({ ok: false, input, error: msg });
      } else {
        console.log("[convert] OK:", out);
        resolve({ ok: true, input, output: out });
      }
    });
  });
});

