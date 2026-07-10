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

It also includes persistent audio routing. Playback can be sent to any output device Electron can see and routed to channel 1, channel 2, or channels 1 + 2 in stereo, with an automatic fallback to the system's basic stereo output when a saved device is disconnected. The single-channel options fold the stereo mix down to mono. An optional interface/microphone input channel can be monitored through the same output as the tracks; input monitoring defaults to off. The mixed signal passes through a master safety limiter with a final hard ceiling just below 0 dB.

Turn on `Auto advance` to move to the next song in the selected album/folder when a track finishes. Playback continues automatically until the end of that folder.
# Stem Deck

## Separating a folder into stems

Open **Library** and select **Separate folder**. The folder name becomes the album name; every MP3, WAV, AIFF/AIF, M4A, FLAC, OGG, or AAC file directly inside it becomes a track. Stem Deck writes the result to:

```
<library>/<album>/<track>/Stems/{bass,drums,other,vocals}.wav
```

The app runs the standard `htdemucs` model. Install Demucs once before the first import:

```sh
python3 -m pip install -U demucs
```

Model weights are cached in Stem Deck's app-data folder. Demucs downloads them only if they are not already there, then reuses them for all later imports.
