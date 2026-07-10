const state = {
  library: null,
  currentSong: null,
  mutedStem: "bass",
  autoAdvance: false,
  nextMode: "sequential",
  audioContext: null,
  outputDestination: null,
  outputElement: null,
  masterInput: null,
  limiter: null,
  ceiling: null,
  outputSplitter: null,
  outputMerger: null,
  outputRouteGains: [],
  masterVolume: 0.95,
  outputDevices: [],
  inputDevices: [],
  preferredOutputId: localStorage.getItem("audio.outputDeviceId") || "default",
  selectedOutputId: "default",
  selectedOutputChannel: localStorage.getItem("audio.outputChannel") || "stereo",
  preferredInputId: localStorage.getItem("audio.inputDeviceId") || "off",
  selectedInputChannel: Number(localStorage.getItem("audio.inputChannel") || 0),
  inputStream: null,
  inputSource: null,
  inputSplitter: null,
  inputGain: null,
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
  loadingToken: 0,
  notesSaveTimer: null,
  restorePosition: 0,
  stateSaveTimer: null,
  persistenceReady: false,
  chordsPaneOpen: false
};

const colors = {
  bass: "#ff6b7a",
  drums: "#ffb000",
  vocals: "#20d6e4",
  other: "#b66cff"
};

const els = {
  libraryRoot: document.querySelector("#libraryRoot"),
  libraryButton: document.querySelector("#libraryButton"),
  libraryDrawer: document.querySelector("#libraryDrawer"),
  drawerScrim: document.querySelector("#drawerScrim"),
  closeLibraryButton: document.querySelector("#closeLibraryButton"),
  changeFolderButton: document.querySelector("#changeFolderButton"),
  importFolderButton: document.querySelector("#importFolderButton"),
  importStatus: document.querySelector("#importStatus"),
  albumSelect: document.querySelector("#albumSelect"),
  songSelect: document.querySelector("#songSelect"),
  songList: document.querySelector("#songList"),
  autoAdvanceToggle: document.querySelector("#autoAdvanceToggle"),
  nextModeSelect: document.querySelector("#nextModeSelect"),
  muteSelect: document.querySelector("#muteSelect"),
  muteButtons: document.querySelector("#muteButtons"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  outputSelect: document.querySelector("#outputSelect"),
  outputChannelSelect: document.querySelector("#outputChannelSelect"),
  inputSelect: document.querySelector("#inputSelect"),
  inputChannelSelect: document.querySelector("#inputChannelSelect"),
  inputHelp: document.querySelector("#inputHelp"),
  refreshOutputsButton: document.querySelector("#refreshOutputsButton"),
  refreshButton: document.querySelector("#refreshButton"),
  albumName: document.querySelector("#albumName"),
  songTitle: document.querySelector("#songTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  restartButton: document.querySelector("#restartButton"),
  nextButton: document.querySelector("#nextButton"),
  playButton: document.querySelector("#playButton"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  volumeSlider: document.querySelector("#volumeSlider"),
  volumeValue: document.querySelector("#volumeValue"),
  seekSlider: document.querySelector("#seekSlider"),
  waveformWrap: document.querySelector(".waveform-wrap"),
  canvas: document.querySelector("#waveformCanvas"),
  notesButton: document.querySelector("#notesButton"),
  chordsButton: document.querySelector("#chordsButton"),
  notesIndicator: document.querySelector("#notesIndicator"),
  notesDialog: document.querySelector("#notesDialog"),
  notesTitle: document.querySelector("#notesTitle"),
  notesEditor: document.querySelector("#notesEditor"),
  notesSaveStatus: document.querySelector("#notesSaveStatus"),
  closeNotesButton: document.querySelector("#closeNotesButton")
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
  for (const [index, option] of options.entries()) {
    const el = document.createElement("option");
    el.value = getValue(option, index);
    el.textContent = getLabel(option, index);
    select.appendChild(el);
  }
}

function setLibraryOpen(open) {
  els.libraryDrawer.classList.toggle("open", open);
  els.libraryDrawer.setAttribute("aria-hidden", String(!open));
  els.libraryButton.setAttribute("aria-expanded", String(open));
  els.drawerScrim.hidden = !open;
  if (open) els.closeLibraryButton.focus();
}

function renderSongList(songs) {
  els.songList.innerHTML = "";
  for (const song of songs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song-row";
    button.dataset.songId = song.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(song.id === state.currentSong?.id));
    if (song.id === state.currentSong?.id) button.classList.add("selected");
    button.innerHTML = '<i class="ph ph-music-note" aria-hidden="true"></i><span></span>';
    button.querySelector("span").textContent = song.title;
    button.addEventListener("click", async () => {
      els.songSelect.value = song.id;
      await loadSong(song.id);
      setLibraryOpen(false);
    });
    els.songList.appendChild(button);
  }
}

function renderMuteButtons(stemNames) {
  els.muteButtons.innerHTML = "";
  els.muteButtons.style.setProperty("--stem-count", Math.max(1, stemNames.length));
  for (const stem of stemNames) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stem-button";
    button.dataset.stemIndex = stemNames.indexOf(stem);
    button.style.setProperty("--stem-color", colors[stem] || "#c3cad7");
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(stem === state.mutedStem));
    button.setAttribute("aria-label", `Mute ${stem}`);
    const icon = stem === state.mutedStem ? "ph-speaker-slash" : "ph-speaker-simple-low";
    button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span></span>`;
    button.querySelector("span").textContent = stem;
    button.addEventListener("click", () => {
      state.mutedStem = stem;
      els.muteSelect.value = stem;
      renderMuteButtons(stemNames);
      setTrackVolumes();
      setStatus(`${stem} muted`);
      drawWaveform();
      savePersistentState();
    });
    els.muteButtons.appendChild(button);
  }
}

function setHoveredMuteLane(clientY) {
  const stemCount = state.currentSong?.stems.length || 0;
  if (!stemCount) return;

  const bounds = els.waveformWrap.getBoundingClientRect();
  const laneIndex = Math.min(stemCount - 1, Math.max(0, Math.floor(((clientY - bounds.top) / bounds.height) * stemCount)));
  els.muteButtons.querySelectorAll(".stem-button").forEach((button) => {
    button.classList.toggle("is-lane-hover", Number(button.dataset.stemIndex) === laneIndex);
  });
}

function clearHoveredMuteLane() {
  els.muteButtons.querySelectorAll(".stem-button").forEach((button) => button.classList.remove("is-lane-hover"));
}

function songsForAlbum(album) {
  return state.library.songs.filter((song) => song.album === album);
}

function setStatus(text) {
  els.syncStatus.textContent = text;
}

function persistedState() {
  return {
    currentSongId: state.currentSong?.id || null,
    mutedStem: state.mutedStem,
    autoAdvance: state.autoAdvance,
    nextMode: state.nextMode,
    masterVolume: Math.round(state.masterVolume * 100),
    outputDeviceId: state.preferredOutputId,
    outputChannel: state.selectedOutputChannel,
    inputDeviceId: state.preferredInputId,
    inputChannel: state.selectedInputChannel,
    playbackPosition: state.restorePosition || currentTime()
  };
}

function savePersistentState() {
  if (!state.persistenceReady) return;
  clearTimeout(state.stateSaveTimer);
  state.stateSaveTimer = setTimeout(() => {
    window.bassPractice.saveState(persistedState()).catch(() => {});
  }, 150);
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
    const progress = Math.round((time / state.duration) * Number(els.seekSlider.max));
    els.seekSlider.value = progress;
  }
}

async function ensureAudioContext() {
  if (!state.audioContext) state.audioContext = new AudioContext();
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
  ensureAudioOutput();
  ensureLimiterChain();
  await setAudioOutput(state.selectedOutputId, false);
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

  state.outputSplitter = state.audioContext.createChannelSplitter(2);
  state.outputMerger = state.audioContext.createChannelMerger(2);
  state.ceiling.connect(state.outputSplitter);
  state.outputMerger.connect(state.outputDestination || state.audioContext.destination);
  configureOutputChannels(state.selectedOutputChannel, false);
}

function configureOutputChannels(route, remember = true) {
  state.selectedOutputChannel = ["1", "2", "stereo"].includes(route) ? route : "stereo";
  els.outputChannelSelect.value = state.selectedOutputChannel;
  if (remember) localStorage.setItem("audio.outputChannel", state.selectedOutputChannel);
  if (remember) savePersistentState();
  if (!state.outputSplitter || !state.outputMerger) return;

  state.outputSplitter.disconnect();
  state.outputRouteGains.forEach((gain) => gain.disconnect());
  state.outputRouteGains = [];

  if (state.selectedOutputChannel === "stereo") {
    state.outputSplitter.connect(state.outputMerger, 0, 0);
    state.outputSplitter.connect(state.outputMerger, 1, 1);
  } else {
    const targetChannel = state.selectedOutputChannel === "1" ? 0 : 1;
    for (let sourceChannel = 0; sourceChannel < 2; sourceChannel += 1) {
      const gain = state.audioContext.createGain();
      gain.gain.value = 0.5;
      state.outputSplitter.connect(gain, sourceChannel);
      gain.connect(state.outputMerger, 0, targetChannel);
      state.outputRouteGains.push(gain);
    }
  }

  setStatus(
    state.selectedOutputChannel === "stereo"
      ? "Output channels 1 + 2 (stereo)"
      : `Output channel ${state.selectedOutputChannel}`
  );
}

function setMasterVolume(value) {
  state.masterVolume = Math.max(0, Math.min(Number(value) / 100, 1.5));
  els.volumeValue.textContent = `${Math.round(state.masterVolume * 100)}%`;

  if (state.masterInput) {
    state.masterInput.gain.value = state.masterVolume;
  }
  savePersistentState();
}

function outputLabel(device, index) {
  if (device.deviceId === "default") return "System Default (stereo)";
  return device.label || `Audio Output ${index + 1}`;
}

function inputLabel(device, index) {
  if (device.deviceId === "off") return "Off";
  return device.label || `Audio Input ${index + 1}`;
}

function uniqueDevices(devices) {
  const seen = new Set();
  return devices.filter((device) => {
    if (seen.has(device.deviceId)) return false;
    seen.add(device.deviceId);
    return true;
  });
}

async function loadOutputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    fillSelect(els.outputSelect, [{ deviceId: "default", label: "System Default" }], outputLabel, (d) => d.deviceId);
    els.outputSelect.disabled = true;
    setStatus("Output routing unavailable");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = uniqueDevices(devices.filter((device) => device.kind === "audiooutput"));
  state.outputDevices = [
    { deviceId: "default", label: "System Default (stereo)" },
    ...outputs.filter((device) => device.deviceId !== "default")
  ];

  fillSelect(
    els.outputSelect,
    state.outputDevices,
    outputLabel,
    (device) => device.deviceId
  );

  state.selectedOutputId = state.outputDevices.some(
    (device) => device.deviceId === state.preferredOutputId
  ) ? state.preferredOutputId : "default";
  els.outputSelect.value = state.selectedOutputId;

  await setAudioOutput(state.selectedOutputId, false);

  state.inputDevices = [
    { deviceId: "off", label: "Off" },
    ...uniqueDevices(devices.filter((device) => device.kind === "audioinput"))
  ];
  fillSelect(els.inputSelect, state.inputDevices, inputLabel, (device) => device.deviceId);
  els.inputSelect.value = state.inputDevices.some(
    (device) => device.deviceId === state.preferredInputId
  ) ? state.preferredInputId : "off";

  if (state.preferredInputId !== "off" && els.inputSelect.value === "off") {
    stopInputMonitor();
    els.inputHelp.textContent = "Saved input is unavailable; monitoring is off.";
  } else if (state.preferredInputId !== "off" && !state.inputStream) {
    await startInputMonitor(state.preferredInputId, false);
  }
}

async function setAudioOutput(deviceId, announce = true, remember = false) {
  state.selectedOutputId = deviceId || "default";
  if (remember) {
    state.preferredOutputId = state.selectedOutputId;
    localStorage.setItem("audio.outputDeviceId", state.preferredOutputId);
    savePersistentState();
  }

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
    state.selectedOutputId = "default";
    els.outputSelect.value = "default";
    try {
      await state.outputElement.setSinkId("");
      await state.outputElement.play();
      setStatus("Saved output unavailable; using system stereo");
    } catch {
      setStatus("Output routing unavailable");
    }
  }
}

function stopInputMonitor() {
  state.inputSource?.disconnect();
  state.inputSplitter?.disconnect();
  state.inputGain?.disconnect();
  state.inputStream?.getTracks().forEach((track) => track.stop());
  state.inputStream = null;
  state.inputSource = null;
  state.inputSplitter = null;
  state.inputGain = null;
  els.inputChannelSelect.disabled = true;
  fillSelect(els.inputChannelSelect, ["Channel 1"]);
}

async function startInputMonitor(deviceId, remember = true) {
  stopInputMonitor();
  if (remember) {
    state.preferredInputId = deviceId;
    localStorage.setItem("audio.inputDeviceId", deviceId);
    savePersistentState();
  }
  if (deviceId === "off") {
    els.inputHelp.textContent = "Input monitoring is off.";
    setStatus("Input monitoring off");
    return;
  }

  try {
    await ensureAudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: { ideal: 32 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const source = state.audioContext.createMediaStreamSource(stream);
    const settings = stream.getAudioTracks()[0]?.getSettings() || {};
    const channelCount = Math.max(1, settings.channelCount || source.channelCount || 1);
    const splitter = state.audioContext.createChannelSplitter(channelCount);
    const gain = state.audioContext.createGain();
    gain.gain.value = 1;
    source.connect(splitter);

    state.selectedInputChannel = Math.min(state.selectedInputChannel, channelCount - 1);
    splitter.connect(gain, state.selectedInputChannel);
    gain.connect(outputNode());
    state.inputStream = stream;
    state.inputSource = source;
    state.inputSplitter = splitter;
    state.inputGain = gain;

    fillSelect(
      els.inputChannelSelect,
      Array.from({ length: channelCount }, (_, index) => `Channel ${index + 1}`),
      (label) => label,
      (_label, index) => String(index)
    );
    els.inputChannelSelect.value = String(state.selectedInputChannel);
    els.inputChannelSelect.disabled = channelCount === 1;
    els.inputHelp.textContent = "Live input is mixed with the tracks and sent to the selected output.";
    setStatus(`Monitoring input channel ${state.selectedInputChannel + 1}`);

    // Permission may reveal device names that were hidden during initial enumeration.
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.inputDevices = [
      { deviceId: "off", label: "Off" },
      ...uniqueDevices(devices.filter((device) => device.kind === "audioinput"))
    ];
    fillSelect(els.inputSelect, state.inputDevices, inputLabel, (device) => device.deviceId);
    els.inputSelect.value = deviceId;
  } catch {
    stopInputMonitor();
    els.inputSelect.value = "off";
    els.inputHelp.textContent = "Input could not be opened; monitoring is off.";
    setStatus("Input monitoring unavailable");
  }
}

function setInputChannel(channel) {
  if (!state.inputSplitter || !state.inputGain) return;
  state.inputSplitter.disconnect();
  state.selectedInputChannel = Number(channel);
  state.inputSplitter.connect(state.inputGain, state.selectedInputChannel);
  localStorage.setItem("audio.inputChannel", String(state.selectedInputChannel));
  savePersistentState();
  setStatus(`Monitoring input channel ${state.selectedInputChannel + 1}`);
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

  ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
  ctx.lineWidth = 1;
  const majorGrid = 6;
  for (let i = 1; i < majorGrid; i += 1) {
    const x = (width / majorGrid) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  const stemNames = state.currentSong?.stems.map((stem) => stem.name) || [];
  const laneHeight = height / Math.max(1, stemNames.length);

  stemNames.forEach((stem, laneIndex) => {
    const peaks = state.waveformPeaks.get(stem);
    const color = colors[stem] || "#c3cad7";
    const top = laneIndex * laneHeight;
    const mid = top + laneHeight / 2;
    const maxAmp = laneHeight * 0.36;
    const muted = stem === state.mutedStem;

    ctx.fillStyle = laneIndex % 2 === 0 ? "rgba(255, 255, 255, 0.015)" : "rgba(255, 255, 255, 0.025)";
    ctx.fillRect(0, top, width, laneHeight);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(width, top);
    ctx.stroke();

    ctx.globalAlpha = muted ? 0.26 : 0.88;
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
  });

  if (state.duration) {
    const x = (currentTime() / state.duration) * width;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#f6f7f0";
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
  savePersistentState();
  updateNextButton();
  els.albumName.textContent = song.album;
  els.songTitle.textContent = song.title;
  els.notesButton.disabled = false;
  els.chordsButton.disabled = false;
  els.notesButton.classList.toggle("has-notes", song.hasNotes);
  if (state.chordsPaneOpen) window.bassPractice.updateChords(song.title);

  const stemNames = song.stems.map((stem) => stem.name);
  fillSelect(els.muteSelect, stemNames);
  els.muteSelect.value = stemNames.includes(state.mutedStem) ? state.mutedStem : stemNames[0];
  state.mutedStem = els.muteSelect.value;
  renderMuteButtons(stemNames);
  renderSongList(songsForAlbum(song.album));

  drawWaveform();

  await Promise.all(song.stems.map((stem) => decodeStem(stem, token)));
  if (token !== state.loadingToken) return;

  setTrackVolumes();
  if (state.restorePosition) {
    seekAll(state.restorePosition);
    state.restorePosition = 0;
  }
  startAnimation();
  setStatus("Ready");
  return true;
}

async function openNotes() {
  if (!state.currentSong) return;
  const songId = state.currentSong.id;
  els.notesTitle.textContent = state.currentSong.title;
  els.notesEditor.value = "";
  els.notesSaveStatus.textContent = "Loading…";
  els.notesDialog.showModal();

  try {
    const notes = await window.bassPractice.getSongNotes(songId);
    if (state.currentSong?.id !== songId) return;
    els.notesEditor.value = notes || "";
    els.notesButton.classList.toggle("has-notes", Boolean(notes?.trim()));
    els.notesSaveStatus.textContent = "Saved as notes.md in this track’s folder";
    els.notesEditor.focus();
  } catch {
    els.notesSaveStatus.textContent = "Couldn’t read notes";
  }
}

async function saveNotes() {
  clearTimeout(state.notesSaveTimer);
  if (!state.currentSong) return;
  const songId = state.currentSong.id;
  const notes = els.notesEditor.value;
  els.notesSaveStatus.textContent = "Saving…";
  try {
    await window.bassPractice.saveSongNotes(songId, notes);
    if (state.currentSong?.id === songId) {
      els.notesButton.classList.toggle("has-notes", Boolean(notes.trim()));
      els.notesSaveStatus.textContent = notes.trim()
        ? "Saved as notes.md in this track’s folder"
        : "No notes file yet";
    }
  } catch {
    els.notesSaveStatus.textContent = "Couldn’t save notes";
  }
}

function nextSongInCurrentAlbum() {
  if (!state.currentSong) return null;
  const songs = songsForAlbum(state.currentSong.album);
  const index = songs.findIndex((song) => song.id === state.currentSong.id);
  if (index < 0 || index >= songs.length - 1) return null;
  return songs[index + 1];
}

function randomSong() {
  if (!state.currentSong || !state.library) return null;
  const candidates = (state.nextMode === "library"
    ? state.library.songs
    : songsForAlbum(state.currentSong.album)
  ).filter((song) => song.id !== state.currentSong.id);
  return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

function nextSong() {
  return state.nextMode === "sequential" ? nextSongInCurrentAlbum() : randomSong();
}

function updateNextButton() {
  els.nextButton.disabled = !nextSong();
}

async function advanceToNextSong(shouldPlay = false) {
  const song = nextSong();
  if (!song) {
    setStatus(state.nextMode === "sequential" ? "End of album" : "No other tracks available");
    return false;
  }

  if (els.albumSelect.value !== song.album) {
    els.albumSelect.value = song.album;
    fillSelect(els.songSelect, songsForAlbum(song.album), (item) => item.title, (item) => item.id);
  }
  els.songSelect.value = song.id;
  const loaded = await loadSong(song.id);
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
  savePersistentState();
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
  els.playButton.innerHTML = '<i class="ph-fill ph-pause" aria-hidden="true"></i><span class="visually-hidden">Pause</span>';
  els.playButton.setAttribute("aria-label", "Pause");
  setStatus(`${state.mutedStem} muted`);
}

function pauseAll(keepOffset = true) {
  if (keepOffset && state.isPlaying) state.offset = currentTime();
  stopSources();
  state.isPlaying = false;
  els.playButton.innerHTML = '<i class="ph-fill ph-play" aria-hidden="true"></i><span class="visually-hidden">Play</span>';
  els.playButton.setAttribute("aria-label", "Play");
  if (keepOffset) savePersistentState();
}

function updateSongsForAlbum(preferredSongId = null) {
  const album = els.albumSelect.value;
  const songs = songsForAlbum(album);
  fillSelect(
    els.songSelect,
    songs,
    (song) => song.title,
    (song) => song.id
  );
  renderSongList(songs);
  els.nextButton.disabled = !songs[1];
  if (songs[0]) {
    const songId = songs.some((song) => song.id === preferredSongId) ? preferredSongId : songs[0].id;
    loadSong(songId);
  }
}

async function loadLibrary(refresh = false, preferredSongId = null) {
  state.library = refresh
    ? await window.bassPractice.refreshLibrary()
    : await window.bassPractice.getLibrary();
  els.libraryRoot.textContent = state.library.root;

  fillSelect(els.albumSelect, state.library.albums);
  if (state.library.albums[0]) {
    const preferredSong = state.library.songs.find((song) => song.id === preferredSongId);
    if (preferredSong) {
      els.albumSelect.value = preferredSong.album;
      updateSongsForAlbum(preferredSong.id);
    } else {
      els.albumSelect.value = state.library.albums[0];
      updateSongsForAlbum();
    }
  } else {
    setStatus("No stems found");
  }
}

async function chooseLibrary() {
  const library = await window.bassPractice.chooseLibrary();
  if (!library) return;
  state.library = library;
  els.libraryRoot.textContent = library.root;
  fillSelect(els.albumSelect, library.albums);
  if (library.albums[0]) {
    els.albumSelect.value = library.albums[0];
    updateSongsForAlbum();
  } else {
    els.songList.innerHTML = '<p class="empty-state">No stem folders found here.</p>';
    setStatus("No stems found");
  }
}

function setImportStatus(message, visible = true) {
  els.importStatus.hidden = !visible;
  els.importStatus.textContent = message;
}

async function importStemFolder() {
  els.importFolderButton.disabled = true;
  setImportStatus("Choose a source folder. The current library will not be changed.");
  const removeProgressListener = window.bassPractice.onStemImportProgress((progress) => {
    const track = progress.title ? `: ${progress.title}` : "";
    if (progress.phase === "downloading") {
      setImportStatus(`Downloading the separation model once${track}`);
    } else if (progress.phase === "separating") {
      setImportStatus(`Separating ${progress.current} of ${progress.total}${track}`);
    } else if (progress.phase === "starting") {
      setImportStatus(`Creating album “${progress.album}”`);
    } else if (progress.phase === "complete") {
      setImportStatus(`Added ${progress.total} track${progress.total === 1 ? "" : "s"} to “${progress.album}”`);
    }
  });

  try {
    const result = await window.bassPractice.chooseAndImportStems();
    if (result.canceled) {
      setImportStatus("", false);
      return;
    }
    if (!result.ok) {
      setImportStatus(result.message || "Couldn’t separate that folder.");
      setStatus("Import failed");
      return;
    }
    state.library = result.library;
    els.libraryRoot.textContent = result.library.root;
    fillSelect(els.albumSelect, result.library.albums);
    const importedSong = result.library.songs.find((song) => song.id === result.songId);
    if (importedSong) {
      els.albumSelect.value = importedSong.album;
      updateSongsForAlbum(importedSong.id);
    }
    setStatus("Stems ready");
  } catch {
    setImportStatus("Couldn’t start Demucs. Install it with: python3 -m pip install -U demucs");
    setStatus("Import failed");
  } finally {
    removeProgressListener();
    els.importFolderButton.disabled = false;
  }
}

els.albumSelect.addEventListener("change", updateSongsForAlbum);
els.songSelect.addEventListener("change", () => loadSong(els.songSelect.value));
els.libraryButton.addEventListener("click", () => setLibraryOpen(!els.libraryDrawer.classList.contains("open")));
els.closeLibraryButton.addEventListener("click", () => setLibraryOpen(false));
els.drawerScrim.addEventListener("click", () => setLibraryOpen(false));
els.changeFolderButton.addEventListener("click", chooseLibrary);
els.importFolderButton.addEventListener("click", importStemFolder);
els.notesButton.addEventListener("click", openNotes);
els.chordsButton.addEventListener("click", async () => {
  if (!state.currentSong) return;
  state.chordsPaneOpen = await window.bassPractice.toggleChords(state.currentSong.title);
  els.chordsButton.setAttribute("aria-pressed", String(state.chordsPaneOpen));
  els.chordsButton.title = state.chordsPaneOpen
    ? "Hide chords"
    : "Show chords from Ultimate Guitar";
});
els.closeNotesButton.addEventListener("click", () => {
  saveNotes();
  els.notesDialog.close();
});
els.notesDialog.addEventListener("click", (event) => {
  if (event.target === els.notesDialog) {
    saveNotes();
    els.notesDialog.close();
  }
});
els.notesDialog.addEventListener("cancel", saveNotes);
els.notesEditor.addEventListener("input", () => {
  els.notesSaveStatus.textContent = "Unsaved changes";
  clearTimeout(state.notesSaveTimer);
  state.notesSaveTimer = setTimeout(saveNotes, 600);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.libraryDrawer.classList.contains("open")) setLibraryOpen(false);
});
els.autoAdvanceToggle.addEventListener("change", () => {
  state.autoAdvance = els.autoAdvanceToggle.checked;
  setStatus(state.autoAdvance ? "Auto advance on" : "Auto advance off");
  savePersistentState();
});
els.nextModeSelect.addEventListener("change", () => {
  state.nextMode = ["sequential", "album", "library"].includes(els.nextModeSelect.value)
    ? els.nextModeSelect.value
    : "sequential";
  updateNextButton();
  setStatus(
    state.nextMode === "sequential"
      ? "Next: in order"
      : `Next: shuffle ${state.nextMode === "album" ? "album" : "library"}`
  );
  savePersistentState();
});
els.muteSelect.addEventListener("change", () => {
  state.mutedStem = els.muteSelect.value;
  setTrackVolumes();
  setStatus(`${state.mutedStem} muted`);
  drawWaveform();
  savePersistentState();
});
els.settingsButton.addEventListener("click", () => {
  if (typeof els.settingsDialog.showModal === "function") {
    els.settingsDialog.showModal();
  } else {
    els.settingsDialog.setAttribute("open", "");
  }
});
els.settingsDialog.addEventListener("click", (event) => {
  if (event.target === els.settingsDialog) els.settingsDialog.close();
});
els.outputSelect.addEventListener("change", () => setAudioOutput(els.outputSelect.value, true, true));
els.outputChannelSelect.addEventListener("change", () => configureOutputChannels(els.outputChannelSelect.value));
els.inputSelect.addEventListener("change", () => startInputMonitor(els.inputSelect.value));
els.inputChannelSelect.addEventListener("change", () => setInputChannel(els.inputChannelSelect.value));
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
els.nextButton.addEventListener("click", async () => {
  const shouldPlay = state.isPlaying;
  await advanceToNextSong(shouldPlay);
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
els.waveformWrap.addEventListener("mousemove", (event) => setHoveredMuteLane(event.clientY));
els.waveformWrap.addEventListener("mouseleave", clearHoveredMuteLane);
window.addEventListener("resize", resizeCanvas);
navigator.mediaDevices?.addEventListener?.("devicechange", () => loadOutputDevices());
window.addEventListener("beforeunload", () => {
  window.bassPractice.saveState(persistedState()).catch(() => {});
  stopInputMonitor();
});

async function initialize() {
  const saved = await window.bassPractice.getState();
  state.mutedStem = saved.mutedStem || state.mutedStem;
  state.autoAdvance = Boolean(saved.autoAdvance);
  state.nextMode = ["sequential", "album", "library"].includes(saved.nextMode)
    ? saved.nextMode
    : saved.randomize
      ? (saved.randomScope === "library" ? "library" : "album")
      : "sequential";
  state.preferredOutputId = saved.outputDeviceId || state.preferredOutputId;
  state.selectedOutputChannel = saved.outputChannel || state.selectedOutputChannel;
  state.preferredInputId = saved.inputDeviceId || state.preferredInputId;
  state.selectedInputChannel = Number.isInteger(saved.inputChannel)
    ? saved.inputChannel
    : state.selectedInputChannel;
  state.restorePosition = Number.isFinite(saved.playbackPosition) ? saved.playbackPosition : 0;
  els.autoAdvanceToggle.checked = state.autoAdvance;
  els.nextModeSelect.value = state.nextMode;
  els.volumeSlider.value = String(saved.masterVolume ?? Math.round(state.masterVolume * 100));
  els.outputChannelSelect.value = state.selectedOutputChannel;
  setMasterVolume(els.volumeSlider.value);
  await loadOutputDevices();
  await loadLibrary(false, saved.currentSongId);
  state.persistenceReady = true;
  resizeCanvas();
}

initialize();
