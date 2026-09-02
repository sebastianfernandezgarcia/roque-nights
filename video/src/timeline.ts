/**
 * The single source of truth for the edit.
 *
 * Change a scene's `durationSec` and every later scene shifts automatically — the
 * composition length, the subtitles and the tool chips all follow. Clips are NEVER
 * sped up to fit: when a scene outlasts its clip the last frame is frozen.
 */
import { clipDurationSec, firstActionSec } from './log';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Shift the whole voice-over track (seconds). Positive = voice starts later. */
export const VOICE_OFFSET_SEC = 0;

/** How much of the clip is trimmed off before the first action. */
export const PRE_ROLL_SEC = 0.4;

/**
 * Per-clip pre-roll overrides.
 *
 * 01-onboarding: the page opens on the wall clock and only flips to the night sky at
 * 2.05 s — 0.12 s before its first action. A 400 ms pre-roll would put a pale daylight
 * dome under the title's held first frame, so this one clip starts on its first action.
 */
const PRE_ROLL_OVERRIDE: Partial<Record<ClipId, number>> = {
  '01-onboarding': 0,
};

/**
 * Ken Burns: 0.02 of scale across a typical 18 s scene, carried across continuing parts.
 * Only the bare-dome parts drift (see `sky`) — pushing into a screen recording would
 * crop the app's own header wordmark and the right edge of the tools panel.
 */
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

type ClipPartDef = {
  clipId: ClipId;
  /** seconds into the scene where this part starts (default 0) */
  atSec?: number;
  /** seconds on screen (default: to the end of the scene) */
  durationSec?: number;
  /** <= 1. Clips are never sped up. */
  playbackRate?: number;
  /** hold the part's first frame this long before letting the clip play */
  freezeFirstSec?: number;
  /** continue this clip where its previous part left off instead of restarting */
  continues?: boolean;
  /** 0..1 black overlay on top of the footage */
  darken?: number;
  /**
   * True when the part is the bare dome rather than the app.
   *
   * Sky parts get the full vignette and the Ken Burns drift. App parts get neither at
   * full strength: the vignette would swallow the right-hand panel, which is exactly
   * where the tool rows light up, and any push-in crops the app's own header wordmark
   * and the right edge of the panel. A screen recording is shown 1:1.
   */
  sky?: boolean;
  /**
   * Scale the part sits at before the drift. Used by the two masked dome shots: with the
   * right 30 % of the frame plated over, an un-zoomed recording leaves the dome as a
   * small disc in a large dark rectangle.
   */
  zoomBase?: number;
  /** transform-origin for that scale (default the centre of the frame) */
  zoomOrigin?: string;
  /** scale to land on at the end of the part, instead of drifting up from zoomBase */
  zoomEnd?: number;
};

type SceneDef = {
  id: SceneId;
  kind: SceneKind;
  /** shown in the Remotion studio timeline */
  title: string;
  durationSec: number;
  parts?: ClipPartDef[];
  /** false = no tool/human chips over this scene (the cold open is a bare sky) */
  chips?: boolean;
};

/**
 * Scene lengths start from docs/video/script.md and are then stretched to whatever the
 * real recording needs: a scene is never shorter than the moment its last tool or human
 * event has finished being chipped. Measured against video/public/clips/log.json:
 *
 *   scene         script   clip's last action (scene-local)   here
 *   agentPoints     18 s   point_sky_map · whole sky  18.8 s   22    (all five pointings)
 *   favorites       18 s   describe_current_view      15.3 s   18.5  (chip ends 18.1 s)
 *   ghostPlan       18 s   Commit accepted            15.8 s   19.5  (chip ends 18.6 s)
 *   closingDome     22 s   x600                        1.4 s   20.5  (all the clip has)
 *
 * Total 159.5 s — the script's 2:35 plus the four seconds the pointing beat really takes,
 * comfortably inside the 2:58 cap.
 */
export const SCENE_DEFS: SceneDef[] = [
  {
    id: 'coldOpen',
    kind: 'coldOpen',
    title: '00 · Cold open — the Roque',
    durationSec: 14,
    chips: false,
    parts: [
      // pushed in and biased left: the plate covers the right 30 %, so this keeps the
      // dome filling the part of the frame that is actually on screen
      {
        clipId: '06-dome',
        playbackRate: 0.6,
        darken: 0.28,
        sky: true,
        zoomBase: 1.18,
        zoomOrigin: '40% 50%',
      },
    ],
  },
  {
    id: 'title',
    kind: 'title',
    title: '01 · Title — ROQUE NIGHTS',
    durationSec: 14,
    parts: [
      {
        clipId: '06-dome',
        durationSec: 7,
        playbackRate: 0.6,
        darken: 0.45,
        continues: true,
        sky: true,
        zoomOrigin: '40% 50%',
        // pulls back to 1:1 as the plate retracts, so the app is revealed whole and the
        // hard cut to clip 01 is a cut in content, not in framing
        zoomEnd: 1,
      },
      // hard cut to the app: its first frame is held for a second, then it plays
      { clipId: '01-onboarding', atSec: 7, durationSec: 7, freezeFirstSec: 1 },
    ],
  },
  {
    id: 'onboarding',
    kind: 'screen',
    title: '02 · Onboarding — 15 tools registered',
    durationSec: 16,
    parts: [{ clipId: '01-onboarding', continues: true }],
  },
  {
    id: 'agentPoints',
    kind: 'screen',
    title: '03 · Agent at work — rank_nights, point_sky_map',
    durationSec: 22,
    parts: [{ clipId: '02-agent-points' }],
  },
  {
    id: 'favorites',
    kind: 'screen',
    title: '04 · Favorites — the human gesture',
    durationSec: 18.5,
    parts: [{ clipId: '03-favorites' }],
  },
  {
    id: 'ghostPlan',
    kind: 'screen',
    title: '05 · Ghost plan — nothing commits itself',
    durationSec: 19.5,
    parts: [{ clipId: '04-ghost-plan' }],
  },
  {
    id: 'anotherSky',
    kind: 'screen',
    title: '06 · Another sky — Mauna Kea',
    durationSec: 22,
    parts: [{ clipId: '05-another-sky' }],
  },
  {
    id: 'closingDome',
    kind: 'closing',
    title: '07 · Closing dome — the panel fades out',
    durationSec: 20.5,
    parts: [{ clipId: '06-dome', sky: true }],
  },
  { id: 'outro', kind: 'outro', title: '08 · Outro', durationSec: 13 },
];

