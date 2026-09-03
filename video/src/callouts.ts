/**
 * The callout layer's data: what the piece points at, when, and why.
 *
 * COORDINATE CONVENTION — stated once, used everywhere.
 * `x, y, w, h` are RECORDING pixels: the raw 1920x1080 mp4 in public/clips, measured
 * on the frame the callout is actually on screen over. `src/browserFrame.ts#toScreen`
 * pushes them through the browser-frame scale; nothing else does any conversion. The
 * two callouts that point at the browser chrome itself (the URL field) carry
 * `space: 'screen'` and are already in composition pixels.
 *
 *   rect    x, y = top-left,  w, h = size
 *   circle  x, y = centre,    w    = diameter
 *   point   x, y = centre,    w    = diameter of the dot's ring
 *
 * Every coordinate below was measured with ffmpeg + a pixel probe on the exact clip
 * second the composition shows at `atSec` (the alignment in src/timeline.ts maps one to
 * the other), never estimated: the right column scrolls to a different offset in almost
 * every scene, so the same tool row is at a different y in each.
 *
 * TIMING. `atSec` is composition seconds; a callout draws itself over DRAW_SEC, holds
 * for `holdSec`, then fades over FADE_SEC. Human clicks lead their logged millisecond
 * slightly: `log.json` records when an action RESOLVED, and a button that vanishes on
 * click (Revalidate plan, Commit accepted) is already gone by then, so the marker goes
 * up just before and dies with the element rather than hanging over the gap it left.
 *
 * COLOUR. Amber #ffb454 = the human did this. Red #ff5c4d = the agent did this.
 */
import { URL_FIELD } from './browserFrame';

export const DRAW_SEC = 0.25;
export const FADE_SEC = 0.25;

export type CalloutKind = 'rect' | 'circle' | 'point';
export type CalloutColor = 'amber' | 'red';
export type LabelSide = 'left' | 'right' | 'above' | 'below';

export type Callout = {
  readonly id: string;
  /** composition seconds */
  readonly atSec: number;
  readonly holdSec: number;
  readonly kind: CalloutKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h?: number;
  readonly label?: string;
  readonly color: CalloutColor;
  readonly labelSide?: LabelSide;
  /**
   * Override the fade. Three human clicks destroy the thing they are pointing at —
   * Commit accepted collapses the proposal card, Revalidate plan replaces the banner,
   * Copy share link swaps its own button for a COPIED chip. Those markers hold only
   * while the button is really there and then take twice as long to dissolve, so the
   * fade IS the app responding rather than a ring left hanging over a gap.
   */
  readonly fadeSec?: number;
  /** 'rec' (default) = recording pixels; 'screen' = composition pixels */
  readonly space?: 'rec' | 'screen';
  /** 22 for the callout language, 24 for the onboarding context labels */
  readonly labelSize?: number;
  /** what it is for — printed by `npm run alignment` */
  readonly why: string;
};

