/**
 * The single source of truth for the edit.
 *
 * Nothing in here is hand-timed any more. Three files drive the whole composition:
 *
 *   public/scene-plan.json  scene order, scene lengths and the per-sentence ANCHORS
 *                           (scene-relative seconds) the voice-over lands on
 *   public/voice.json       the sentences themselves (subtitles, src/subtitles.ts)
 *   public/clips/log.json   the real recording: clip durations and the millisecond
 *                           each tool call resolved / each human click happened
 *
 * The scene lengths come straight from scene-plan.json, so the composition is exactly
 * as long as the voice-over (168.0 s). Inside each screen scene an ALIGNMENT is solved:
 * a list of segments `{ fromSec, toSec, clipStartSec, rate, holdAfter }` that make the
 * footage's key moments land on the narration's anchors. A segment either plays the clip
 * at `rate` or freezes one frame; the solver holds a motionless frame when a clip is too
 * short for its window and raises the rate (never past RATE_MAX) when it is too long.
 */
import scenePlanJson from '../public/scene-plan.json';
import { clipDurationSec, clipEvents, firstActionSec } from './log';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/**
 * public/voice.mp3 is already mixed onto this timeline — sentence N starts at exactly
 * voice.json[N].startSec of the composition — so the voice track needs no offset.
 */
export const VOICE_OFFSET_SEC = 0;

/** How much of a clip is trimmed off before its first real action. */
export const PRE_ROLL_SEC = 0.4;

/**
 * Per-clip pre-roll overrides. 01-onboarding opens on the wall-clock daylight dome and
 * only flips to the night sky 0.12 s before its first action, so it starts on the action.
 */
const PRE_ROLL_OVERRIDE: Partial<Record<ClipId, number>> = {
  '01-onboarding': 0,
};

/**
 * Clip seconds per composition second. Outside this band a screen recording reads as
 * wrong — sped-up cursors jitter, slowed-down ones smear. The solver clamps to it and
 * reports every clamp (see ALIGNMENT_REPORT).
 */
export const RATE_MIN = 0.85;
export const RATE_MAX = 1.45;

/**
 * The dome timelapse is not a screen recording: it is deliberately slowed to 0.6 so the
 * opening breathes. It is exempt from the band above.
 */
const DOME_RATE = 0.6;

/** Ken Burns: 0.02 of scale across a typical 18 s shot. Only bare-dome shots drift. */
export const DRIFT_PER_SEC = 0.02 / 18;

export type ClipId =
  | '01-onboarding'
  | '02-agent-points'
  | '03-favorites'
  | '04-ghost-plan'
  | '05-another-sky'
  | '06-dome';

export type SceneId =
  | 'coldOpen'
  | 'title'
  | 'onboarding'
  | 'agentPoints'
  | 'favorites'
  | 'ghostPlan'
  | 'anotherSky'
  | 'closingDome'
  | 'outro';

export type SceneKind = 'coldOpen' | 'title' | 'screen' | 'closing' | 'outro';

// ---------------------------------------------------------------- scene plan

type PlanAnchor = { sentence: string; startSec: number; endSec: number };
type PlanScene = { scene: string; startSec: number; durationSec: number; anchors: PlanAnchor[] };

const PLAN = scenePlanJson as unknown as { totalSec: number; scenes: PlanScene[] };

const planScene = (id: SceneId): PlanScene => {
  const found = PLAN.scenes.find((s) => s.scene === id);
  if (!found) throw new Error(`scene-plan.json has no scene "${id}"`);
  return found;
};

const planAnchor = (id: SceneId, sentence: string): PlanAnchor => {
  const found = planScene(id).anchors.find((a) => a.sentence === sentence);
  if (!found) throw new Error(`scene-plan.json: scene "${id}" has no sentence "${sentence}"`);
  return found;
};

/** Absolute composition second a sentence starts on. */
const at = (id: SceneId, sentence: string): number =>
  planScene(id).startSec + planAnchor(id, sentence).startSec;

/** Absolute composition second a sentence ends on. */
const atEnd = (id: SceneId, sentence: string): number =>
  planScene(id).startSec + planAnchor(id, sentence).endSec;

const startOf = (id: SceneId): number => planScene(id).startSec;
const endOf = (id: SceneId): number => planScene(id).startSec + planScene(id).durationSec;

// -------------------------------------------------------------- recording log

