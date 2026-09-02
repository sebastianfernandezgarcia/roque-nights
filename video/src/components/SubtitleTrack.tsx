import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { CUES, TOOL_NAME_RE, type Cue } from '../subtitles';
import { C, MONO } from '../theme';
import { FPS } from '../timeline';

const FADE_SEC = 0.2;

/** Keeps the pill off the app's right-hand panel column. */
const SUBTITLE_MAX_WIDTH = 1120;
/** Keeps the pill off the app's time bar along the bottom (its top edge is y≈968). */
const SUBTITLE_BOTTOM = 150;

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

const Line: React.FC<{ readonly cue: Cue; readonly t: number }> = ({ cue, t }) => {
  const opacity = interpolate(
    t,
    [cue.startSec, cue.startSec + FADE_SEC, cue.endSec - FADE_SEC, cue.endSec],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  return (
    <div
      style={{
        opacity,
        // never wider than the sky map: the app's panel column starts at x=1528, so a
        // frame-centred pill has to stop before 1520
        maxWidth: SUBTITLE_MAX_WIDTH,
        padding: '15px 30px',
        backgroundColor: 'rgba(5, 6, 10, 0.8)',
        border: `1px solid ${C.edge}`,
        fontFamily: MONO,
        fontWeight: 400,
        fontSize: 34,
        lineHeight: 1.32,
        letterSpacing: '0.01em',
        color: C.text,
        textAlign: 'center',
        textWrap: 'balance',
      }}
    >
      {withToolNames(cue.text)}
    </div>
  );
};

export const SubtitleTrack: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const active = CUES.filter((c) => t >= c.startSec && t <= c.endSec);
  if (active.length === 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: SUBTITLE_BOTTOM,
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {active.map((cue) => (
        <Line key={`${cue.startSec}-${cue.text}`} cue={cue} t={t} />
      ))}
    </AbsoluteFill>
  );
};
