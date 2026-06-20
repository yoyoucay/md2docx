const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { execFile, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

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

  // Use where.exe (Windows) / which (Unix) to find pandoc as CMD/shell sees it.
  // Electron's PATH may omit directories that CMD inherits from the registry.
  try {
    const finder = process.platform === "win32" ? "where.exe" : "which";
    const found = execFileSync(finder, [exe.replace(".exe", "")], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return (_pandocCache = found);
  } catch (_) {}

  return (_pandocCache = exe);
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

// --- IPC: check pandoc is reachable ----------------------------------------
ipcMain.handle("pandoc:check", async () => {
  return new Promise((resolve) => {
    execFile(pandocPath(), ["--version"], (err, stdout) => {
      if (err) return resolve({ ok: false, version: null });
      const first = String(stdout).split("\n")[0].trim();
      resolve({ ok: true, version: first });
    });
  });
});

// --- IPC: convert one file --------------------------------------------------
// opts: { input, outDir, template, toc }
ipcMain.handle("convert:one", async (_e, opts) => {
  const { input, outDir, template, toc } = opts;
  const base = path.basename(input, path.extname(input));
  const out = path.join(outDir || path.dirname(input), base + ".docx");

  const args = [input, "-f", "markdown", "-t", "docx", "-o", out];
  if (toc) args.push("--toc");
  if (template) args.push("--reference-doc", template);

  return new Promise((resolve) => {
    execFile(pandocPath(), args, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, input, error: String(stderr || err.message).trim() });
      } else {
        resolve({ ok: true, input, output: out });
      }
    });
  });
});