/** Clip second a `tool` / `human` event happened on. `nth` picks repeats (0-based). */
const ev = (clipId: ClipId, label: string, nth = 0): number => {
  const hits = clipEvents(clipId).filter((e) => e.kind !== 'note' && e.label === label);
  const hit = hits[nth];
  if (!hit) throw new Error(`log.json: ${clipId} has no ${label} #${nth}`);
  return hit.atMs / 1000;
};

/** Where a clip is trimmed: its first real action minus the pre-roll. */
export const clipTrimSec = (clipId: ClipId): number =>
  Math.max(0, firstActionSec(clipId) - (PRE_ROLL_OVERRIDE[clipId] ?? PRE_ROLL_SEC));

// ------------------------------------------------------------------ alignment

export type AlignSegment = {
  clipId: ClipId;
  /** absolute composition seconds */
  fromSec: number;
  toSec: number;
  /** clip second on screen at `fromSec` */
  clipStartSec: number;
  /** clip seconds per composition second while the segment plays */
  rate: number;
  /** freeze the last available frame instead of running past the end of the file */
  holdAfter: boolean;
  /** freeze at this clip second instead of at the end of the file (a held beat) */
  holdFromClipSec: number | null;
  /** why this segment exists — printed by `npm run alignment` */
  why: string;
};

const notes: string[] = [];
const note = (line: string) => notes.push(line);

/**
 * Lays one clip down the timeline.
 *
 * `landOn` is the whole trick: it makes a clip second arrive on a narration anchor by
 * freezing the current frame for the slack (when there is footage to spare) or by
 * raising the rate (when there is not), and it reports how late it lands if RATE_MAX
 * is not enough.
 */
class Track {
  readonly segs: AlignSegment[] = [];
  private t: number;
  private c: number;

  constructor(
    private readonly clipId: ClipId,
    startSec: number,
    clipStartSec: number,
  ) {
    this.t = startSec;
    this.c = clipStartSec;
  }

  get timeSec(): number {
    return this.t;
  }

  get clipSec(): number {
    return this.c;
  }

  /** Freeze the frame that is on screen until `toSec`. */
  holdUntil(toSec: number, why: string): void {
    if (toSec <= this.t + 1e-6) return;
    this.segs.push({
      clipId: this.clipId,
      fromSec: this.t,
      toSec,
      clipStartSec: this.c,
      rate: 1,
      holdAfter: true,
      holdFromClipSec: this.c,
      why: `hold · ${why}`,
    });
    this.t = toSec;
  }

  /** Play until the clip reaches `clipTo`. */
  playTo(clipTo: number, rate: number, why: string): void {
    if (clipTo <= this.c + 1e-6) return;
    const toSec = this.t + (clipTo - this.c) / rate;
    this.segs.push({
      clipId: this.clipId,
      fromSec: this.t,
      toSec,
      clipStartSec: this.c,
      rate,
      holdAfter: false,
      holdFromClipSec: null,
      why,
    });
    this.t = toSec;
    this.c = clipTo;
  }

  /** Play until the composition reaches `toSec`, freezing if the footage runs out. */
  playUntil(toSec: number, rate: number, why: string): void {
    if (toSec <= this.t + 1e-6) return;
    this.segs.push({
      clipId: this.clipId,
      fromSec: this.t,
      toSec,
      clipStartSec: this.c,
      rate,
      holdAfter: true,
      holdFromClipSec: null,
      why,
    });
    this.c += (toSec - this.t) * rate;
    this.t = toSec;
    const total = clipDurationSec(this.clipId);
    if (this.c > total) {
      note(`${this.clipId} · ${why}: footage runs out at ${total.toFixed(2)}s, last frame held`);
      this.c = total;
    }
  }

  /**
   * Make clip second `clipTo` arrive at composition second `atSec`.
   * Returns how many seconds late it actually lands (0 when it lands on the anchor).
   */
  landOn(clipTo: number, atSec: number, preferredRate: number, why: string): number {
    const need = clipTo - this.c;
    const roomForHold = atSec - need / preferredRate;
    if (roomForHold >= this.t - 1e-6) {
      this.holdUntil(roomForHold, why);
      this.playTo(clipTo, preferredRate, why);
      return 0;
    }
    const raw = need / (atSec - this.t);
    const rate = Math.min(RATE_MAX, raw);
    if (raw > RATE_MAX) {
      note(
        `${this.clipId} · ${why}: needs ${raw.toFixed(3)}x, clamped to ${RATE_MAX} — lands ` +
          `${(this.t + need / rate - atSec).toFixed(2)}s late`,
      );
    }
    this.playTo(clipTo, rate, why);
    return Math.max(0, this.t - atSec);
  }
}

