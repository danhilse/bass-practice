# Design QA

- Source visual truth: `/Users/danielhilse/.codex/generated_images/019f4c55-f4b4-7c02-b80d-d93dc9b3b98e/exec-e4f2d8ad-4622-4e71-9fcf-8dbf88f62dcd.png`
- Implementation screenshots: `qa/practice-state.jpeg` and `qa/library-open-state.jpeg`
- Combined comparison evidence: `qa/comparison.png`
- Source viewport: 1487 × 1058; implementation viewport: 1162 × 768 (normalized to the same width for comparison)
- State: library drawer open, first album and current song selected, bass muted, playback stopped

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation preserves the condensed, heavy hierarchy and readable small UI labels. The system font fallback is slightly less condensed than the generated mock, but the hierarchy and wrapping behavior remain intact at the app's default viewport.
- Spacing and layout rhythm: the track header, contextual practice controls, waveform stage, bottom transport, and overlay drawer follow the source proportions. The drawer overlays the practice surface and does not permanently reduce the waveform area.
- Colors and visual tokens: charcoal surfaces, warm yellow primary control, four stem colors, ready green, muted borders, and selected states match the source direction.
- Image and asset fidelity: the Stem Deck mark is a raster crop from the selected visual source. UI controls use the installed Phosphor icon set; no placeholder icons or hand-drawn vector substitutes remain.
- Copy and content: app labels match the approved direction. The implementation intentionally shows songs from the user's real library rather than the invented song names in the mock.
- Interaction model: Library opens and closes as a dismissible drawer; song selection, album selection, folder refresh, folder switching, stem muting, auto advance, audio output, transport seeking, restart, play/pause, and volume remain functional.

## Full-view comparison evidence

`qa/comparison.png` places the approved library-open mock and the live Electron implementation side by side. Major-region proportions, information hierarchy, drawer placement, waveform dominance, selected-row treatment, and transport grouping align.

## Focused region comparison evidence

No additional crop was needed: the combined comparison keeps the drawer labels, practice controls, waveform lanes, and transport controls readable at native display scale.

## Comparison history

- Initial implementation capture: no P0/P1/P2 mismatch was found. The source uses a split play/pause visual while the live app uses one stateful play/pause button; this is intentional behavior, preserves a single primary action, and reduces control ambiguity.
- Interaction verification: opened and dismissed the Library drawer, opened and dismissed Output settings, changed the muted stem, and toggled Auto advance. All selected and open/closed states updated correctly.
- Console check: developer tools reported four warnings and no errors. The warnings did not block layout, audio loading, or interactions.

## Linear-inspired title-bar follow-up

- Removed the standalone logo and brand block.
- Integrated album, song title, Library, Output, and Ready status into the native title-bar row with a macOS-controls-safe left inset.
- Reduced header, practice-bar, and transport height to return more of the window to the waveform.
- A live capture confirmed the compact closed state. A subsequent open-state capture exposed the header beneath the drawer compositing layer, so the header was explicitly raised above that layer with an opaque workspace background.
- The final relaunch needed to capture that last one-line layering correction was declined, so post-fix visual evidence is unavailable.

## Follow-up polish

- P3: On a very short window, the drawer song list scrolls sooner than in the source mock; this preserves access to the fixed folder actions and avoids clipped controls.

## Implementation checklist

- [x] Separate library/file concerns from the practice workspace.
- [x] Keep the waveform as the dominant content.
- [x] Consolidate transport and volume controls.
- [x] Preserve all existing playback behavior.
- [x] Verify the closed and open library states in the running Electron app.

final result: blocked