/** The onboarding block: what the viewer is looking at, said once. */
const CONTEXT: Callout[] = [
  {
    id: 'ctx-url',
    atSec: 28.8,
    holdSec: 3.0,
    kind: 'rect',
    space: 'screen',
    x: URL_FIELD.x - 7,
    y: URL_FIELD.y - 5,
    w: URL_FIELD.w + 14,
    h: URL_FIELD.h + 10,
    color: 'amber',
    label: 'Live web app in a browser with WebMCP enabled',
    labelSide: 'below',
    labelSize: 24,
    why: 'the hard cut to the app — what this is',
  },
  {
    // the tour card, measured on 01-onboarding at clip 3.73 (held 31.25 → 43.04)
    id: 'ctx-tour',
    atSec: 31.0,
    holdSec: 4.0,
    kind: 'rect',
    x: 678,
    y: 393,
    w: 564,
    h: 294,
    color: 'amber',
    label: 'First visit: a 4-step tour',
    labelSide: 'above',
    labelSize: 24,
    why: 'the tour modal',
  },
  {
    // the COPY button in tour step 2, measured at clip 7.06 (box 1136,456 → 1214,486)
    id: 'ctx-copy',
    atSec: 46.1,
    holdSec: 1.35,
    kind: 'circle',
    x: 1175,
    y: 471,
    w: 100,
    color: 'amber',
    label: 'the prompt you paste into your agent',
    labelSide: 'above',
    labelSize: 24,
    why: 'human · Copy prompt',
  },
  {
    // the header badge, box 1592,13 → 1818,41 — the same in every app clip
    id: 'ctx-badge',
    atSec: 52.55,
    holdSec: 2.35,
    kind: 'rect',
    x: 1583,
    y: 4,
    w: 243,
    h: 46,
    color: 'amber',
    label: '11 WebMCP tools\nregistered by the page',
    labelSide: 'below',
    labelSize: 24,
    why: 'the tour closes — the badge',
  },
  {
    // AGENT TOOLS card in 02-agent-points, 1528,260 → 1903,838
    id: 'ctx-panel',
    atSec: 55.25,
    holdSec: 1.45,
    kind: 'rect',
    x: 1518,
    y: 250,
    w: 395,
    h: 595,
    color: 'amber',
    label: 'What the agent can do here.\nRows light up when it calls a tool',
    labelSide: 'left',
    labelSize: 24,
    why: 'the panel the whole piece watches',
  },
];

/** 03 · the agent takes the instrument. */
const AGENT_POINTS: Callout[] = [
  {
    // rank_nights row lit, measured at clip 3.70: 1541,416 → 1890,446
    id: 'rank-row',
    atSec: 57.17,
    holdSec: 1.15,
    kind: 'rect',
    x: 1531,
    y: 406,
    w: 369,
    h: 50,
    color: 'red',
    label: 'agent calls rank_nights',
    labelSide: 'left',
    why: 'tool · rank_nights',
  },
  {
    // NIGHT chip box 1166,14 → 1389,39; it flips to 13/09/2026 on set_observing_time
    id: 'night-chip',
    atSec: 58.8,
    holdSec: 1.7,
    kind: 'rect',
    x: 1156,
    y: 4,
    w: 243,
    h: 45,
    color: 'red',
    label: 'picks Sep 13',
    labelSide: 'below',
    why: 'the NIGHT chip changes',
  },
  {
    // point_sky_map row lit, measured at clip 8.49: 1541,455 → 1890,484
    id: 'point-row',
    atSec: 64.6,
    holdSec: 1.55,
    kind: 'rect',
    x: 1531,
    y: 445,
    w: 369,
    h: 49,
    color: 'red',
    why: 'tool · point_sky_map (the row, first pointing only)',
  },
  // the dome centre: the reticle the sky swings under lands at 764,512 (measured on the
  // settled frame of each pointing — 52 px of crosshair, so 80 px of circle hugs it)
  {
    id: 'point-m13',
    atSec: 64.6,
    holdSec: 1.85,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 80,
    color: 'red',
    label: 'M13 · Hercules',
    labelSide: 'right',
    why: 'tool · point_sky_map M13',
  },
  {
    id: 'point-m31',
    atSec: 66.87,
    holdSec: 1.85,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 80,
    color: 'red',
    label: 'M31 · Andromeda',
    labelSide: 'right',
    why: 'tool · point_sky_map M31',
  },
  {
    id: 'point-saturn',
    atSec: 69.17,
    holdSec: 1.85,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 80,
    color: 'red',
    label: 'Saturn',
    labelSide: 'right',
    why: 'tool · point_sky_map Saturn',
  },
  {
    // the scene cuts 0.82 s after this call, so it is a flash, not a hold
    id: 'point-m45',
    atSec: 71.43,
    holdSec: 0.3,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 80,
    color: 'red',
    label: 'M45 · Pleiades',
    labelSide: 'right',
    why: 'tool · point_sky_map M45',
  },
];

