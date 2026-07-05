const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Expose narrow, safe API to renderer. No raw ipc/node access.
contextBridge.exposeInMainWorld("api", {
  pickMd: () => ipcRenderer.invoke("pick:md"),
  pickDocx: () => ipcRenderer.invoke("pick:docx"),
  pickTemplate: () => ipcRenderer.invoke("pick:template"),
  pickOutDir: () => ipcRenderer.invoke("pick:outdir"),
  pandocCheck: () => ipcRenderer.invoke("pandoc:check"),
  convertOne: (opts) => ipcRenderer.invoke("convert:one", opts),
  openFile: (p) => ipcRenderer.invoke("shell:open", p),
  // Electron 32+ dropped the old File.path shortcut for security; this is the replacement.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  expandPaths: (paths, exts) => ipcRenderer.invoke("paths:expand", { paths, exts }),
  resizeWindow: (contentHeight) => ipcRenderer.send("win:resize", contentHeight)
});
