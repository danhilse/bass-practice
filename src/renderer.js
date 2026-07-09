const state = {
  library: null,
  currentSong: null,
  mutedStem: "bass",
  autoAdvance: false,
  audioContext: null,
  outputDestination: null,
  outputElement: null,
  masterInput: null,
  limiter: null,
  ceiling: null,
  masterVolume: 0.95,
  outputDevices: [],
  selectedOutputId: "default",
  buffers: new Map(),
  gains: new Map(),
  sources: new Map(),
  waveformPeaks: new Map(),
  isPlaying: false,
  isSeeking: false,
  duration: 0,
  offset: 0,
  startedAt: 0,
  rafId: null,
  loadingToken: 0
};

const colors = {
  bass: "#ff7a90",
  drums: "#ffcf56",
  vocals: "#59c3c3",
  other: "#a48cf0"
};

const els = {
  libraryRoot: document.querySelector("#libraryRoot"),
  albumSelect: document.querySelector("#albumSelect"),
  songSelect: document.querySelector("#songSelect"),
  autoAdvanceToggle: document.querySelector("#autoAdvanceToggle"),
  muteSelect: document.querySelector("#muteSelect"),
  outputSelect: document.querySelector("#outputSelect"),
  refreshOutputsButton: document.querySelector("#refreshOutputsButton"),
  refreshButton: document.querySelector("#refreshButton"),
  albumName: document.querySelector("#albumName"),
  songTitle: document.querySelector("#songTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  restartButton: document.querySelector("#restartButton"),
  playButton: document.querySelector("#playButton"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  volumeSlider: document.querySelector("#volumeSlider"),
  volumeValue: document.querySelector("#volumeValue"),
  seekSlider: document.querySelector("#seekSlider"),
  canvas: document.querySelector("#waveformCanvas")
};

const ctx = els.canvas.getContext("2d");

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

function fillSelect(select, options, getLabel = (item) => item, getValue = (item) => item) {
  select.innerHTML = "";
  for (const option of options) {
    const el = document.createElement("option");
    el.value = getValue(option);
    el.textContent = getLabel(option);
    select.appendChild(el);
  }
}

function songsForAlbum(album) {
  return state.library.songs.filter((song) => song.album === album);
}

function setStatus(text) {
  els.syncStatus.textContent = text;
}

function currentTime() {
  if (!state.isPlaying) return state.offset;
  return Math.min(state.duration, state.audioContext.currentTime - state.startedAt);
}

function stopAnimation() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

function startAnimation() {
  stopAnimation();
  const tick = () => {
    if (state.isPlaying && currentTime() >= state.duration - 0.02) {
      handleTrackFinished();
      return;
    }
    updateTimeUi();
    drawWaveform();
    state.rafId = requestAnimationFrame(tick);
  };
  tick();
}

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  els.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  els.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawWaveform();
}

function updateTimeUi() {
  const time = currentTime();
  els.currentTime.textContent = formatTime(time);
  els.duration.textContent = formatTime(state.duration);
  if (!state.isSeeking && state.duration) {
    els.seekSlider.value = Math.round((time / state.duration) * Number(els.seekSlider.max));
  }
}

async function ensureAudioContext() {
  if (!state.audioContext) state.audioContext = new AudioContext();
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
  ensureAudioOutput();
  ensureLimiterChain();
}

function ensureAudioOutput() {
  if (!state.audioContext || state.outputDestination) return;

  state.outputDestination = state.audioContext.createMediaStreamDestination();
  state.outputElement = new Audio();
  state.outputElement.autoplay = true;
  state.outputElement.srcObject = state.outputDestination.stream;
  state.outputElement.play().catch(() => {
    setStatus("Press Play to start audio");
  });
}

function outputNode() {
  return state.masterInput || state.audioContext.destination;
}

function makeCeilingCurve() {
  const samples = 65536;
  const curve = new Float32Array(samples);
  const ceiling = 0.988553;

  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.max(-ceiling, Math.min(ceiling, x));
  }

  return curve;
}

function ensureLimiterChain() {
  if (!state.audioContext || state.masterInput) return;

  state.masterInput = state.audioContext.createGain();
  state.masterInput.gain.value = state.masterVolume;

  state.limiter = state.audioContext.createDynamicsCompressor();
  state.limiter.threshold.value = -1;
  state.limiter.knee.value = 0;
  state.limiter.ratio.value = 20;
  state.limiter.attack.value = 0.002;
  state.limiter.release.value = 0.08;

  state.ceiling = state.audioContext.createWaveShaper();
  state.ceiling.curve = makeCeilingCurve();
  state.ceiling.oversample = "4x";

  state.masterInput.connect(state.limiter);
  state.limiter.connect(state.ceiling);
  state.ceiling.connect(state.outputDestination || state.audioContext.destination);
}

function setMasterVolume(value) {
  state.masterVolume = Math.max(0, Math.min(Number(value) / 100, 1.5));
  els.volumeValue.textContent = `${Math.round(state.masterVolume * 100)}%`;

  if (state.masterInput) {
    state.masterInput.gain.value = state.masterVolume;
  }
}