const clampRate = (raw: number, why: string): number => {
  if (raw < RATE_MIN) {
    note(`${why}: rate ${raw.toFixed(3)} below ${RATE_MIN}, clamped`);
    return RATE_MIN;
  }
  if (raw > RATE_MAX) {
    note(`${why}: rate ${raw.toFixed(3)} above ${RATE_MAX}, clamped`);
    return RATE_MAX;
  }
  return raw;
};

// --- the beats the narration asks the footage to hit ------------------------
//
// Every offset below is a direction from the edit brief, applied to an anchor read out
// of scene-plan.json. Nothing is a raw timestamp.

/** "rank_nights lands at sentence 08 + 2 s" */
const RANK_LAG_SEC = 2.0;
/** "the first double-click lands at sentence 11 + 0.6 s" */
const DOUBLE_CLICK_LAG_SEC = 0.6;
/** "set_observing_site lands at sentence 15 + 3.9 s" */
const SITE_LAG_SEC = 3.9;
/** "export_plan lands at sentence 17 + 6 s", "Copy share link at sentence 17 + 9.5 s" */
const EXPORT_LAG_SEC = 6.0;
const SHARE_LAG_SEC = 9.5;

/** The app's first frame is held this long while the chrome plate retracts off it. */
const APP_REVEAL_SEC = 0.8;
/** Room left after the tour's Done so the bare panel is on screen before the next cut. */
const TOUR_TAIL_SEC = 2.4;
/** Room left after the last point_sky_map so the pointing beat is not cut off. */
const POINTING_TAIL_SEC = 0.8;

/**
 * Freeze points. Each one is a moment the frame-difference profile of the recording
 * shows as motionless, expressed as an offset from a logged event so it moves with a
 * re-recording:
 *   01-onboarding  halfway between the step-1 card and the Next that dismisses it
 *                  (the recording is still from 3.3 s to 5.0 s)
 *   02-agent-points 0.8 s after find_observable_targets — the target list has settled
 *                  (still from 6.6 s to 7.5 s)
 *   05-another-sky 1.7 s before Revalidate plan — Mauna Kea night, banner up, cursor
 *                  not moving yet (still from 9.5 s to 10.0 s); and 2.3 s after
 *                  Revalidate plan — the revalidated plan on screen (still 13.0–14.0 s)
 */
const PANEL_SETTLE_SEC = 0.8;
const CURSOR_LEAD_SEC = 1.7;
const REVALIDATED_SETTLE_SEC = 2.3;

