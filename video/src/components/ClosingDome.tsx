import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import { FPS, type Scene } from '../timeline';
import { ChromeMask } from './ChromeMask';
import { ClipStage } from './ClipStage';

const closeAt = (t: number, from: number, to: number) =>
  interpolate(t, [from, to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/**
 * The last shot loses the UI: the panel column goes first, then the header and the time
 * bar, until only the sky is left turning. Bookends the cold open.
 */
export const ClosingDome: React.FC<{ readonly scene: Scene }> = ({ scene }) => {
  const t = useCurrentFrame() / FPS;
  const fadeOut = interpolate(t, [scene.durationSec - 1.3, scene.durationSec - 0.05], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill>
      <ClipStage parts={scene.parts} />
      <ChromeMask right={closeAt(t, 3.5, 12.5)} top={closeAt(t, 7, 14)} bottom={closeAt(t, 7, 14)} />
      {/* the frozen tail (if the scene ever outlasts the clip) fades out under this */}
      <AbsoluteFill style={{ backgroundColor: C.bg, opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
