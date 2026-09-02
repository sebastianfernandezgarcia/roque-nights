import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, MONO, label } from '../theme';
import { FPS, type Scene } from '../timeline';
import { ChromeMask } from './ChromeMask';
import { ClipStage } from './ClipStage';

/** The Roque at night, no title yet. Only the place, bottom-left. */
export const ColdOpen: React.FC<{ readonly scene: Scene }> = ({ scene }) => {
  const t = useCurrentFrame() / FPS;
  const end = scene.durationSec;
  const opacity = interpolate(t, [0.8, 2.2, end - 2.0, end - 0.7], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <ClipStage segments={scene.segments} />
      <ChromeMask right={0} />
      <div
        style={{
          position: 'absolute',
          left: 72,
          bottom: 39,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity,
          fontFamily: MONO,
        }}
      >
        <div style={{ width: 2, height: 30, backgroundColor: C.amber }} />
        <div style={{ ...label(13), color: C.faint }}>
          Roque de los Muchachos · La Palma · 2396 m
        </div>
      </div>
    </AbsoluteFill>
  );
};