const buildAlignment = (): AlignSegment[] => {
  const out: AlignSegment[] = [];

  // ---- 06-dome · cold open, then the bed under the title --------------------
  const domeTrim = clipTrimSec('06-dome');
  const dome = new Track('06-dome', 0, domeTrim);
  dome.playUntil(endOf('coldOpen'), DOME_RATE, 'cold open · the Roque');
  // the hard cut to the app happens on sentence 05
  const titleCut = at('title', '05');
  dome.playUntil(titleCut, DOME_RATE, 'title · dome bed');
  out.push(...dome.segs);

  // ---- 01-onboarding · the title's hard cut through the onboarding scene ----
  const app = new Track('01-onboarding', titleCut, clipTrimSec('01-onboarding'));
  const copyPrompt = ev('01-onboarding', 'Copy prompt');
  const tourDone = ev('01-onboarding', 'Done');
  const tourCardHold = (firstActionSec('01-onboarding') + ev('01-onboarding', 'Next', 0)) / 2;

  app.holdUntil(app.timeSec + APP_REVEAL_SEC, 'the app is revealed under the plate');
  app.playTo(tourCardHold, RATE_MIN + 0.05, 'tour step 1 settles');
  // the card is held through sentence 06, then Next → step 2 → Copy lands on sentence 07
  app.landOn(copyPrompt, at('onboarding', '07'), 1, 'Copy prompt');
  const tourOutRate = clampRate(
    (tourDone - copyPrompt) / (endOf('onboarding') - TOUR_TAIL_SEC - at('onboarding', '07')),
    'onboarding · tour out',
  );
  app.playUntil(endOf('onboarding'), tourOutRate, 'tour steps 3-4, Done, panel');
  out.push(...app.segs);

  // ---- 02-agent-points ------------------------------------------------------
  const agent = new Track('02-agent-points', startOf('agentPoints'), clipTrimSec('02-agent-points'));
  const firstPoint = ev('02-agent-points', 'point_sky_map', 0);
  const lastPoint = ev('02-agent-points', 'point_sky_map', 3);
  const pointRate = clampRate(
    Math.max(
      1,
      (lastPoint - firstPoint) /
        (endOf('agentPoints') - POINTING_TAIL_SEC - at('agentPoints', '09')),
    ),
    'agentPoints · pointings',
  );
  agent.landOn(
    ev('02-agent-points', 'rank_nights'),
    at('agentPoints', '08') + RANK_LAG_SEC,
    1,
    'rank_nights',
  );
  agent.playTo(
    ev('02-agent-points', 'find_observable_targets') + PANEL_SETTLE_SEC,
    1,
    'set_observing_time, find_observable_targets',
  );
  agent.landOn(firstPoint, at('agentPoints', '09'), pointRate, 'first point_sky_map');
  // the fifth pointing (the reset to the whole sky) falls past the scene and is cut
  agent.playUntil(endOf('agentPoints'), pointRate, 'the remaining pointings');
  out.push(...agent.segs);

  // ---- 03-favorites · one rate carries both anchors -------------------------
  //   describe_current_view has priority; the double-clicks come where that leaves them
  const describe = ev('03-favorites', 'describe_current_view');
  const firstDouble = ev('03-favorites', 'double-click · favorite M31');
  const describeAt = at('favorites', '13a') - startOf('favorites');
  const doubleAt = at('favorites', '11') + DOUBLE_CLICK_LAG_SEC - startOf('favorites');
  const favRate = clampRate((describe - firstDouble) / (describeAt - doubleAt), 'favorites');
  const fav = new Track('03-favorites', startOf('favorites'), describe - describeAt * favRate);
  fav.playUntil(endOf('favorites'), favRate, 'point, favorite, point, favorite, describe');
  out.push(...fav.segs);

  // ---- 04-ghost-plan · propose_plan on 13b, Commit accepted on the end of 14 -
  const propose = ev('04-ghost-plan', 'propose_plan');
  const commit = ev('04-ghost-plan', 'Commit accepted');
  const proposeAt = at('ghostPlan', '13b') - startOf('ghostPlan');
  const commitAt = atEnd('ghostPlan', '14') - startOf('ghostPlan');
  const ghostRate = clampRate((commit - propose) / (commitAt - proposeAt), 'ghostPlan');
  const ghost = new Track('04-ghost-plan', startOf('ghostPlan'), propose - proposeAt * ghostRate);
  ghost.playUntil(endOf('ghostPlan'), ghostRate, 'ghost blocks, four accepts, commit');
  out.push(...ghost.segs);

  // ---- 05-another-sky · four anchors, three held beats ----------------------
  const sky = new Track('05-another-sky', startOf('anotherSky'), clipTrimSec('05-another-sky'));
  const setSite = ev('05-another-sky', 'set_observing_site');
  const revalidate = ev('05-another-sky', 'Revalidate plan');
  const exportPlan = ev('05-another-sky', 'export_plan');
  const shareLink = ev('05-another-sky', 'Copy share link');

  sky.landOn(setSite, at('anotherSky', '15') + SITE_LAG_SEC, 1, 'set_observing_site');
  sky.playTo(revalidate - CURSOR_LEAD_SEC, 1, 'Mauna Kea daylight → night, the banner');
  // the banner is frozen under sentence 16, then the cursor resumes for the click
  sky.landOn(revalidate, at('anotherSky', '17'), 1, 'Revalidate plan');
  sky.playTo(revalidate + REVALIDATED_SETTLE_SEC, 1, 'four kept, four moved');
  sky.landOn(exportPlan, at('anotherSky', '17') + EXPORT_LAG_SEC, 1, 'export_plan');
  sky.landOn(shareLink, at('anotherSky', '17') + SHARE_LAG_SEC, 1, 'Copy share link');
  sky.playUntil(endOf('anotherSky'), 1, 'the shared plan');
  out.push(...sky.segs);

  // ---- 06-dome · the closing shot ------------------------------------------
  const closing = new Track('06-dome', startOf('closingDome'), domeTrim);
  closing.playUntil(endOf('closingDome'), 1, 'closing dome');
  out.push(...closing.segs);

  return out.sort((a, b) => a.fromSec - b.fromSec);
};

