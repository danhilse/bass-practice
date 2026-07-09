const { app, BrowserWindow, ipcMain, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const AUDIO_ROOT =
  process.env.BASS_PRACTICE_LIBRARY || "/Users/danielhilse/Documents/audio/demuc";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"]);
let libraryCache = null;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
  const firstPart = baseName.split(" - ")[0].trim().toLowerCase();
  return firstPart || baseName.toLowerCase();
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
  if (!(await exists(AUDIO_ROOT))) {
    return { root: AUDIO_ROOT, albums: [], songs: [] };
  }

  const stemDirs = await findStemDirs(AUDIO_ROOT);
  const songs = [];

  for (const stemsDir of stemDirs) {
    const stems = await readStems(stemsDir);
    if (!stems.length) continue;

    const songDir = path.dirname(stemsDir);
    const relativeSongDir = path.relative(AUDIO_ROOT, songDir);
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

  return { root: AUDIO_ROOT, albums, songs };
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
}

app.whenReady().then(createWindow);

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

ipcMain.handle("song:get", async (_event, songId) => {
  const library = await getLibrary();
  const song = library.songs.find((item) => item.id === songId);
  if (!song) return null;

  const stems = await readStems(path.join(AUDIO_ROOT, song.relativePath, "Stems"));
  return { ...song, stems };
});
