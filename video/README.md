# Roque Nights — submission video (Remotion)

Standalone package. Not part of the app's Vite build; nothing here is imported by `src/`.

```bash
npm install
npm run ambient        # public/ambient.wav + public/ambient.m4a, synthesised (needs ffmpeg)
npm run placeholders   # ONLY creates clips/log.json that are missing — never overwrites a real one
npm run studio         # preview and scrub
npm run render         # out/roque-nights.mp4   1920x1080 · 30 fps · 159.5 s · h264 + aac
npm run thumbnail      # out/thumbnail.png      1280x720
```

`prestudio` / `prerender` / `prethumbnail` run `scripts/manifest.mjs` first, which records
which optional assets exist and extracts `public/dome-still.jpg` from clip 06.

## Clip contract

`public/clips/` holds H.264 MP4, 1920x1080, 30 fps, yuv420p, no audio:
`01-onboarding.mp4`, `02-agent-points.mp4`, `03-favorites.mp4`, `04-ghost-plan.mp4`,
`05-another-sky.mp4`, `06-dome.mp4` — plus `log.json`:

```jsonc
{
  "recordedAt": "…", "url": "…",
  "clips": [{ "id": "01-onboarding", "file": "01-onboarding.mp4", "durationMs": 25733,
              "events": [{ "atMs": 5385, "kind": "human", "label": "Next" }] }],
  "facts": { "toolsRegistered": 15, "bestNight": "2026-09-13", … }
}
```

`log.json` is imported at build time (`src/log.ts`) and drives three things:

- **`durationMs`** — how long a clip can play before the edit runs out of footage.
- **`events`** of kind `tool` / `human` — the on-screen chips. `atMs` is measured from the
  clip's first frame at the moment the call resolved, so it is mapped back through the
  trim, the head hold and the playback rate to land on the right composition frame.
  `note` events are recording annotations and are not drawn.
- **first `tool`/`human` event** — where the clip is trimmed (that time minus
  `PRE_ROLL_SEC`, 400 ms), so the dead air before the first action is cut. A clip may also
  carry an explicit `firstActionAtMs`, which wins, and `PRE_ROLL_OVERRIDE` can give one
  clip a different pre-roll (01-onboarding uses 0: the page only flips from the wall-clock
  daylight dome to the night sky 0.12 s before its first action).

The trim is the only rule. It is never pulled back into the dead air to buy footage for a
long scene — the scene holds the clip's last frame instead.

Drop new clips in and re-run `npm run render`; nothing else needs to change.

## The edit

`src/timeline.ts` is the single source of truth. `SCENE_DEFS` lists the scenes with the
lengths from `docs/video/script.md`, stretched where the real recording needs longer (the
five `point_sky_map` calls take 22 s, not the script's 18); `SCENES` is the resolved edit. **Change a scene's
`durationSec` and every later scene, the subtitles, the chips and the composition length
shift with it.**

Clips are never sped up to fill a longer scene. Two holds do the work instead:

- **head hold** (`freezeFirstSec`) — the title cuts to the app's first frame and sits on
  it for one second before the clip plays.
- **tail hold** (`freezeTailFromFrame`) — when a scene outlasts its clip the last frame
  freezes. The Ken Burns drift sits outside the freeze, so a held frame still breathes.

A part marked `sky: true` is the bare dome rather than the app: it gets the full vignette
and the Ken Burns drift, and may carry a `zoomBase` / `zoomOrigin` (the cold open pushes in
to 1.18 biased left, so the dome fills the part of the frame the plate leaves visible) and
a `zoomEnd` (the title pulls back to 1:1 as the plate retracts). App parts are shown 1:1
with a third of the vignette — a push-in would crop the app's own header wordmark and the
right edge of the tools panel, and the full vignette swallows the panel where the tool rows
light up.

`continues: true` makes a part resume the clip where its previous part left off (the dome
runs unbroken from the cold open through the title; clip 01 runs unbroken from the title
tail through the onboarding scene).

## Subtitles

`src/subtitles.ts` — the bold fragments of the script, timed relative to their scene
against the real event times in `log.json`. A fragment with no timing is spread evenly
across the scene. snake_case tool names inside a subtitle are drawn amber.

Every number a subtitle says is derived from `log.json`'s `facts` (best night, Moon
percentage, usable hours, tool count) and spelled out, so a re-recording that changes a
number changes the subtitle. The pill is capped at 1120 px wide and sits 150 px off the
bottom, which keeps it clear of the app's time bar and its right-hand panel column.

Optional `public/voice.json` — `[{ "text", "startSec", "endSec" }]` in absolute timeline
seconds — replaces the whole track when present (picked up by `scripts/manifest.mjs`).

## Audio

`scripts/make-ambient.mjs` synthesises the bed from scratch — detuned sines around 55 /
82.4 / 110 Hz with 0.05–0.13 Hz amplitude LFOs, a low-passed noise bed at −40 dBFS, 6 s
in / 8 s out, peak −24 dBFS — then compresses it to AAC 128k. No samples, no library,
royalty-free by construction.

Optional `public/voice.mp3` is added automatically when present; offset it with
`VOICE_OFFSET_SEC` in `src/timeline.ts`.

## Look

`src/theme.ts` — the app's control-room palette (`#05060a` ground, `#101319` panels,
`#1c2230` edges, amber `#ffb454`, red `#ff5c4d`, faint `#8a93a6`), IBM Plex Mono
everywhere, sharp corners, 1 px borders, uppercase tracked-out labels, one vignette.

`ToolChips` is one track over the whole composition, not one per scene, so a chip can
outlive a cut (clip 01 runs from the title into the onboarding scene and the `Copy prompt`
chip lands 1.3 s before that boundary). Scenes with `chips: false` — the cold open — get
none.

`ChromeMask` slides `#05060a` plates over the app's panel column, header and time bar. It
is closed under the cold open (so the piece opens on the bare dome), retracts under the
title as the wordmark settles (so the hard cut to clip 01 is a cut in content, not in
framing), and closes again over the last shot.

## ffmpeg note

The ffmpeg on this machine is built without freetype, so `drawtext` is unavailable and
`drawbox` expressions are not evaluated per frame. `scripts/lib/png-text.mjs` therefore
renders the placeholder cards with a tiny built-in 5x7 bitmap font. Nothing in the final
render depends on it.
