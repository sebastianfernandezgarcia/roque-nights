/**
 * The recording log written next to the clips by the capture agent.
 * Read at build time: clip durations drive the freeze-last-frame logic and the
 * `tool` / `human` events become the on-screen chips.
 */
import rawLog from '../public/clips/log.json';

export type EventKind = 'tool' | 'human' | 'note';

export type ClipEvent = {
  /** ms from the clip's first frame, at the moment the call RESOLVED */
  atMs: number;
  kind: EventKind;
  label: string;
  detail?: string;
};

export type ClipEntry = {
  id: string;
  file: string;
  durationMs: number;
  events: ClipEvent[];
  /** optional: if the recorder marks it explicitly, it wins over the derived value */
  firstActionAtMs?: number;
};

export type RecordingFacts = {
  toolsRegistered: number;
  bestNight: string;
  bestScore: number;
  usableHours: number;
  moonPct: number;
  saturnRoque: string;
  saturnMaunaKea: string;
  revalidation: string;
};

export type RecordingLog = {
  recordedAt: string;
  url: string;
  clips: ClipEntry[];
  facts: RecordingFacts;
  /** set by scripts/make-placeholders.mjs; absent on a real recording */
  placeholder?: boolean;
};

export const LOG = rawLog as unknown as RecordingLog;

export const FACTS = LOG.facts;

export const IS_PLACEHOLDER_LOG = LOG.placeholder === true;

const byId = new Map(LOG.clips.map((c) => [c.id, c]));

export const getClip = (id: string): ClipEntry | undefined => byId.get(id);

export const clipDurationSec = (id: string): number => (getClip(id)?.durationMs ?? 0) / 1000;

/**
 * When the clip stops being dead air: the first `human` or `tool` event.
 * `note` events are captions on the recording, not actions, so they don't count.
 */
export const firstActionSec = (id: string): number => {
  const clip = getClip(id);
  if (!clip) return 0;
  if (typeof clip.firstActionAtMs === 'number') return clip.firstActionAtMs / 1000;
  const actions = clip.events.filter((e) => e.kind === 'tool' || e.kind === 'human');
  if (actions.length === 0) return 0;
  return Math.min(...actions.map((e) => e.atMs)) / 1000;
};

export const clipEvents = (id: string): ClipEvent[] =>
  [...(getClip(id)?.events ?? [])].sort((a, b) => a.atMs - b.atMs);