/** 04 · the human gesture, and the agent reading it. */
const FAVORITES: Callout[] = [
  {
    id: 'fav-dbl1',
    atSec: 76.42,
    holdSec: 1.3,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 86,
    color: 'amber',
    label: 'double-click = favorite',
    labelSide: 'below',
    why: 'human · double-click M31',
  },
  {
    id: 'fav-dbl2',
    atSec: 83.45,
    holdSec: 1.1,
    kind: 'circle',
    x: 764,
    y: 512,
    w: 86,
    color: 'amber',
    label: 'double-click = favorite',
    labelSide: 'below',
    why: 'human · double-click M45',
  },
  {
    // Inspector FAVORITES row, measured at clip 14.30: text 1541,466 → 1731,479
    id: 'fav-row',
    atSec: 85.2,
    holdSec: 2.4,
    kind: 'rect',
    x: 1531,
    y: 456,
    w: 212,
    h: 40,
    color: 'amber',
    label: 'your favorites, readable by the agent',
    labelSide: 'left',
    why: 'the Inspector lists both favorites',
  },
  {
    // the same row in red: describe_current_view's own row is scrolled below the fold
    // at this second (measured), and the favorites line is what the call reads
    id: 'fav-describe',
    atSec: 89.0,
    holdSec: 2.2,
    kind: 'rect',
    x: 1531,
    y: 456,
    w: 212,
    h: 40,
    color: 'red',
    label: 'agent reads the favorites',
    labelSide: 'left',
    why: 'tool · describe_current_view',
  },
];

/** 05 · nothing commits itself. */
const GHOST_PLAN: Callout[] = [
  {
    // the plan timeline with the four dashed blocks, clip 3.93: 1540,128 → 1891,271
    id: 'ghost-timeline',
    atSec: 93.07,
    holdSec: 2.8,
    kind: 'rect',
    x: 1530,
    y: 118,
    w: 371,
    h: 163,
    color: 'red',
    label: 'ghost plan: proposed, not committed',
    labelSide: 'left',
    why: 'tool · propose_plan',
  },
  // the four ACCEPT buttons share x 1559 → 1646; each row's y measured on its own frame
  {
    id: 'accept-1',
    atSec: 97.8,
    holdSec: 0.6,
    kind: 'circle',
    x: 1603,
    y: 413,
    w: 88,
    color: 'amber',
    why: 'human · Accept 1',
  },
  {
    id: 'accept-2',
    atSec: 98.86,
    holdSec: 0.55,
    kind: 'circle',
    x: 1603,
    y: 472,
    w: 88,
    color: 'amber',
    why: 'human · Accept 2',
  },
  {
    id: 'accept-3',
    atSec: 99.96,
    holdSec: 0.55,
    kind: 'circle',
    x: 1603,
    y: 530,
    w: 88,
    color: 'amber',
    why: 'human · Accept 3',
  },
  {
    id: 'accept-4',
    atSec: 101.03,
    holdSec: 0.55,
    kind: 'circle',
    x: 1603,
    y: 589,
    w: 88,
    color: 'amber',
    why: 'human · Accept 4',
  },
  {
    // COMMIT ACCEPTED, 1660,615 → 1801,640. The card collapses the instant it is
    // pressed (measured: gone by clip 17.85 ≈ 102.95 s), so the rect dies with it.
    id: 'commit',
    atSec: 102.05,
    holdSec: 0.6,
    kind: 'rect',
    x: 1650,
    y: 605,
    w: 161,
    h: 45,
    color: 'amber',
    label: 'you confirm',
    labelSide: 'left',
    why: 'human · Commit accepted',
  },
  {
    // what the click produced, in the frame the button used to be in: the collapse is
    // instant, so the marker moves to the committed plan rather than hanging over a gap
    id: 'committed',
    atSec: 103.0,
    holdSec: 1.1,
    kind: 'rect',
    x: 1531,
    y: 278,
    w: 369,
    h: 155,
    color: 'amber',
    why: 'the plan is committed',
  },
];