function outputLabel(device, index) {
  if (device.deviceId === "default") return device.label || "System Default";
  return device.label || `Audio Output ${index + 1}`;
}

async function loadOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    fillSelect(els.outputSelect, [{ deviceId: "default", label: "System Default" }], outputLabel, (d) => d.deviceId);
    els.outputSelect.disabled = true;
    setStatus("Output routing unavailable");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  state.outputDevices = outputs.length
    ? outputs
    : [{ deviceId: "default", label: "System Default" }];

  fillSelect(
    els.outputSelect,
    state.outputDevices,
    outputLabel,
    (device) => device.deviceId
  );

  if (state.outputDevices.some((device) => device.deviceId === state.selectedOutputId)) {
    els.outputSelect.value = state.selectedOutputId;
  } else {
    state.selectedOutputId = state.outputDevices[0].deviceId;
    els.outputSelect.value = state.selectedOutputId;
  }

  await setAudioOutput(state.selectedOutputId, false);
}

async function setAudioOutput(deviceId, announce = true) {
  state.selectedOutputId = deviceId || "default";

  if (!state.audioContext) {
    if (announce) setStatus("Output selected");
    return;
  }

  ensureAudioOutput();

  if (typeof state.outputElement.setSinkId !== "function") {
    if (announce) setStatus("Using system output");
    return;
  }

  try {
    await state.outputElement.setSinkId(state.selectedOutputId === "default" ? "" : state.selectedOutputId);
    await state.outputElement.play();
    if (announce) {
      const device = state.outputDevices.find((item) => item.deviceId === state.selectedOutputId);
      setStatus(`Output: ${device ? outputLabel(device, 0) : "System Default"}`);
    }
  } catch {
    setStatus("Output switch failed");
  }
}

function setTrackVolumes() {
  for (const [stem, gain] of state.gains) {
    gain.gain.value = stem === state.mutedStem ? 0 : 1;
  }
}