/** Cut a segment in two at an absolute composition second. */
const splitSegment = (seg: AlignSegment, atSec: number): [AlignSegment, AlignSegment] => {
  const played = seg.holdFromClipSec === null ? (atSec - seg.fromSec) * seg.rate : 0;
  return [
    { ...seg, toSec: atSec },
    { ...seg, fromSec: atSec, clipStartSec: seg.clipStartSec + played },
  ];
};

const splitOnSceneBoundaries = (segs: AlignSegment[], boundaries: number[]): AlignSegment[] => {
  let list = segs;
  for (const b of boundaries) {
    const next: AlignSegment[] = [];
    for (const seg of list) {
      if (seg.fromSec + 1e-6 < b && b < seg.toSec - 1e-6) next.push(...splitSegment(seg, b));
      else next.push(seg);
    }
    list = next;
  }
  return list;
};

// -------------------------------------------------------------------- visuals

type ShotStyle = {
  /** the bare dome rather than the app: full vignette and a Ken Burns drift */
  sky?: boolean;
  darken?: number;
  zoomFrom?: number;
  zoomTo?: number;
  zoomOrigin?: string;
};

/** Vignette strength over a shot of the app. 1 = the full bare-sky vignette. */
const SCREEN_VIGNETTE = 0.3;

const COLD_OPEN_ZOOM = 1.18;
const COLD_OPEN_ZOOM_END = COLD_OPEN_ZOOM + DRIFT_PER_SEC * planScene('coldOpen').durationSec;
const DOME_ORIGIN = '40% 50%';

/**
 * One entry per clip run inside a scene, in order. App runs are shown 1:1 with a third
 * of the vignette: a push-in would crop the app's own header wordmark and the right edge
 * of the tools panel, and the full vignette swallows the panel where the tool rows light
 * up. Only the two bare-dome shots are pushed in and drift.
 */
const SHOTS: Partial<Record<SceneId, ShotStyle[]>> = {
  coldOpen: [
    {
      sky: true,
      darken: 0.28,
      zoomFrom: COLD_OPEN_ZOOM,
      zoomTo: COLD_OPEN_ZOOM_END,
      zoomOrigin: DOME_ORIGIN,
    },
  ],
  title: [
    // pulls back to 1:1 as the chrome plate retracts, so the cut to the app is a cut in
    // content, not in framing
    { sky: true, darken: 0.45, zoomFrom: COLD_OPEN_ZOOM_END, zoomTo: 1, zoomOrigin: DOME_ORIGIN },
    {},
  ],
  onboarding: [{}],
  agentPoints: [{}],
  favorites: [{}],
  ghostPlan: [{}],
  anotherSky: [{}],
  closingDome: [
    { sky: true, zoomFrom: 1, zoomTo: 1 + DRIFT_PER_SEC * planScene('closingDome').durationSec },
  ],
};

const SCENE_META: Record<SceneId, { kind: SceneKind; title: string; chips: boolean }> = {
  coldOpen: { kind: 'coldOpen', title: '00 · Cold open — the Roque', chips: false },
  title: { kind: 'title', title: '01 · Title — ROQUE NIGHTS', chips: true },
  onboarding: { kind: 'screen', title: '02 · Onboarding — the tour and the prompt', chips: true },
  agentPoints: { kind: 'screen', title: '03 · Agent at work — rank_nights, point_sky_map', chips: true },
  favorites: { kind: 'screen', title: '04 · Favorites — the human gesture', chips: true },
  ghostPlan: { kind: 'screen', title: '05 · Ghost plan — nothing commits itself', chips: true },
  anotherSky: { kind: 'screen', title: '06 · Another sky — Mauna Kea', chips: true },
  closingDome: { kind: 'closing', title: '07 · Closing dome — the panel fades out', chips: true },
  outro: { kind: 'outro', title: '08 · Outro', chips: false },
};

// ------------------------------------------------------------------- resolved

export type ClipSegment = {
  clipId: ClipId;
  file: string;
  /** scene-local frames */
  fromFrame: number;
  durationInFrames: number;
  /** clip second of the first frame, snapped to a source frame */
  clipStartSec: number;
  playbackRate: number;
  /** local frame from which the frame is frozen (null = the segment never freezes) */
  freezeFromFrame: number | null;
  darken: number;
  vignette: number;
  zoomOrigin: string;
  zoomFrom: number;
  zoomTo: number;
  why: string;
};

