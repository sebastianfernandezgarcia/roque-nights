import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { FACTS } from '../log';
import { C, MONO, VIGNETTE } from '../theme';
import { FPS, type Scene } from '../timeline';

const fadeIn = (t: number, at: number) =>
  interpolate(t, [at, at + 0.8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export const Outro: React.FC<{ readonly scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / FPS;
  const end = scene.durationSec;

  const draw = spring({ frame: frame - 0.9 * FPS, fps, config: { damping: 200, mass: 2.2 } });
  const lineWidth = interpolate(draw, [0, 1], [0, 760]);
  const rise = interpolate(fadeIn(t, 0.3), [0, 1], [22, 0]);
  const out = interpolate(t, [end - 1.2, end - 0.1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: MONO }}>
      <AbsoluteFill style={{ background: VIGNETTE }} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          opacity: out,
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 500,
            color: C.amber,
            letterSpacing: '0.18em',
            marginRight: '-0.18em',
            opacity: fadeIn(t, 0.3),
            transform: `translateY(${rise}px)`,
          }}
        >
          ROQUE NIGHTS
        </div>

        <div style={{ height: 34 }} />
        <div style={{ width: lineWidth, height: 1, backgroundColor: C.amber, opacity: 0.85 }} />
        <div style={{ height: 40 }} />

        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: '0.3em',
            marginRight: '-0.3em',
            textTransform: 'uppercase',
            color: C.text,
            opacity: fadeIn(t, 1.8),
          }}
        >
          Plan the sky with your agent
        </div>

        <div style={{ height: 56 }} />
        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            color: C.faint,
            letterSpacing: '0.06em',
            opacity: fadeIn(t, 2.5),
          }}
        >
          roque-nights.netlify.app
        </div>
        <div style={{ height: 16 }} />
        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            color: C.faint,
            letterSpacing: '0.06em',
            opacity: fadeIn(t, 3.1),
          }}
        >
          github.com/sebastianfernandezgarcia/roque-nights
        </div>

        <div style={{ height: 54 }} />
        <div
          style={{
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: '0.24em',
            marginRight: '-0.24em',
            textTransform: 'uppercase',
            color: C.faint,
            opacity: fadeIn(t, 4.0),
          }}
        >
          MIT · zero servers · {FACTS.toolsRegistered} WebMCP tools
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
