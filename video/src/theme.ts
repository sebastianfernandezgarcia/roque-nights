import type React from 'react';
import { loadFont } from '@remotion/google-fonts/IBMPlexMono';

const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '700'],
  subsets: ['latin'],
});

/** IBM Plex Mono everywhere, with a real monospace fallback if the font never lands. */
export const MONO = `${fontFamily}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** The app's control-room palette. */
export const C = {
  bg: '#05060a',
  panel: '#101319',
  edge: '#1c2230',
  amber: '#ffb454',
  red: '#ff5c4d',
  faint: '#8a93a6',
  text: '#eef1f6',
} as const;

/** Uppercase, tracked-out label used for every small caption in the piece. */
export const label = (size = 12): React.CSSProperties => ({
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: size,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
});

/** A soft vignette. The only gradient the design allows. */
export const VIGNETTE =
  'radial-gradient(ellipse 78% 72% at 50% 46%, rgba(5,6,10,0) 42%, rgba(5,6,10,0.34) 74%, rgba(5,6,10,0.72) 100%)';
