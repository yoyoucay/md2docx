const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Expose narrow, safe API to renderer. No raw ipc/node access.
contextBridge.exposeInMainWorld("api", {
  pickMd: () => ipcRenderer.invoke("pick:md"),
  pickDocx: () => ipcRenderer.invoke("pick:docx"),
  pickPdf: () => ipcRenderer.invoke("pick:pdf"),
  pickTemplate: () => ipcRenderer.invoke("pick:template"),
  pickOutDir: () => ipcRenderer.invoke("pick:outdir"),
  pandocCheck: () => ipcRenderer.invoke("pandoc:check"),
  convertOne: (opts) => ipcRenderer.invoke("convert:one", opts),
  cancelAll: () => ipcRenderer.send("convert:cancelAll"),
  pathExists: (p) => ipcRenderer.invoke("fs:exists", p),
  watchStart: (dir, exts) => ipcRenderer.invoke("watch:start", { dir, exts }),
  watchStop: () => ipcRenderer.invoke("watch:stop"),
  onWatchFile: (cb) => ipcRenderer.on("watch:file", (_e, p) => cb(p)),
  openFile: (p) => ipcRenderer.invoke("shell:open", p),
  openUrl: (u) => ipcRenderer.invoke("shell:openUrl", u),
  appInfo: () => ipcRenderer.invoke("app:info"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  // Electron 32+ dropped the old File.path shortcut for security; this is the replacement.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  expandPaths: (paths, exts) => ipcRenderer.invoke("paths:expand", { paths, exts }),
  resizeWindow: (contentHeight) => ipcRenderer.send("win:resize", contentHeight)
});
