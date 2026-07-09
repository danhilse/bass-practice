# Bass Practice Player

Small Electron app for practicing bass against demucs-style stem folders.

It reads this library by default:

`/Users/danielhilse/Documents/audio/demuc`

Expected shape:

```text
Album/
  Song name/
    Stems/
      bass - Song name.mp3
      drums - Song name.mp3
      vocals - Song name.mp3
      other - Song name.mp3
```

## Run

```bash
npm install
npm start
```

The app defaults to muting `bass`, plays the remaining stems together, and keeps the muted stem visible in the waveform so you can see what you are replacing.

It also includes an audio output selector for routing playback to any output device Electron can see, plus a master safety limiter with a final hard ceiling just below 0 dB.

Turn on `Auto advance` to move to the next song in the selected album/folder when a track finishes. Playback continues automatically until the end of that folder.
