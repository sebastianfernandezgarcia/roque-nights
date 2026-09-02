import React from 'react';
import { Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { clipEvents, type EventKind } from '../log';
import { C, MONO } from '../theme';
import { FPS, SCENES } from '../timeline';

const IN_FRAMES = 0.15 * FPS; // 150 ms slide-in
const HOLD_FRAMES = 2.4 * FPS; // 2.4 s hold
const OUT_FRAMES = 0.2 * FPS; // 200 ms fade
export const CHIP_TOTAL_FRAMES = Math.round(IN_FRAMES + HOLD_FRAMES + OUT_FRAMES);

const CHIP_HEIGHT = 40;
const LANE_GAP = 10;

type Chip = { key: string; at: number; kind: EventKind; text: string; lane: number };

/**
 * One chip per real `tool` / `human` event in video/public/clips/log.json.
 *
 * `atMs` is measured from the clip's first frame, so it is mapped back through the part's
 * trim, its head hold and its playback rate, and then out to an ABSOLUTE composition
 * frame. Absolute is what makes a chip survive a cut: clip 01 runs from the title into
 * the onboarding scene, and the `Copy prompt` chip lands 1.3 s before that boundary.
 */
const allChips = (): Chip[] => {
  const raw: Omit<Chip, 'lane'>[] = [];
  for (const scene of SCENES) {
    if (!scene.chips) continue;
    for (const part of scene.parts) {
      for (const event of clipEvents(part.clipId)) {
        if (event.kind === 'note') continue;
        const local =
          part.fromFrame +
          part.freezeFrames +
          ((event.atMs / 1000 - part.clipStartSec) / part.playbackRate) * FPS;
        // only while this part is the one on screen
        if (local < part.fromFrame || local >= part.fromFrame + part.durationInFrames) continue;
        raw.push({
          key: `${scene.id}-${part.clipId}-${event.atMs}-${event.label}`,
          at: Math.round(scene.from + local),
          kind: event.kind,
          text: `${event.kind === 'tool' ? 'TOOL CALL' : 'HUMAN'} · ${event.label}`,
        });
      }
    }
  }
  raw.sort((a, b) => a.at - b.at);

  // stack overlapping chips instead of drawing them on top of each other
  const laneFreeAt: number[] = [];
  return raw.map((chip) => {
    let lane = laneFreeAt.findIndex((free) => free <= chip.at);
    if (lane === -1) lane = laneFreeAt.length;
    laneFreeAt[lane] = chip.at + CHIP_TOTAL_FRAMES;
    return { ...chip, lane };
  });
};

export const CHIPS: Chip[] = allChips();

const ChipBody: React.FC<{ readonly chip: Chip }> = ({ chip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entry = spring({ frame, fps, config: { damping: 200, mass: 0.35 }, durationInFrames: 6 });
  const x = interpolate(entry, [0, 1], [-26, 0]);
  const opacity = interpolate(
    frame,
    [0, IN_FRAMES, CHIP_TOTAL_FRAMES - OUT_FRAMES, CHIP_TOTAL_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2 * 1.1));

  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        top: 48 + chip.lane * (CHIP_HEIGHT + LANE_GAP),
        height: CHIP_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingRight: 20,
        paddingLeft: 15,
        backgroundColor: C.panel,
        border: `1px solid ${C.edge}`,
        borderLeft: `4px solid ${chip.kind === 'tool' ? C.red : C.amber}`,
        transform: `translateX(${x}px)`,
        opacity,
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: 7,
          backgroundColor: chip.kind === 'tool' ? C.red : C.amber,
          opacity: pulse,
        }}
      />
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 13,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.amber,
          whiteSpace: 'nowrap',
        }}
      >
        {chip.text}
      </div>
    </div>
  );
};

/** The whole chip track, rendered once over the composition. */
export const ToolChips: React.FC = () => (
  <>
    {CHIPS.map((chip) => (
      <Sequence
        key={chip.key}
        from={chip.at}
        durationInFrames={CHIP_TOTAL_FRAMES}
        layout="none"
        name={`chip · ${chip.text}`}
      >
        <ChipBody chip={chip} />
      </Sequence>
    ))}
  </>
);