export type Scene = {
  id: SceneId;
  kind: SceneKind;
  title: string;
  chips: boolean;
  startSec: number;
  durationSec: number;
  endSec: number;
  from: number;
  durationInFrames: number;
  segments: ClipSegment[];
  /** title scene only: scene second the dome hard-cuts to the app */
  cutSec: number | null;
};

const secToFrames = (sec: number) => Math.round(sec * FPS);

export const TOTAL_SEC = PLAN.scenes.reduce((acc, s) => acc + s.durationSec, 0);
export const TOTAL_FRAMES = secToFrames(TOTAL_SEC);

const SCENE_IDS = PLAN.scenes.map((s) => s.scene as SceneId);

const resolve = (): Scene[] => {
  const boundaries = PLAN.scenes.map((s) => s.startSec).filter((s) => s > 0);
  const segs = splitOnSceneBoundaries(buildAlignment(), boundaries);

  return SCENE_IDS.map((id, index) => {
    const plan = planScene(id);
    const meta = SCENE_META[id];
    const from = secToFrames(plan.startSec);
    const nextFrom =
      index + 1 < SCENE_IDS.length ? secToFrames(planScene(SCENE_IDS[index + 1]).startSec) : TOTAL_FRAMES;
    const sceneEnd = plan.startSec + plan.durationSec;

    const mine = segs.filter((s) => s.fromSec >= plan.startSec - 1e-6 && s.toSec <= sceneEnd + 1e-6);

    // one style per clip run inside the scene
    const styles = SHOTS[id] ?? [];
    const runIndexOf: number[] = [];
    let run = -1;
    mine.forEach((s, i) => {
      if (i === 0 || s.clipId !== mine[i - 1].clipId) run += 1;
      runIndexOf[i] = run;
    });
    const runSpan = new Map<number, { from: number; to: number }>();
    mine.forEach((s, i) => {
      const r = runIndexOf[i];
      const span = runSpan.get(r);
      if (!span) runSpan.set(r, { from: s.fromSec, to: s.toSec });
      else span.to = s.toSec;
    });

    const segments: ClipSegment[] = mine.map((s, i) => {
      const style = styles[runIndexOf[i]] ?? {};
      const span = runSpan.get(runIndexOf[i]) as { from: number; to: number };
      const zoomA = style.zoomFrom ?? 1;
      const zoomB = style.zoomTo ?? zoomA;
      const lerp = (x: number) =>
        span.to - span.from < 1e-6 ? zoomA : zoomA + ((x - span.from) / (span.to - span.from)) * (zoomB - zoomA);

      const fromFrame = secToFrames(s.fromSec) - from;
      const durationInFrames = secToFrames(s.toSec) - secToFrames(s.fromSec);
      const trimFrames = Math.round(s.clipStartSec * FPS);
      const clipStartSec = trimFrames / FPS;

      let freezeFromFrame: number | null = null;
      if (s.holdFromClipSec !== null) {
        freezeFromFrame = Math.max(
          0,
          Math.min(durationInFrames, Math.round(((s.holdFromClipSec - clipStartSec) / s.rate) * FPS)),
        );
      } else if (s.holdAfter) {
        const playable =
          Math.floor(((clipDurationSec(s.clipId) - clipStartSec) / s.rate) * FPS) - 2;
        if (playable < durationInFrames) freezeFromFrame = Math.max(0, playable);
      }

      return {
        clipId: s.clipId,
        file: `${s.clipId}.mp4`,
        fromFrame,
        durationInFrames,
        clipStartSec,
        playbackRate: s.rate,
        freezeFromFrame,
        darken: style.darken ?? 0,
        vignette: style.sky ? 1 : SCREEN_VIGNETTE,
        zoomOrigin: style.zoomOrigin ?? '50% 50%',
        zoomFrom: lerp(s.fromSec),
        zoomTo: lerp(s.toSec),
        why: s.why,
      };
    });

    const appRun = segments.find((s) => s.clipId !== segments[0]?.clipId);

    return {
      id,
      kind: meta.kind,
      title: meta.title,
      chips: meta.chips,
      startSec: plan.startSec,
      durationSec: plan.durationSec,
      endSec: sceneEnd,
      from,
      durationInFrames: nextFrom - from,
      segments,
      cutSec: id === 'title' && appRun ? appRun.fromFrame / FPS : null,
    };
  });
};

export const SCENES: Scene[] = resolve();

