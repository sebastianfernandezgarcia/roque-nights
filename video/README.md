# Roque Nights — submission video (Remotion)

Standalone package. Not part of the app's Vite build; nothing here is imported by `src/`.

```bash
npm install
npm run ambient        # public/ambient.wav + public/ambient.m4a, synthesised (needs ffmpeg)
npm run placeholders   # ONLY creates clips/log.json that are missing — never overwrites a real one
npm run alignment      # prints the solved edit: segments, rates, holds, anchors, chips, subtitles
npm run studio         # preview and scrub
npm run render         # out/roque-nights.mp4   1920x1080 · 30 fps · 168.0 s · h264 + aac
npm run thumbnail      # out/thumbnail.png      1280x720
```

`prestudio` / `prerender` / `prethumbnail` run `scripts/manifest.mjs` first, which records
which optional assets exist and extracts `public/dome-still.jpg` from clip 06.

## What drives the edit

Three files, all of them measurements rather than opinions:

| file | what it fixes |
| --- | --- |
| `public/scene-plan.json` | scene order, scene lengths, and the per-sentence **anchors** (scene-relative seconds) the narration lands on |
| `public/voice.json` | the 22 narration sentences in absolute composition seconds — the subtitle track, verbatim |
| `public/clips/log.json` | the real recording: clip durations and the millisecond every tool call resolved / every human click happened |

`public/voice.mp3` is already mixed onto this exact timeline — sentence *N* starts at
`voice.json[N].startSec` of the composition — so the voice track needs no offset, and the
composition is exactly as long as the narration (167.99 s → 5040 frames).

**Nothing in `src/` is hand-timed.** Change a scene length in `scene-plan.json`, or
re-record a clip and update `log.json`, and the edit re-solves itself.

## Clip contract

`public/clips/` holds H.264 MP4, 1920x1080, 30 fps, yuv420p, no audio:
`01-onboarding.mp4`, `02-agent-points.mp4`, `03-favorites.mp4`, `04-ghost-plan.mp4`,
`05-another-sky.mp4`, `06-dome.mp4` — plus `log.json`:

```jsonc
{
  "recordedAt": "…", "url": "…",
  "clips": [{ "id": "01-onboarding", "file": "01-onboarding.mp4", "durationMs": 25567,
              "firstActionAtMs": 2168,
              "events": [{ "atMs": 6867, "kind": "human", "label": "Copy prompt" }] }],
  "facts": { "toolsRegistered": 15, "bestNight": "2026-09-13", … }
}
```

`log.json` is imported at build time (`src/log.ts`) and drives three things:

- **`durationMs`** — how long a clip can play before the edit runs out of footage.
- **`events`** of kind `tool` / `human` — the on-screen chips *and* the beats the solver
  aligns to. `atMs` is measured from the clip's first frame at the moment the call
  resolved. `note` events are recording annotations and are not drawn.
- **first `tool`/`human` event** — the default trim (that time minus `PRE_ROLL_SEC`,
  400 ms). A clip may carry an explicit `firstActionAtMs`, which wins, and
  `PRE_ROLL_OVERRIDE` can give one clip a different pre-roll (01-onboarding uses 0: the
  page only flips from the wall-clock daylight dome to the night sky 0.12 s before its
  first action).

## The alignment

`src/timeline.ts` is the single source of truth. Scene lengths come straight from
`scene-plan.json`; inside each screen scene an **alignment** is solved into a list of
segments:

```ts
{ fromSec, toSec, clipStartSec, rate, holdAfter, holdFromClipSec }
```

A segment either plays the clip at `rate` clip-seconds per composition-second, or freezes
one frame. The solver has one primitive, `Track.landOn(clipSec, atSec, rate)`, which makes
a clip second arrive on a narration anchor by

- **freezing** the frame on screen for the slack, when the clip is too short for the
  window (`RATE_MIN` 0.85 is the floor — below that a cursor smears), or
