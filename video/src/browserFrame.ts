/**
 * The browser chrome the screen recordings are shown inside — and the one coordinate
 * mapping every annotation in the piece goes through.
 *
 * A screen scene is no longer the raw 1920x1080 recording filling the frame. It is that
 * recording scaled uniformly to fit under a 52 px browser bar, centred, with a 1 px
 * edge. Everything that has to point at something in the recording (the callout layer,
 * the context labels) is authored in RECORDING pixels — the coordinates you measure on
 * the raw mp4 — and pushed through `toScreen` / `toScreenBox`.
 *
 *   recording space   1920 x 1080, origin at the recording's top-left
 *   screen space      1920 x 1080, the composition itself
 *
 * There is exactly one scale, so a rectangle stays a rectangle and a circle stays a
 * circle; `toScreenLen` converts a length.
 */
import { HEIGHT, WIDTH } from './timeline';

/** Height of the browser bar, in composition pixels. */
export const BAR_H = 52;

/** The recording is scaled to fit the height left under the bar. */
export const FRAME_SCALE = (HEIGHT - BAR_H) / HEIGHT; // 0.9518518…

/** The recording's box on screen. */
export const FRAME_W = WIDTH * FRAME_SCALE; // 1827.55
export const FRAME_H = HEIGHT - BAR_H; // 1028
export const FRAME_X = (WIDTH - FRAME_W) / 2; // 46.22
export const FRAME_Y = BAR_H;

/** The browser window (bar + recording) spans the full frame height. */
export const WINDOW_X = FRAME_X;
export const WINDOW_W = FRAME_W;

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** Recording pixel → composition pixel. The only mapping the callouts use. */
export const toScreen = (x: number, y: number): Pt => ({
  x: FRAME_X + x * FRAME_SCALE,
  y: FRAME_Y + y * FRAME_SCALE,
});

/** Composition pixel → recording pixel (the inverse; used when measuring on a still). */
export const fromScreen = (x: number, y: number): Pt => ({
  x: (x - FRAME_X) / FRAME_SCALE,
  y: (y - FRAME_Y) / FRAME_SCALE,
});

/** A length in recording pixels → the same length on screen. */
export const toScreenLen = (l: number): number => l * FRAME_SCALE;

/** A whole box, recording → screen. */
export const toScreenBox = (b: Box): Box => ({
  x: FRAME_X + b.x * FRAME_SCALE,
  y: FRAME_Y + b.y * FRAME_SCALE,
  w: b.w * FRAME_SCALE,
  h: b.h * FRAME_SCALE,
});

// ------------------------------------------------------------------ the bar
//
// Laid out with absolute coordinates rather than flexbox, so the onboarding scene's
// "this is a live web app" label can point at the URL field by number.

const PAD = 18;

/** The three window dots — neutral, no brand. */
export const DOTS = [WINDOW_X + PAD + 4.5, WINDOW_X + PAD + 20.5, WINDOW_X + PAD + 36.5];
export const DOT_CY = BAR_H / 2;

/** The one tab. */
export const TAB: Box = { x: WINDOW_X + 76, y: 9, w: 232, h: 34 };

/** The URL field. Screen coordinates — the context label points here. */
export const URL_FIELD: Box = { x: WINDOW_X + 336, y: 11, w: 980, h: 30 };

/** The WebMCP chip at the right of the bar. */
export const BAR_CHIP: Box = { x: WINDOW_X + WINDOW_W - PAD - 352, y: 12, w: 352, h: 28 };

export const BAR_TAB_TITLE = 'Roque Nights';
export const BAR_URL = 'roque-nights.netlify.app';
export const BAR_CHIP_TEXT = 'WebMCP enabled · 11 site tools';