function stopSources() {
  for (const source of state.sources.values()) {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
  state.sources.clear();
}

function clearTracks() {
  pauseAll(false);
  stopSources();
  state.buffers.clear();
  state.gains.clear();
  state.waveformPeaks.clear();
  state.duration = 0;
  state.offset = 0;
  state.startedAt = 0;
  updateTimeUi();
  drawWaveform();
}

function peaksFromBuffer(buffer) {
  const channel = buffer.getChannelData(0);
  const buckets = 900;
  const bucketSize = Math.max(1, Math.floor(channel.length / buckets));
  const peaks = [];

  for (let i = 0; i < buckets; i += 1) {
    let peak = 0;
    const start = i * bucketSize;
    const end = Math.min(channel.length, start + bucketSize);
    for (let j = start; j < end; j += 1) {
      peak = Math.max(peak, Math.abs(channel[j]));
    }
    peaks.push(peak);
  }

  return peaks;
}

async function decodeStem(stem, token) {
  const response = await fetch(stem.url);
  const arrayBuffer = await response.arrayBuffer();
  await ensureAudioContext();
  const buffer = await state.audioContext.decodeAudioData(arrayBuffer);
  if (token !== state.loadingToken) return;

  state.buffers.set(stem.name, buffer);
  state.waveformPeaks.set(stem.name, peaksFromBuffer(buffer));
  state.duration = Math.max(state.duration, buffer.duration);

  const gain = state.audioContext.createGain();
  gain.connect(outputNode());
  state.gains.set(stem.name, gain);
  setTrackVolumes();
  updateTimeUi();
  drawWaveform();
}

function drawWaveform() {
  const { width, height } = els.canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#121419";
  ctx.fillRect(0, 0, width, height);

  const stemNames = state.currentSong?.stems.map((stem) => stem.name) || [];
  const laneHeight = height / Math.max(1, stemNames.length);

  stemNames.forEach((stem, laneIndex) => {
    const peaks = state.waveformPeaks.get(stem);
    const color = colors[stem] || "#c3cad7";
    const top = laneIndex * laneHeight;
    const mid = top + laneHeight / 2;
    const maxAmp = laneHeight * 0.42;

    ctx.globalAlpha = stem === state.mutedStem ? 0.32 : 0.86;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();

    if (peaks?.length) {
      const step = width / peaks.length;
      peaks.forEach((peak, index) => {
        const x = index * step;
        const amp = Math.max(1, peak * maxAmp);
        ctx.moveTo(x, mid - amp);
        ctx.lineTo(x, mid + amp);
      });
    } else {
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
    }
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = stem === state.mutedStem ? "#ff7a90" : "#d7dce8";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(stem, 14, top + 22);
  });

  if (state.duration) {
    const x = (currentTime() / state.duration) * width;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

async function loadSong(songId) {
  const token = state.loadingToken + 1;
  state.loadingToken = token;
  clearTracks();
  setStatus("Loading");

  const song = await window.bassPractice.getSong(songId);
  if (!song || token !== state.loadingToken) return;

  state.currentSong = song;
  els.albumName.textContent = song.album;
  els.songTitle.textContent = song.title;

  const stemNames = song.stems.map((stem) => stem.name);
  fillSelect(els.muteSelect, stemNames);
  els.muteSelect.value = stemNames.includes(state.mutedStem) ? state.mutedStem : stemNames[0];
  state.mutedStem = els.muteSelect.value;

  drawWaveform();

  await Promise.all(song.stems.map((stem) => decodeStem(stem, token)));
  if (token !== state.loadingToken) return;

  setTrackVolumes();
  startAnimation();
  setStatus("Ready");
  return true;
}

function nextSongInCurrentAlbum() {
  if (!state.currentSong) return null;
  const songs = songsForAlbum(state.currentSong.album);
  const index = songs.findIndex((song) => song.id === state.currentSong.id);
  if (index < 0 || index >= songs.length - 1) return null;
  return songs[index + 1];
}

async function advanceToNextSong(shouldPlay = false) {
  const nextSong = nextSongInCurrentAlbum();
  if (!nextSong) {
    setStatus("End of folder");
    return false;
  }

  els.songSelect.value = nextSong.id;
  const loaded = await loadSong(nextSong.id);
  if (loaded && shouldPlay) await playAll();
  return Boolean(loaded);
}

function handleTrackFinished() {
  pauseAll(false);
  seekAll(0);

  if (state.autoAdvance) {
    setStatus("Loading next");
    advanceToNextSong(true);
    return;
  }

  setStatus("Finished");
}

function seekAll(seconds) {
  state.offset = Math.max(0, Math.min(seconds || 0, state.duration || 0));
  if (state.isPlaying) {
    stopSources();
    startSources();
  }
  updateTimeUi();
  drawWaveform();
}

function startSources() {
  stopSources();
  state.startedAt = state.audioContext.currentTime - state.offset;

  for (const [stem, buffer] of state.buffers) {
    const source = state.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.gains.get(stem));
    source.start(0, Math.min(state.offset, Math.max(0, buffer.duration - 0.01)));
    state.sources.set(stem, source);
  }
}

async function playAll() {
  if (!state.buffers.size || state.buffers.size !== state.currentSong.stems.length) return;
  await ensureAudioContext();
  startSources();
  state.isPlaying = true;
  els.playButton.textContent = "Pause";
  setStatus(`${state.mutedStem} muted`);
}

function pauseAll(keepOffset = true) {
  if (keepOffset && state.isPlaying) state.offset = currentTime();
  stopSources();
  state.isPlaying = false;
  els.playButton.textContent = "Play";
}

function updateSongsForAlbum() {
  const album = els.albumSelect.value;
  const songs = songsForAlbum(album);
  fillSelect(
    els.songSelect,
    songs,
    (song) => song.title,
    (song) => song.id
  );
  if (songs[0]) loadSong(songs[0].id);
}

async function loadLibrary(refresh = false) {
  state.library = refresh
    ? await window.bassPractice.refreshLibrary()
    : await window.bassPractice.getLibrary();
  els.libraryRoot.textContent = state.library.root;

  fillSelect(els.albumSelect, state.library.albums);
  if (state.library.albums[0]) {
    els.albumSelect.value = state.library.albums[0];
    updateSongsForAlbum();
  } else {
    setStatus("No stems found");
  }
}

els.albumSelect.addEventListener("change", updateSongsForAlbum);
els.songSelect.addEventListener("change", () => loadSong(els.songSelect.value));
els.autoAdvanceToggle.addEventListener("change", () => {
  state.autoAdvance = els.autoAdvanceToggle.checked;
  setStatus(state.autoAdvance ? "Auto advance on" : "Auto advance off");
});
els.muteSelect.addEventListener("change", () => {
  state.mutedStem = els.muteSelect.value;
  setTrackVolumes();
  setStatus(`${state.mutedStem} muted`);
  drawWaveform();
});
els.outputSelect.addEventListener("change", () => setAudioOutput(els.outputSelect.value));
els.refreshOutputsButton.addEventListener("click", () => loadOutputDevices());
els.refreshButton.addEventListener("click", () => loadLibrary(true));
els.playButton.addEventListener("click", async () => {
  if (!state.currentSong) return;
  if (state.isPlaying) pauseAll();
  else await playAll();
});
els.restartButton.addEventListener("click", async () => {
  seekAll(0);
  if (state.isPlaying) await playAll();
});
els.volumeSlider.addEventListener("input", () => setMasterVolume(els.volumeSlider.value));
els.seekSlider.addEventListener("input", () => {
  state.isSeeking = true;
  const seconds = (Number(els.seekSlider.value) / Number(els.seekSlider.max)) * state.duration;
  els.currentTime.textContent = formatTime(seconds);
});
els.seekSlider.addEventListener("change", () => {
  const seconds = (Number(els.seekSlider.value) / Number(els.seekSlider.max)) * state.duration;
  seekAll(seconds);
  state.isSeeking = false;
});
window.addEventListener("resize", resizeCanvas);

loadOutputDevices();
loadLibrary();
setMasterVolume(els.volumeSlider.value);
resizeCanvas();
