#!/usr/bin/env node
/**
 * Placeholder clips + placeholder log.json, so the composition can be developed and
 * test-rendered before the real recording lands.
 *
 * SAFETY: this script NEVER overwrites an existing file. A real clip or a real
 * log.json always wins. Delete a placeholder by hand if you want it regenerated.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './lib/png-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS = join(ROOT, 'public', 'clips');
const DURATION_S = 20;

const BG = hex('#101319');
const EDGE = hex('#1c2230');
const AMBER = hex('#ffb454');
const FAINT = hex('#8a93a6');
const RED = hex('#ff5c4d');

/** @type {{id: string, file: string, events: {atMs: number, kind: 'tool'|'human'|'note', label: string, detail?: string}[]}[]} */
const CLIPS_SPEC = [
  {
    id: '01-onboarding',
    file: '01-onboarding.mp4',
    events: [
      { atMs: 4800, kind: 'human', label: 'copy prompt', detail: 'one-click copy · "Copied"' },
      { atMs: 9200, kind: 'note', label: 'tour closed', detail: '15 tools registered · 11 rows lit' },
      { atMs: 14500, kind: 'human', label: 'paste prompt', detail: 'three-hour night, next two weeks' },
    ],
  },
  {
    id: '02-agent-points',
    file: '02-agent-points.mp4',
    events: [
      { atMs: 2600, kind: 'tool', label: 'rank_nights', detail: '2026-09-13 · score 90 · Moon 8%' },
      { atMs: 6800, kind: 'tool', label: 'point_sky_map', detail: 'M13' },
      { atMs: 9900, kind: 'tool', label: 'point_sky_map', detail: 'M31' },
      { atMs: 12800, kind: 'tool', label: 'point_sky_map', detail: 'Saturn' },
      { atMs: 14900, kind: 'tool', label: 'point_sky_map', detail: 'M45' },
    ],
  },
  {
    id: '03-favorites',
    file: '03-favorites.mp4',
    events: [
      { atMs: 3400, kind: 'human', label: 'double-click M31', detail: 'favorite' },
      { atMs: 5600, kind: 'human', label: 'double-click M45', detail: 'favorite' },
      { atMs: 11200, kind: 'tool', label: 'describe_current_view', detail: 'favorites: M31, M45' },
    ],
  },
  {
    id: '04-ghost-plan',
    file: '04-ghost-plan.mp4',
    events: [
      { atMs: 3000, kind: 'tool', label: 'propose_plan', detail: '6 blocks · proposed by agent' },
      { atMs: 9500, kind: 'human', label: 'accept item 1' },
      { atMs: 11600, kind: 'human', label: 'accept item 2' },
      { atMs: 15200, kind: 'tool', label: 'commit_proposal', detail: '6 accepted' },
    ],
  },
  {
    id: '05-another-sky',
    file: '05-another-sky.mp4',
    events: [
      { atMs: 2800, kind: 'tool', label: 'set_observing_site', detail: 'Mauna Kea · 4205 m' },
      { atMs: 6200, kind: 'note', label: 'built for a different sky' },
      { atMs: 9400, kind: 'human', label: 'revalidate plan' },
      { atMs: 11500, kind: 'tool', label: 'modify_plan', detail: '3 kept, 3 moved' },
      { atMs: 16400, kind: 'tool', label: 'export_plan', detail: 'share link copied' },
    ],
  },
  {
    id: '06-dome',
    file: '06-dome.mp4',
    events: [{ atMs: 4000, kind: 'note', label: 'whole sky · play x600' }],
  },
];

const FACTS = {
  toolsRegistered: 15,
  bestNight: '2026-09-13',
  bestScore: 90,
  usableHours: 8.97,
  moonPct: 8,
  saturnRoque: 'Saturn transits 02:14, 41 deg alt',
  saturnMaunaKea: 'Saturn transits 00:52, 55 deg alt',
  revalidation: '3 kept, 3 moved',
};

mkdirSync(CLIPS, { recursive: true });

let made = 0;
let kept = 0;
for (const clip of CLIPS_SPEC) {
  const out = join(CLIPS, clip.file);
  if (existsSync(out)) {
    kept += 1;
    console.log(`keep   ${clip.file} (already there — not touched)`);
    continue;
  }
  // ffmpeg here is built without freetype (no drawtext), and its drawbox expressions are
  // evaluated once rather than per frame, so the placeholder is built as a one-image-per-
  // second PNG sequence. The second counter and the progress bar make a frozen frame obvious.
  const tmpDir = join(CLIPS, `.tmp-${clip.id}`);
  mkdirSync(tmpDir, { recursive: true });
  const title = clip.id.toUpperCase();
  for (let s = 0; s < DURATION_S; s += 1) {
    const card = new Canvas(1920, 1080, BG);
    card.strokeRect(120, 120, 1680, 840, 2, EDGE);
    card.text('PLACEHOLDER CLIP', 160, 180, 4, FAINT, 3);
    card.text(title, Math.round((1920 - Canvas.measure(title, 14, 2)) / 2), 440, 14, AMBER, 2);
    const stamp = `T + ${String(s).padStart(2, '0')}S`;
    card.text(stamp, Math.round((1920 - Canvas.measure(stamp, 8, 2)) / 2), 660, 8, RED, 2);
    card.rect(160, 800, 1600, 10, EDGE);
    card.rect(160, 800, Math.round((1600 * (s + 1)) / DURATION_S), 10, AMBER);
    card.text(`${DURATION_S}S / 30FPS / 1920X1080`, 160, 880, 4, FAINT, 3);
    writeFileSync(join(tmpDir, `f${String(s).padStart(3, '0')}.png`), card.toPng());
  }
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-framerate', '1', '-i', join(tmpDir, 'f%03d.png'),
      '-vf', 'fps=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20',
      '-an', out,
    ],
    { stdio: 'inherit' },
  );
  rmSync(tmpDir, { recursive: true, force: true });
  made += 1;
  console.log(`make   ${clip.file} (${DURATION_S}s placeholder)`);
}

const logPath = join(CLIPS, 'log.json');
if (existsSync(logPath)) {
  console.log('keep   log.json (already there — not touched)');
} else {
  const log = {
    recordedAt: new Date().toISOString(),
    url: 'https://roque-nights.netlify.app',
    placeholder: true,
    clips: CLIPS_SPEC.map((c) => ({
      id: c.id,
      file: c.file,
      durationMs: DURATION_S * 1000,
      events: c.events,
    })),
    facts: FACTS,
  };
  writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`);
  console.log('make   log.json (placeholder)');
}

console.log(`\n${made} placeholder clip(s) written, ${kept} real/existing clip(s) left alone.`);