/** 06 · another sky. */
const ANOTHER_SKY: Callout[] = [
  {
    // SITE chip reading Mauna Kea, clip 3.76: 756,15 → 1069,40
    id: 'site-chip',
    atSec: 110.2,
    holdSec: 2.1,
    kind: 'rect',
    x: 746,
    y: 5,
    w: 333,
    h: 45,
    color: 'red',
    label: 'agent moves the app to Mauna Kea',
    labelSide: 'below',
    why: 'tool · set_observing_site',
  },
  {
    // PLAN OUT OF DATE card on the held frame (clip 9.60): 1528,80 → 1903,234
    id: 'banner',
    atSec: 116.3,
    holdSec: 2.6,
    kind: 'rect',
    x: 1518,
    y: 70,
    w: 395,
    h: 174,
    color: 'amber',
    label: 'built for a different sky',
    labelSide: 'left',
    why: 'the app flags the plan',
  },
  {
    // REVALIDATE PLAN, 1540,197 → 1689,222; the banner is replaced on the click
    id: 'revalidate',
    atSec: 120.4,
    holdSec: 0.5,
    kind: 'circle',
    x: 1615,
    y: 210,
    w: 96,
    color: 'amber',
    why: 'human · Revalidate plan',
  },
  {
    // the result line that replaces it: 1528,80 → 1903,140. Its own text is the label.
    id: 'revalidated',
    atSec: 121.25,
    holdSec: 2.3,
    kind: 'rect',
    x: 1518,
    y: 70,
    w: 395,
    h: 80,
    color: 'amber',
    why: 'PLAN REVALIDATED · 4 kept, 4 moved',
  },
  {
    // EXPORT · JSON ICS CSV, clip 15.51: 1540,536 → 1752,561
    id: 'export-row',
    atSec: 127.23,
    holdSec: 1.0,
    kind: 'rect',
    x: 1530,
    y: 528,
    w: 232,
    h: 39,
    color: 'red',
    label: 'agent exports the plan',
    labelSide: 'left',
    why: 'tool · export_plan',
  },
  {
    // COPY SHARE LINK at the scroll offset it has by then (clip 19.00): 1541,328 →
    // 1690,354. The click swaps it for a COPIED chip in the EXPORT row at ~130.65.
    id: 'share-link',
    atSec: 129.9,
    holdSec: 0.55,
    kind: 'circle',
    x: 1615,
    y: 341,
    w: 96,
    color: 'amber',
    label: 'share link carries the whole plan',
    labelSide: 'left',
    why: 'human · Copy share link',
  },
  {
    // and the COPIED chip the click puts in the EXPORT row, 1541,297 → 1820,323
    id: 'share-copied',
    atSec: 130.8,
    holdSec: 0.5,
    kind: 'rect',
    x: 1531,
    y: 287,
    w: 299,
    h: 46,
    color: 'amber',
    why: 'the link is on the clipboard',
  },
];

export const CALLOUTS: readonly Callout[] = [
  ...CONTEXT,
  ...AGENT_POINTS,
  ...FAVORITES,
  ...GHOST_PLAN,
  ...ANOTHER_SKY,
].sort((a, b) => a.atSec - b.atSec);

/** First and last composition second a callout is on screen (fades included). */
export const span = (c: Callout): [number, number] => [
  c.atSec,
  c.atSec + DRAW_SEC + c.holdSec + (c.fadeSec ?? FADE_SEC),
];

/**
 * The rule the layer is built on: never more than two callouts on screen at once.
 * `npm run alignment` prints any second where three would overlap.
 */
export const overlapsOverTwo = (): string[] => {
  const edges = CALLOUTS.flatMap((c) => span(c));
  const bad: string[] = [];
  for (const t of edges) {
    const at = t + 1e-4;
    const on = CALLOUTS.filter((c) => {
      const [a, b] = span(c);
      return at >= a && at <= b;
    });
    if (on.length > 2) bad.push(`${at.toFixed(2)}s: ${on.map((c) => c.id).join(', ')}`);
  }
  return [...new Set(bad)];
};
