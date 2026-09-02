/**
 * Subtitles = the bold fragments of docs/video/script.md, nothing else.
 *
 * Timings are relative to their scene, so moving or resizing a scene in timeline.ts
 * carries its subtitles with it. A fragment with no timing is spread evenly across
 * whatever room the scene's untimed fragments have left.
 *
 * public/voice.json (absolute seconds, produced from the real voice-over) overrides
 * the whole track — see scripts/manifest.mjs.
 */
import { FACTS } from './log';
import manifest from './manifest.json';
import { SCENES, type SceneId } from './timeline';

/**
 * Every number the subtitles say comes out of video/public/clips/log.json `facts`,
 * measured against the deployed app during the recording — never typed in by hand.
 */
const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
] as const;

const ORDINALS: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh',
  8: 'eighth', 9: 'ninth', 10: 'tenth', 11: 'eleventh', 12: 'twelfth', 13: 'thirteenth',
  14: 'fourteenth', 15: 'fifteenth', 16: 'sixteenth', 17: 'seventeenth', 18: 'eighteenth',
  19: 'nineteenth', 20: 'twentieth', 21: 'twenty-first', 22: 'twenty-second',
  23: 'twenty-third', 24: 'twenty-fourth', 25: 'twenty-fifth', 26: 'twenty-sixth',
  27: 'twenty-seventh', 28: 'twenty-eighth', 29: 'twenty-ninth', 30: 'thirtieth',
  31: 'thirty-first',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const spell = (n: number): string => WORDS[n] ?? String(n);

/** facts.bestNight "2026-09-13" → "September thirteenth" */
const bestNightSpoken = (): string => {
  const [, month, day] = FACTS.bestNight.split('-').map(Number);
  return `${MONTHS[month - 1]} ${ORDINALS[day] ?? day}`;
};

/** facts.moonPct 8 → "a thin Moon" */
const moonSpoken = (): string =>
  FACTS.moonPct <= 12 ? 'a thin Moon' : `a ${FACTS.moonPct}% Moon`;

/** facts.usableHours 8.97 → "nine hours of darkness" */
const darknessSpoken = (): string =>
  `${spell(Math.round(FACTS.usableHours))} hours of darkness`;

/**
 * The header badge in the footage reads "WEBMCP LIVE · 11 TOOLS" at rest (12 while a
 * proposal is pending, 14 after the commit), so the line has to say both numbers or it
 * contradicts the frame it sits on. 15 is facts.toolsRegistered, the full catalogue.
 */
const ALWAYS_LIVE = 11;

export type Cue = { text: string; startSec: number; endSec: number };

type Fragment = {
  text: string;
  /** seconds from the start of the scene; omit both to be spread evenly */
  startSec?: number;
  endSec?: number;
};

const FRAGMENTS: Partial<Record<SceneId, Fragment[]>> = {
  // 0:00–0:14 cold open — the VO has no bold fragment here, only the location caption.
  title: [{ text: 'One live sky map, two operators.', startSec: 8.4, endSec: 13.4 }],
  onboarding: [
    // the tour is still open here; the badge behind it reads "11 TOOLS"
    {
      text: `${spell(FACTS.toolsRegistered)} WebMCP tools, ${spell(ALWAYS_LIVE)} always live.`,
      startSec: 2.4,
      endSec: 7.0,
    },
    {
      // lands after "Done" closes the tour at 7.4 s
      text: 'plan me a three-hour night, best night in the next two weeks, avoiding the Moon.',
      startSec: 8.4,
      endSec: 15.6,
    },
  ],
  agentPoints: [
    // rank_nights resolves at 1.4 s
    {
      text: `${bestNightSpoken()}: ${moonSpoken()}, ${darknessSpoken()}.`,
      startSec: 1.9,
      endSec: 8.2,
    },
    // the five point_sky_map calls run 5.9 s → 18.8 s
    { text: 'The agent is pointing the dome at each target while I watch.', startSec: 9.8, endSec: 18.0 },
  ],
  favorites: [
    // the two double-clicks land at 4.5 s and 10.6 s
    { text: 'Andromeda and the Pleiades as favorites.', startSec: 3.8, endSec: 11.4 },
    // describe_current_view resolves at 15.3 s
    { text: 'It reads my gesture through describe_current_view.', startSec: 12.8, endSec: 18.3 },
  ],
  ghostPlan: [
    // propose_plan resolves at 1.3 s, the ghost blocks appear with it
    { text: 'a ghost plan.', startSec: 1.8, endSec: 6.6 },
    // the four Accepts run 8.3 s → 12.9 s, Commit accepted at 15.8 s
    { text: 'item by item', startSec: 8.2, endSec: 14.2 },
  ],
  anotherSky: [
    // set_observing_site resolves at 1.3 s
    { text: 'Mauna Kea.', startSec: 1.6, endSec: 5.0 },
    // out before the human clicks Revalidate plan at 9.0 s
    { text: 'this plan was built for a different sky.', startSec: 5.6, endSec: 8.8 },
    // Copy share link at 16.9 s
    { text: 'a share link that carries the whole plan.', startSec: 15.6, endSec: 21.4 },
  ],
  closingDome: [
    { text: 'Zero servers. All the astronomy computed locally.', startSec: 3.2, endSec: 9.6 },
    {
      // ends where the shot starts fading to black
      text: "it doesn't scrape my interface. It uses the same instrument I do.",
      startSec: 11.0,
      endSec: 19.2,
    },
  ],
  // the outro says "Plan the sky with your agent." as the tagline itself, not as a pill
};

const PAD_SEC = 0.6;
const GAP_SEC = 0.4;

const spread = (fragments: Fragment[], sceneDuration: number): Cue[] => {
  const timed = fragments.filter((f) => f.startSec !== undefined && f.endSec !== undefined);
  const untimed = fragments.filter((f) => f.startSec === undefined || f.endSec === undefined);
  const cues: Cue[] = timed.map((f) => ({
    text: f.text,
    startSec: f.startSec as number,
    endSec: f.endSec as number,
  }));
  if (untimed.length > 0) {
    const room = sceneDuration - PAD_SEC * 2;
    const slot = room / untimed.length;
    untimed.forEach((f, i) => {
      const start = PAD_SEC + i * slot;
      cues.push({ text: f.text, startSec: start, endSec: start + Math.max(1.8, slot - GAP_SEC) });
    });
  }
  return cues.sort((a, b) => a.startSec - b.startSec);
};

const fromScript = (): Cue[] =>
  SCENES.flatMap((scene) => {
    const fragments = FRAGMENTS[scene.id];
    if (!fragments || fragments.length === 0) return [];
    return spread(fragments, scene.durationSec).map((c) => ({
      text: c.text,
      startSec: scene.startSec + c.startSec,
      endSec: scene.startSec + Math.min(c.endSec, scene.durationSec - 0.1),
    }));
  });

const voiceCues = (manifest.voiceCues ?? null) as Cue[] | null;

/** Absolute timeline seconds. public/voice.json wins when it exists. */
export const CUES: Cue[] = voiceCues && voiceCues.length > 0 ? voiceCues : fromScript();

export const SUBTITLES_FROM_VOICE = Boolean(voiceCues && voiceCues.length > 0);

/** snake_case identifiers inside a subtitle are tool names and get the amber treatment. */
export const TOOL_NAME_RE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
