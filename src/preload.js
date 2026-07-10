const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bassPractice", {
  getLibrary: () => ipcRenderer.invoke("library:get"),
  refreshLibrary: () => ipcRenderer.invoke("library:refresh"),
  chooseLibrary: () => ipcRenderer.invoke("library:choose"),
  chooseAndImportStems: () => ipcRenderer.invoke("stems:choose-and-import"),
  onStemImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("stems:progress", listener);
    return () => ipcRenderer.removeListener("stems:progress", listener);
  },
  getState: () => ipcRenderer.invoke("state:get"),
  saveState: (state) => ipcRenderer.invoke("state:save", state),
  getSong: (songId) => ipcRenderer.invoke("song:get", songId),
  toggleChords: (title) => ipcRenderer.invoke("chords:toggle", title),
  updateChords: (title) => ipcRenderer.invoke("chords:update", title),
  getSongNotes: (songId) => ipcRenderer.invoke("song:notes:get", songId),
  saveSongNotes: (songId, notes) => ipcRenderer.invoke("song:notes:save", songId, notes)
});
