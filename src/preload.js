const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bassPractice", {
  getLibrary: () => ipcRenderer.invoke("library:get"),
  refreshLibrary: () => ipcRenderer.invoke("library:refresh"),
  getSong: (songId) => ipcRenderer.invoke("song:get", songId)
});
