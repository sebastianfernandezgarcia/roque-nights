#!/usr/bin/env node
/**
 * Prebuild step (runs from the `prestudio` / `prerender` / `prethumbnail` npm hooks).
 *
 * Optional assets can't be `import`ed conditionally from a bundle, so this writes
 * src/manifest.json describing what is actually on disk:
 *   - public/voice.mp3   → voice-over track
 *   - public/voice.json  → the subtitle cues (imported directly by src/subtitles.ts;
 *                          only checked for validity here)
 *   - public/music.m4a   → generated music track (ducked under the voice)
 *   - public/ambient.m4a → procedural pad, used only when there is no music
 *   - public/dome-still.jpg → thumbnail background (extracted here from 06-dome.mp4)
 *
 * It never overwrites a real clip or a real log.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const CLIPS = join(PUBLIC, 'clips');
const MANIFEST = join(ROOT, 'src', 'manifest.json');

const CLIP_FILES = [
  '01-onboarding.mp4',
  '02-agent-points.mp4',
  '03-favorites.mp4',
  '04-ghost-plan.mp4',
  '05-another-sky.mp4',
  '06-dome.mp4',
];

const has = (p) => existsSync(join(PUBLIC, p));

// --- thumbnail still -------------------------------------------------------
const domeClip = join(CLIPS, '06-dome.mp4');
const domeStill = join(PUBLIC, 'dome-still.jpg');
let hasDomeStill = existsSync(domeStill);
const stale =
  hasDomeStill && existsSync(domeClip) && statSync(domeClip).mtimeMs > statSync(domeStill).mtimeMs;
if (existsSync(domeClip) && (!hasDomeStill || stale)) {
  try {
    execFileSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '6', '-i', domeClip, '-frames:v', '1', '-q:v', '2', domeStill],
      { stdio: 'inherit' },
    );
    hasDomeStill = true;
    console.log('manifest: extracted public/dome-still.jpg from 06-dome.mp4 @ 6s');
  } catch {
    console.warn('manifest: could not extract dome-still.jpg (ffmpeg missing?) — the thumbnail will fall back to the clip');
  }
}

// --- voice cues ------------------------------------------------------------
// src/subtitles.ts imports public/voice.json at build time; this only reports on it.
let voiceCueCount = 0;
if (has('voice.json')) {
  try {
    const parsed = JSON.parse(readFileSync(join(PUBLIC, 'voice.json'), 'utf8'));
    if (Array.isArray(parsed)) {
      voiceCueCount = parsed.filter(
        (c) => typeof c?.text === 'string' && Number.isFinite(c.startSec) && Number.isFinite(c.endSec),
      ).length;
      if (voiceCueCount !== parsed.length) {
        console.warn(`manifest: ${parsed.length - voiceCueCount} cue(s) in voice.json are malformed`);
      }
    }
  } catch (err) {
    console.warn(`manifest: public/voice.json is not valid JSON (${err.message})`);
  }
} else {
  console.warn('manifest: public/voice.json is missing — the subtitle track will be empty');
}

const missingClips = CLIP_FILES.filter((f) => !existsSync(join(CLIPS, f)));
if (missingClips.length) {
  console.warn(`manifest: ${missingClips.length} clip(s) missing — run \`npm run placeholders\`: ${missingClips.join(', ')}`);
}
if (!existsSync(join(CLIPS, 'log.json'))) {
  console.warn('manifest: public/clips/log.json is missing — run `npm run placeholders` before rendering');
}

const manifest = {
  hasVoice: has('voice.mp3'),
  hasAmbient: has('ambient.m4a'),
  hasMusic: has('music.m4a'),
  hasDomeStill,
  clips: Object.fromEntries(CLIP_FILES.map((f) => [f, existsSync(join(CLIPS, f))])),
};

const next = `${JSON.stringify(manifest, null, 2)}\n`;
const prev = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : '';
if (prev !== next) writeFileSync(MANIFEST, next);
console.log(
  `manifest: music=${manifest.hasMusic} ambient=${manifest.hasAmbient} voice=${manifest.hasVoice} voiceCues=${voiceCueCount} domeStill=${manifest.hasDomeStill} clips=${CLIP_FILES.length - missingClips.length}/${CLIP_FILES.length}`,
);
