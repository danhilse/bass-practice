const { app, BrowserView, BrowserWindow, dialog, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let audioRoot =
  process.env.BASS_PRACTICE_LIBRARY || "/Users/danielhilse/Documents/audio/demuc";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aif", ".aiff", ".m4a", ".flac", ".ogg", ".aac"]);
const NOTES_FILE_NAME = "notes.md";
const DEMUCS_MODEL = "htdemucs";
let libraryCache = null;
let savedState = {};
let mainWindow = null;
let chordsView = null;
let chordsVisible = false;
let stemImportRunning = false;

function chordsSearchUrl(title) {
  const query = `${title.trim()} chords site:ultimate-guitar.com`;
  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(query)}`;
}

function positionChordsView() {
  if (!mainWindow || !chordsView || !chordsVisible) return;
  const [width, height] = mainWindow.getContentSize();
  const headerHeight = 72;
  chordsView.setBounds({
    x: Math.round(width * 0.48),
    y: headerHeight,
    width: Math.round(width * 0.52),
    height: Math.max(0, height - headerHeight)
  });
}

function hideChordsView() {
  if (!mainWindow || !chordsView) return;
  mainWindow.removeBrowserView(chordsView);
  chordsVisible = false;
}

async function showChordsView(title) {
  if (!mainWindow || typeof title !== "string" || !title.trim()) return false;

  if (!chordsView) {
    chordsView = new BrowserView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    chordsView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }

  mainWindow.setBrowserView(chordsView);
  chordsVisible = true;
  positionChordsView();
  await chordsView.webContents.loadURL(chordsSearchUrl(title));
  return true;
}

function stateFilePath() {
  return path.join(app.getPath("userData"), "player-state.json");
}

async function loadSavedState() {
  try {
    savedState = JSON.parse(await fs.readFile(stateFilePath(), "utf8"));
    if (!process.env.BASS_PRACTICE_LIBRARY && typeof savedState.libraryRoot === "string") {
      audioRoot = savedState.libraryRoot;
    }
  } catch {
    savedState = {};
  }
}

async function saveState(partialState) {
  savedState = { ...savedState, ...partialState, libraryRoot: audioRoot };
  await fs.writeFile(stateFilePath(), JSON.stringify(savedState, null, 2), "utf8");
  return savedState;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
}

async function uniqueDirectory(parent, desiredName) {
  let candidate = path.join(parent, safeName(desiredName));
  let count = 2;
  while (await exists(candidate)) {
    candidate = path.join(parent, `${safeName(desiredName)} (${count})`);
    count += 1;
  }
  return candidate;
}

function runDemucs(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-m", "demucs", ...args], {
      env: {
        ...process.env,
        // Keep model weights in the app's data folder. Demucs/Torch will download a
        // missing model once and re-use this cache on every later separation.
        TORCH_HOME: path.join(app.getPath("userData"), "demucs-models")
      }
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
      options.onOutput?.(data.toString());
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
      options.onOutput?.(data.toString());
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `Demucs stopped with code ${code}.`));
    });
  });
}

async function sourceAudioFiles(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(folder, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function moveFile(source, destination) {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs.copyFile(source, destination);
    await fs.rm(source, { force: true });
  }
}

async function listDirectories(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function findStemDirs(dirPath, depth = 0) {
  if (depth > 5) return [];

  const names = await listDirectories(dirPath);
  const found = [];

  for (const name of names) {
    const childPath = path.join(dirPath, name);
    if (name.toLowerCase() === "stems") {
      found.push(childPath);
      continue;
    }
    found.push(...(await findStemDirs(childPath, depth + 1)));
  }

  return found;
}

function stemNameFromFile(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const parts = baseName.split(" - ").map((p) => p.trim().toLowerCase());
  // Demucs/demuc format: "SongTitle - stem - SongTitle" → stem is at index 1
  // Simple format: "stem" or "stem.wav" → stem is at index 0
  if (parts.length >= 3) return parts[1] || parts[0];
  // Two-part: pick the shorter segment (stem names are shorter than song titles)
  if (parts.length === 2) return parts[0].length <= parts[1].length ? parts[0] : parts[1];
  return parts[0];
}

async function readStems(stemsDir) {
  const entries = await fs.readdir(stemsDir, { withFileTypes: true });
  const stems = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) continue;

    const filePath = path.join(stemsDir, entry.name);
    stems.push({
      name: stemNameFromFile(entry.name),
      fileName: entry.name,
      path: filePath,
      url: pathToFileURL(filePath).toString()
    });
  }

  return stems.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildLibrary() {
  if (!(await exists(audioRoot))) {
    return { root: audioRoot, albums: [], songs: [] };
  }

  const stemDirs = await findStemDirs(audioRoot);
  const songs = [];

  for (const stemsDir of stemDirs) {
    const stems = await readStems(stemsDir);
    if (!stems.length) continue;

    const songDir = path.dirname(stemsDir);
    const relativeSongDir = path.relative(audioRoot, songDir);
    const parts = relativeSongDir.split(path.sep);
    const album = parts[0] || "Library";
    const title = path.basename(songDir);
    const id = Buffer.from(relativeSongDir).toString("base64url");

    songs.push({
      id,
      album,
      title,
      relativePath: relativeSongDir,
      stems: stems.map(({ name, fileName }) => ({ name, fileName }))
    });
  }

  songs.sort((a, b) => a.album.localeCompare(b.album) || a.title.localeCompare(b.title));

  const albums = [...new Set(songs.map((song) => song.album))].sort((a, b) =>
    a.localeCompare(b)
  );

  return { root: audioRoot, albums, songs };
}

async function getLibrary() {
  libraryCache = libraryCache || (await buildLibrary());
  return libraryCache;
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(["media", "speaker-selection"].includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ["media", "speaker-selection"].includes(permission)
  );

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 620,
    title: "",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#101114",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  await win.loadFile(path.join(__dirname, "index.html"));
  mainWindow = win;
  win.on("resize", positionChordsView);
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      chordsView = null;
      chordsVisible = false;
    }
  });
}

app.whenReady().then(async () => {
  await loadSavedState();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("library:get", async () => getLibrary());

ipcMain.handle("library:refresh", async () => {
  libraryCache = await buildLibrary();
  return libraryCache;
});

ipcMain.handle("library:choose", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose Stem Deck library",
    defaultPath: audioRoot,
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  audioRoot = result.filePaths[0];
  libraryCache = await buildLibrary();
  await saveState({});
  return libraryCache;
});

ipcMain.handle("stems:choose-and-import", async (event) => {
  if (stemImportRunning) {
    return { ok: false, message: "A stem separation is already running." };
  }

  const selection = await dialog.showOpenDialog({
    title: "Choose a new album folder to add to this library",
    properties: ["openDirectory"]
  });
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true };

  const sourceFolder = selection.filePaths[0];
  const audioFiles = await sourceAudioFiles(sourceFolder);
  if (!audioFiles.length) {
    return { ok: false, message: "No supported audio files were found in that folder." };
  }

  stemImportRunning = true;
  const sendProgress = (progress) => event.sender.send("stems:progress", progress);
  const albumName = safeName(path.basename(sourceFolder));
  const albumDirectory = await uniqueDirectory(audioRoot, albumName);
  const tempDirectory = await fs.mkdtemp(path.join(app.getPath("temp"), "stem-deck-demucs-"));

  try {
    await fs.mkdir(albumDirectory, { recursive: true });
    sendProgress({ phase: "starting", current: 0, total: audioFiles.length, album: path.basename(albumDirectory) });

    for (const [index, inputFile] of audioFiles.entries()) {
      const title = safeName(path.basename(inputFile, path.extname(inputFile)));
      sendProgress({ phase: "separating", current: index + 1, total: audioFiles.length, title });
      await runDemucs(["-n", DEMUCS_MODEL, "--out", tempDirectory, inputFile], {
        onOutput: (line) => {
          if (/download|Downloading/i.test(line)) {
            sendProgress({ phase: "downloading", current: index + 1, total: audioFiles.length, title });
          }
        }
      });

      const modelDirectory = path.join(tempDirectory, DEMUCS_MODEL);
      const outputFolders = await fs.readdir(modelDirectory, { withFileTypes: true });
      const outputFolder = outputFolders.find((entry) => entry.isDirectory());
      if (!outputFolder) throw new Error(`Demucs did not create stems for ${title}.`);

      const generatedStems = path.join(modelDirectory, outputFolder.name);
      const targetSongDirectory = await uniqueDirectory(albumDirectory, title);
      const targetStemsDirectory = path.join(targetSongDirectory, "Stems");
      await fs.mkdir(targetStemsDirectory, { recursive: true });
      const stemFiles = await fs.readdir(generatedStems, { withFileTypes: true });
      for (const stem of stemFiles) {
        if (stem.isFile() && path.extname(stem.name).toLowerCase() === ".wav") {
          await moveFile(path.join(generatedStems, stem.name), path.join(targetStemsDirectory, stem.name));
        }
      }
      await fs.rm(generatedStems, { recursive: true, force: true });
    }

    libraryCache = await buildLibrary();
    const importedSongs = libraryCache.songs.filter((song) => song.album === path.basename(albumDirectory));
    sendProgress({ phase: "complete", current: audioFiles.length, total: audioFiles.length, album: path.basename(albumDirectory) });
    return { ok: true, library: libraryCache, songId: importedSongs[0]?.id || null, count: audioFiles.length };
  } catch (error) {
    const detail = error.message || "";
    if (/No module named ['"]demucs|Cannot find module.*demucs/i.test(detail)) {
      return { ok: false, message: "Demucs is not installed yet. Run: python3 -m pip install -U demucs" };
    }
    if (/spawn python3 ENOENT/i.test(detail)) {
      return { ok: false, message: "Python 3 is required to run Demucs." };
    }
    return { ok: false, message: detail || "Could not separate this folder." };
  } finally {
    stemImportRunning = false;
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

ipcMain.handle("state:get", () => savedState);
ipcMain.handle("state:save", async (_event, partialState) => {
  if (!partialState || typeof partialState !== "object") return savedState;
  return saveState(partialState);
});

ipcMain.handle("song:get", async (_event, songId) => {
  const library = await getLibrary();
  const song = library.songs.find((item) => item.id === songId);
  if (!song) return null;

  const songDir = path.join(audioRoot, song.relativePath);
  const stems = await readStems(path.join(songDir, "Stems"));
  const hasNotes = await exists(path.join(songDir, NOTES_FILE_NAME));
  return { ...song, stems, hasNotes };
});

ipcMain.handle("chords:toggle", async (_event, title) => {
  if (chordsVisible) {
    hideChordsView();
    return false;
  }
  return showChordsView(title);
});

ipcMain.handle("chords:update", async (_event, title) => {
  if (!chordsVisible) return false;
  return showChordsView(title);
});

async function songDirectory(songId) {
  const library = await getLibrary();
  const song = library.songs.find((item) => item.id === songId);
  return song ? path.join(audioRoot, song.relativePath) : null;
}

ipcMain.handle("song:notes:get", async (_event, songId) => {
  const directory = await songDirectory(songId);
  if (!directory) return null;

  try {
    return await fs.readFile(path.join(directory, NOTES_FILE_NAME), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
});

ipcMain.handle("song:notes:save", async (_event, songId, notes) => {
  const directory = await songDirectory(songId);
  if (!directory || typeof notes !== "string") return false;

  const notesPath = path.join(directory, NOTES_FILE_NAME);
  if (!notes.trim()) {
    await fs.rm(notesPath, { force: true });
  } else {
    await fs.writeFile(notesPath, notes, "utf8");
  }
  return true;
});
