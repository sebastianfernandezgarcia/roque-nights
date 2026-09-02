import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { PILLS, TOOL_NAME_RE, type Pill } from '../subtitles';
import { C, MONO } from '../theme';
import { FPS } from '../timeline';

const FADE_SEC = 0.18;

/** Never wider than this, whatever the line length. */
const MAX_WIDTH = 1400;
/** Clear of the app's own time bar along the bottom of the frame. */
const BOTTOM = 150;
const FONT_SIZE = 36;

/** Tool names inside a subtitle are amber; everything else is white. */
const withToolNames = (text: string): React.ReactNode[] =>
  text.split(TOOL_NAME_RE).map((chunk, i) =>
    // split() with one capture group alternates plain / captured
    i % 2 === 1 ? (
      <span key={`${chunk}-${i}`} style={{ color: C.amber }}>
        {chunk}
      </span>
    ) : (
      <React.Fragment key={`${chunk}-${i}`}>{chunk}</React.Fragment>
    ),
  );

const Line: React.FC<{ readonly pill: Pill; readonly t: number }> = ({ pill, t }) => {
  const fade = Math.min(FADE_SEC, (pill.endSec - pill.startSec) / 3);
  const opacity = interpolate(
    t,
    [pill.startSec, pill.startSec + fade, pill.endSec - fade, pill.endSec],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  return (
    <div
      style={{
        opacity,
        maxWidth: MAX_WIDTH,
        padding: '14px 30px',
        backgroundColor: 'rgba(5, 6, 10, 0.85)',
        border: `1px solid ${C.edge}`,
        fontFamily: MONO,
        fontWeight: 400,
        fontSize: FONT_SIZE,
        lineHeight: 1.3,
        letterSpacing: 0,
        color: C.text,
        textAlign: 'center',
        // the wrap is decided in src/subtitles.ts, not by the box
        whiteSpace: 'pre',
      }}
    >
      {pill.lines.map((line, i) => (
        <div key={`${line}-${i}`}>{withToolNames(line)}</div>
      ))}
    </div>
  );
};

export const SubtitleTrack: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const active = PILLS.filter((p) => t >= p.startSec && t <= p.endSec);
  if (active.length === 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: BOTTOM,
        pointerEvents: 'none',
      }}
    >
      {active.map((pill) => (
        <Line key={`${pill.startSec}-${pill.cueId}`} pill={pill} t={t} />
      ))}
    </AbsoluteFill>
  );
};