export type ClipPart = {
  clipId: ClipId;
  file: string;
  /** scene-local frames */
  fromFrame: number;
  durationInFrames: number;
  freezeFrames: number;
  playbackRate: number;
  darken: number;
  vignette: number;
  zoomOrigin: string;
  /** where the clip is trimmed to, in clip seconds */
  clipStartSec: number;
  clipDurationSec: number;
  /**
   * Scene-local frame after which no clip footage is left: the video is frozen there
   * instead of being sped up or running past its end.
   */
  freezeTailFromFrame: number | null;
  zoomFrom: number;
  zoomTo: number;
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
  parts: ClipPart[];
};

const secToFrames = (sec: number) => Math.round(sec * FPS);

/** Vignette strength over a part that shows the app. 1 = the full bare-sky vignette. */
const SCREEN_VIGNETTE = 0.3;

/**
 * Where a clip is trimmed: its first real action minus the pre-roll, never below zero.
 * This is the only rule — a scene that outlasts what is left of the clip holds the last
 * frame (see `freezeTailFromFrame`); the trim is never pulled back into the dead air to
 * buy footage, and the clip is never sped up.
 */
export const clipTrimSec = (clipId: ClipId): number =>
  Math.max(0, firstActionSec(clipId) - (PRE_ROLL_OVERRIDE[clipId] ?? PRE_ROLL_SEC));

const resolve = (): Scene[] => {
  /** seconds of each clip already used by earlier parts of the same continuity chain */
  const consumed = new Map<ClipId, number>();
  const zoomAt = new Map<ClipId, number>();
  const partsByScene = new Map<number, ClipPart[]>();

  SCENE_DEFS.forEach((scene, sceneIndex) => {
    for (const def of scene.parts ?? []) {
      const atSec = def.atSec ?? 0;
      const durationSec = def.durationSec ?? scene.durationSec - atSec;
      const playbackRate = def.playbackRate ?? 1;
      const freezeSec = def.freezeFirstSec ?? 0;
      const playSec = Math.max(0, durationSec - freezeSec) * playbackRate;
      const carrySec = def.continues ? (consumed.get(def.clipId) ?? 0) : 0;
      const zoomFrom = def.continues ? (zoomAt.get(def.clipId) ?? 1) : (def.zoomBase ?? 1);
      const zoomTo = def.zoomEnd ?? zoomFrom + (def.sky ? DRIFT_PER_SEC * durationSec : 0);

      const total = clipDurationSec(def.clipId);
      const clipStartSec = clipTrimSec(def.clipId) + carrySec;
      const freezeFrames = secToFrames(freezeSec);
      const durationInFrames = secToFrames(durationSec);
      // scene-local frame where the footage runs out (2 frames of safety margin)
      const playableFrames =
        Math.floor(((total - clipStartSec) / playbackRate) * FPS) - 2 + freezeFrames;

      // a part that runs out of footage freezes; it cannot advance the chain past the end
      consumed.set(def.clipId, carrySec + Math.min(playSec, Math.max(0, total - clipStartSec)));
      zoomAt.set(def.clipId, zoomTo);

      const list = partsByScene.get(sceneIndex) ?? [];
      list.push({
        clipId: def.clipId,
        file: `${def.clipId}.mp4`,
        fromFrame: secToFrames(atSec),
        durationInFrames,
        freezeFrames,
        playbackRate,
        darken: def.darken ?? 0,
        vignette: def.sky ? 1 : SCREEN_VIGNETTE,
        zoomOrigin: def.zoomOrigin ?? '50% 50%',
        clipStartSec,
        clipDurationSec: total,
        freezeTailFromFrame:
          playableFrames < durationInFrames ? Math.max(freezeFrames, playableFrames) : null,
        zoomFrom,
        zoomTo,
      });
      partsByScene.set(sceneIndex, list);
    }
  });

  let startSec = 0;
  return SCENE_DEFS.map((def, index) => {
    const scene: Scene = {
      id: def.id,
      kind: def.kind,
      title: def.title,
      chips: def.chips ?? true,
      startSec,
      durationSec: def.durationSec,
      endSec: startSec + def.durationSec,
      from: secToFrames(startSec),
      durationInFrames: secToFrames(def.durationSec),
      parts: partsByScene.get(index) ?? [],
    };
    startSec += def.durationSec;
    return scene;
  });
};

export const SCENES: Scene[] = resolve();

export const TOTAL_SEC = SCENES.reduce((acc, s) => acc + s.durationSec, 0);
export const TOTAL_FRAMES = secToFrames(TOTAL_SEC);

export const getScene = (id: SceneId): Scene => {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`unknown scene: ${id}`);
  return scene;
};

/** Seconds → frames, on the composition's clock. */
export const frames = secToFrames;
