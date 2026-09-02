import React from 'react';
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import manifest from '../manifest.json';
import { C, MONO, VIGNETTE, label } from '../theme';
import { FPS, type ClipSegment } from '../timeline';

const clipExists = (file: string): boolean =>
  (manifest.clips as Record<string, boolean | undefined>)[file] ?? false;

/** Shown instead of a crash when a clip has not been recorded yet. */
const MissingClip: React.FC<{ readonly file: string }> = ({ file }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.panel,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      fontFamily: MONO,
    }}
  >
    <div style={{ ...label(13), color: C.red }}>clip not recorded yet</div>
    <div style={{ ...label(28), color: C.faint, letterSpacing: '0.14em' }}>{file}</div>
  </AbsoluteFill>
);

const Footage: React.FC<{ readonly seg: ClipSegment }> = ({ seg }) => (
  <OffthreadVideo
    src={staticFile(`clips/${seg.file}`)}
    trimBefore={Math.round(seg.clipStartSec * FPS)}
    playbackRate={seg.playbackRate}
    muted
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
);

/**
 * One alignment segment: the clip from `clipStartSec` at `playbackRate`, frozen from
 * `freezeFromFrame` on.
 *
 * A freeze is either a held beat the solver asked for — the tour card the narration is
 * still explaining, the Mauna Kea banner under "this plan was built for a different
 * sky" — or the last frame of a clip that has run out. Both land on stretches the
 * recording itself is motionless through, so the hold reads as the app sitting still,
 * not as a stall. The Ken Burns drift sits outside the freeze, so a held dome breathes.
 */
const Segment: React.FC<{ readonly seg: ClipSegment }> = ({ seg }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(
    frame,
    [0, Math.max(1, seg.durationInFrames - 1)],
    [seg.zoomFrom, seg.zoomTo],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const freeze = seg.freezeFromFrame;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: seg.zoomOrigin }}>
        {!clipExists(seg.file) ? (
          <MissingClip file={seg.file} />
        ) : freeze === null ? (
          <Footage seg={seg} />
        ) : (
          <Freeze frame={freeze} active={(f) => f >= freeze}>
            <Footage seg={seg} />
          </Freeze>
        )}
      </AbsoluteFill>
      {seg.darken > 0 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(5, 6, 10, ${seg.darken})` }} />
      ) : null}
      {seg.vignette > 0 ? (
        <AbsoluteFill
          style={{ background: VIGNETTE, opacity: seg.vignette, pointerEvents: 'none' }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** The screen area: the segments of one scene, a 6 px inner edge and a soft vignette. */
export const ClipStage: React.FC<{ readonly segments: readonly ClipSegment[] }> = ({ segments }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    {segments.map((seg, i) => (
      <Sequence
        key={`${seg.clipId}-${i}`}
        from={seg.fromFrame}
        durationInFrames={seg.durationInFrames}
        layout="none"
        name={`${seg.clipId} · ${seg.why}`}
      >
        <Segment seg={seg} />
      </Sequence>
    ))}
    <AbsoluteFill style={{ boxShadow: `inset 0 0 0 6px ${C.edge}`, pointerEvents: 'none' }} />
  </AbsoluteFill>
);