export const getScene = (id: SceneId): Scene => {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`unknown scene: ${id}`);
  return scene;
};

/** Seconds → frames, on the composition's clock. */
export const frames = secToFrames;

// ---------------------------------------------------------------- event times

export type MappedEvent = {
  sceneId: SceneId;
  clipId: ClipId;
  label: string;
  kind: 'tool' | 'human';
  /** absolute composition frame the event lands on */
  frame: number;
  atMs: number;
};

/** Chips are dropped when the narration never mentions the call. */
const CHIP_BLOCKLIST: { sceneId: SceneId; label: string }[] = [
  // the Mauna Kea midnight jump is a side effect of moving the site, not a beat the
  // voice-over ever names
  { sceneId: 'anotherSky', label: 'set_observing_time' },
];

/**
 * Every real `tool` / `human` event, mapped through the alignment to the composition
 * frame it actually lands on. Used by the chip track and by the alignment report.
 */
export const MAPPED_EVENTS: MappedEvent[] = SCENES.flatMap((scene) => {
  if (!scene.chips) return [];
  const hits: MappedEvent[] = [];

  // contiguous runs of the same clip — a run is one unbroken pass through the footage,
  // holds included, so an event that falls on a held frame lands where the hold starts
  const runs: ClipSegment[][] = [];
  for (const seg of scene.segments) {
    const last = runs[runs.length - 1];
    if (last && last[0].clipId === seg.clipId) last.push(seg);
    else runs.push([seg]);
  }

  for (const run of runs) {
    const clipId = run[0].clipId;
    const span = (s: ClipSegment) => {
      const playFrames = s.freezeFromFrame ?? s.durationInFrames;
      return {
        from: s.clipStartSec,
        to: s.clipStartSec + (playFrames / FPS) * s.playbackRate,
        playFrames,
      };
    };
    const runFrom = span(run[0]).from;
    const runTo = span(run[run.length - 1]).to;
    // clip seconds are snapped to source frames, so allow a frame and a half at the seams
    const tol = 1.5 / FPS;

    for (const event of clipEvents(clipId)) {
      if (event.kind === 'note') continue;
      if (CHIP_BLOCKLIST.some((b) => b.sceneId === scene.id && b.label === event.label)) continue;
      const t = event.atMs / 1000;
      if (t < runFrom - tol || t > runTo + tol) continue;

      let seg = run[0];
      for (const s of run) if (s.clipStartSec <= t + tol) seg = s;
      const sp = span(seg);
      const local = Math.max(
        0,
        Math.min(sp.playFrames, Math.round(((t - sp.from) / seg.playbackRate) * FPS)),
      );
      hits.push({
        sceneId: scene.id,
        clipId,
        label: event.label,
        kind: event.kind,
        atMs: event.atMs,
        frame: scene.from + seg.fromFrame + local,
      });
    }
  }
  return hits;
}).sort((a, b) => a.frame - b.frame);

const landing = (clipId: ClipId, label: string, nth = 0): number | null => {
  const target = Math.round(ev(clipId, label, nth) * 1000);
  const hit = MAPPED_EVENTS.find((e) => e.clipId === clipId && e.atMs === target && e.label === label);
  return hit ? hit.frame / FPS : null;
};

// ------------------------------------------------------------------- report

export type AnchorCheck = {
  scene: SceneId;
  beat: string;
  targetSec: number;
  actualSec: number | null;
};

