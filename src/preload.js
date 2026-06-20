const { contextBridge, ipcRenderer } = require("electron");

// Expose narrow, safe API to renderer. No raw ipc/node access.
contextBridge.exposeInMainWorld("api", {
  pickMd: () => ipcRenderer.invoke("pick:md"),
  pickTemplate: () => ipcRenderer.invoke("pick:template"),
  pickOutDir: () => ipcRenderer.invoke("pick:outdir"),
  pandocCheck: () => ipcRenderer.invoke("pandoc:check"),
  convertOne: (opts) => ipcRenderer.invoke("convert:one", opts),
  openFile: (p) => ipcRenderer.invoke("shell:open", p)
});
