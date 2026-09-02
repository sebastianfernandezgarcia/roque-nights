import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO } from '../theme';
import { FPS, type Scene } from '../timeline';
import { ChromeMask } from './ChromeMask';
import { ClipStage } from './ClipStage';

const WORDMARK = 'ROQUE NIGHTS';

/**
 * The title sits over the same dome as the cold open, then the scene hard-cuts to the
 * app (that cut and the one-second hold on its first frame live in timeline.ts).
 */
export const TitleScene: React.FC<{ readonly scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / FPS;

  // the cut to the app is where the second clip part starts
  const cutSec = (scene.parts[1]?.fromFrame ?? scene.durationInFrames) / FPS;

  const track = spring({ frame: frame - 0.5 * FPS, fps, config: { damping: 200, mass: 1.6 } });
  const letterSpacing = interpolate(track, [0, 1], [0.6, 0.18]);
  const rise = interpolate(track, [0, 1], [26, 0]);

  const titleOpacity = interpolate(
    t,
    [0.4, 1.6, cutSec - 0.9, cutSec - 0.25],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const taglineOpacity = interpolate(
    t,
    [2.1, 3.1, cutSec - 0.9, cutSec - 0.25],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // the app reveals itself under the title, so the hard cut to clip 01 is a cut in
  // content, not a cut into a different-looking frame
  const reveal = interpolate(t, [4.2, 6.85], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <ClipStage parts={scene.parts} />
      <ChromeMask right={reveal} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 34,
          fontFamily: MONO,
        }}
      >
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${rise}px)`,
            fontSize: 118,
            fontWeight: 500,
            color: C.amber,
            letterSpacing: `${letterSpacing}em`,
            // letter-spacing pads the last glyph too; pull it back so it stays centred
            marginRight: `-${letterSpacing}em`,
            whiteSpace: 'nowrap',
          }}
        >
          {WORDMARK}
        </div>
        <div
          style={{
            opacity: taglineOpacity,
            fontSize: 26,
            fontWeight: 400,
            letterSpacing: '0.34em',
            marginRight: '-0.34em',
            textTransform: 'uppercase',
            color: C.text,
          }}
        >
          Plan the sky with your agent
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