- **raising the rate**, when it is too long, never past `RATE_MAX` 1.45.

Every hold point is expressed as an offset from a logged event and lands on a stretch the
frame-difference profile of the recording shows as motionless — the tour card the
narration is still explaining, the target list after `find_observable_targets`, the Mauna
Kea banner under *"this plan was built for a different sky"*. The app is genuinely still
there, so a hold reads as the page sitting there, not as a stall.

When RATE_MAX is not enough the solver says so. `npm run alignment` prints every segment,
every rate, every hold and a target-vs-actual table for the twelve anchored beats; today
eleven of them land within 0.02 s and the ghost plan's `Commit accepted` lands 0.46 s late
because hitting it exactly would need 1.52x.

The bare-dome shots (`sky: true` in `SHOTS`) get the full vignette and a Ken Burns drift,
and the cold open pushes in to 1.18 biased left so the dome fills the part of the frame the
chrome plate leaves visible. App shots are 1:1 with a third of the vignette — a push-in
would crop the app's own header wordmark and the right edge of the tools panel, and the
full vignette swallows the panel where the tool rows light up. The drift sits outside the
freeze, so a held dome still breathes.

## Subtitles

`src/subtitles.ts` — the **full sentences** of `public/voice.json`, on screen from
`startSec − 0.10` to `endSec + 0.35`, never overlapping the next cue. A sentence longer
than two lines of 47 characters is broken at a comma or a clause boundary into consecutive
pills that share the sentence's window in proportion to their length, so no pill is ever
taller than two lines. Tool names (`describe_current_view`) and `WebMCP` are drawn amber.

The pill is IBM Plex Mono 36 px, white on `#05060a` at 85 %, 1 px `#1c2230` border, capped
at 1400 px wide and sitting 150 px off the bottom, which keeps it clear of the app's own
time bar.

## Chips

`src/timeline.ts` maps every real `tool` / `human` event through its scene's alignment —
the trim, the held beats, the playback rate — to the composition frame the call actually
resolves on (`MAPPED_EVENTS`). `ToolChips` draws them as one track over the whole
composition, not one per scene, so a chip can outlive a cut. `CHIP_BLOCKLIST` drops a call
the narration never names (`set_observing_time` in the Mauna Kea scene); scenes with
`chips: false` — the cold open — get none.

## Audio

`scripts/make-ambient.mjs` synthesises the bed from scratch — detuned sines around 55 /
82.4 / 110 Hz with 0.05–0.13 Hz amplitude LFOs, a low-passed noise bed at −40 dBFS, 6 s
in / 8 s out, peak −24 dBFS — then compresses it to AAC 128k. No samples, no library,
royalty-free by construction. It is 176 s long so its own fade-out never lands inside the
168 s composition.

The mix: `voice.mp3` at 1.15 from frame 0, ambient at 0.35 swelling to 0.6 over the last
four seconds and tapering off the end. −18.2 LUFS integrated, −3.3 dBFS true peak.

## Look

`src/theme.ts` — the app's control-room palette (`#05060a` ground, `#101319` panels,
`#1c2230` edges, amber `#ffb454`, red `#ff5c4d`, faint `#8a93a6`), IBM Plex Mono
everywhere, sharp corners, 1 px borders, uppercase tracked-out labels, one vignette.

`ChromeMask` slides `#05060a` plates over the app's panel column, header and time bar. It
is closed under the cold open (so the piece opens on the bare dome), retracts under the
title as the wordmark settles (so the hard cut to clip 01 on sentence 05 is a cut in
content, not in framing), and closes again over the last shot — which passes a taller top
plate, because that shot is 1:1 and the app's FOV / local-time chip sits under the header.

## ffmpeg note

The ffmpeg on this machine is built without freetype, so `drawtext` is unavailable and
`drawbox` expressions are not evaluated per frame. `scripts/lib/png-text.mjs` therefore
renders the placeholder cards with a tiny built-in 5x7 bitmap font. Nothing in the final
render depends on it.