/** The beats the brief pins to the narration, and where the edit actually put them. */
export const ANCHOR_CHECKS: AnchorCheck[] = [
  {
    scene: 'onboarding',
    beat: 'Copy prompt',
    targetSec: at('onboarding', '07'),
    actualSec: landing('01-onboarding', 'Copy prompt'),
  },
  {
    scene: 'agentPoints',
    beat: 'rank_nights',
    targetSec: at('agentPoints', '08') + RANK_LAG_SEC,
    actualSec: landing('02-agent-points', 'rank_nights'),
  },
  {
    scene: 'agentPoints',
    beat: 'first point_sky_map',
    targetSec: at('agentPoints', '09'),
    actualSec: landing('02-agent-points', 'point_sky_map', 0),
  },
  {
    scene: 'agentPoints',
    beat: 'last point_sky_map',
    targetSec: endOf('agentPoints') - POINTING_TAIL_SEC,
    actualSec: landing('02-agent-points', 'point_sky_map', 3),
  },
  {
    scene: 'favorites',
    beat: 'first double-click',
    targetSec: at('favorites', '11') + DOUBLE_CLICK_LAG_SEC,
    actualSec: landing('03-favorites', 'double-click · favorite M31'),
  },
  {
    scene: 'favorites',
    beat: 'describe_current_view',
    targetSec: at('favorites', '13a'),
    actualSec: landing('03-favorites', 'describe_current_view'),
  },
  {
    scene: 'ghostPlan',
    beat: 'propose_plan',
    targetSec: at('ghostPlan', '13b'),
    actualSec: landing('04-ghost-plan', 'propose_plan'),
  },
  {
    scene: 'ghostPlan',
    beat: 'Commit accepted',
    targetSec: atEnd('ghostPlan', '14'),
    actualSec: landing('04-ghost-plan', 'Commit accepted'),
  },
  {
    scene: 'anotherSky',
    beat: 'set_observing_site',
    targetSec: at('anotherSky', '15') + SITE_LAG_SEC,
    actualSec: landing('05-another-sky', 'set_observing_site'),
  },
  {
    scene: 'anotherSky',
    beat: 'Revalidate plan',
    targetSec: at('anotherSky', '17'),
    actualSec: landing('05-another-sky', 'Revalidate plan'),
  },
  {
    scene: 'anotherSky',
    beat: 'export_plan',
    targetSec: at('anotherSky', '17') + EXPORT_LAG_SEC,
    actualSec: landing('05-another-sky', 'export_plan'),
  },
  {
    scene: 'anotherSky',
    beat: 'Copy share link',
    targetSec: at('anotherSky', '17') + SHARE_LAG_SEC,
    actualSec: landing('05-another-sky', 'Copy share link'),
  },
];

const f2 = (n: number) => n.toFixed(2).padStart(7);

/** `npm run alignment` prints this. */
export const ALIGNMENT_REPORT = (): string => {
  const lines: string[] = [];
  lines.push(
    `composition  ${TOTAL_SEC.toFixed(2)} s · ${TOTAL_FRAMES} frames @ ${FPS} fps · ${WIDTH}x${HEIGHT}`,
  );
  lines.push('');
  for (const scene of SCENES) {
    lines.push(
      `${scene.id.padEnd(12)} ${f2(scene.startSec)} → ${f2(scene.endSec)}  ` +
        `(${scene.durationSec.toFixed(2)} s, ${scene.durationInFrames} f)`,
    );
    for (const seg of scene.segments) {
      const a = scene.startSec + seg.fromFrame / FPS;
      const b = a + seg.durationInFrames / FPS;
      const playFrames = seg.freezeFromFrame ?? seg.durationInFrames;
      const clipTo = seg.clipStartSec + (playFrames / FPS) * seg.playbackRate;
      const held =
        seg.freezeFromFrame === null
          ? ''
          : ` hold ${((seg.durationInFrames - seg.freezeFromFrame) / FPS).toFixed(2)}s`;
      lines.push(
        `   ${f2(a)} → ${f2(b)}  ${seg.clipId}  clip ${seg.clipStartSec.toFixed(2)}→${clipTo.toFixed(2)}` +
          `  rate ${seg.playbackRate.toFixed(3)}${held}   ${seg.why}`,
      );
    }
  }
  lines.push('');
  lines.push('anchors (target → actual, seconds on the composition clock)');
  let worst = 0;
  for (const c of ANCHOR_CHECKS) {
    const d = c.actualSec === null ? NaN : c.actualSec - c.targetSec;
    if (Number.isFinite(d)) worst = Math.max(worst, Math.abs(d));
    lines.push(
      `   ${c.scene.padEnd(12)} ${c.beat.padEnd(22)} ${f2(c.targetSec)} → ` +
        `${c.actualSec === null ? '  (cut)' : f2(c.actualSec)}  ${
          Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}s` : ''
        }`,
    );
  }
  lines.push(`   worst deviation ${worst.toFixed(2)} s`);
  if (notes.length > 0) {
    lines.push('');
    lines.push('solver notes');
    for (const n of notes) lines.push(`   ${n}`);
  }
  lines.push('');
  lines.push(`chips: ${MAPPED_EVENTS.length}`);
  for (const e of MAPPED_EVENTS) {
    lines.push(`   ${f2(e.frame / FPS)}  ${e.kind.padEnd(5)} ${e.label}  (${e.sceneId})`);
  }
  return lines.join('\n');
};
