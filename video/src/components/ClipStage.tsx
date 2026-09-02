import React from 'react';
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import manifest from '../manifest.json';
import { C, MONO, VIGNETTE, label } from '../theme';
import { FPS, type ClipPart } from '../timeline';

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

const Footage: React.FC<{ readonly part: ClipPart }> = ({ part }) => (
  <OffthreadVideo
    src={staticFile(`clips/${part.file}`)}
    trimBefore={Math.round(part.clipStartSec * FPS)}
    playbackRate={part.playbackRate}
    muted
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
);

/**
 * One clip inside one scene.
 *
 * Two things make this more than an <OffthreadVideo>: the head hold (the title cuts to
 * the app's first frame and sits on it for a second) and the tail hold (when the voice
 * makes a scene longer than its clip, the last frame freezes — the clip is never sped up).
 * The Ken Burns drift sits outside both, so even a frozen frame keeps breathing.
 */
const Part: React.FC<{ readonly part: ClipPart }> = ({ part }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, Math.max(1, part.durationInFrames - 1)], [part.zoomFrom, part.zoomTo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const tailLocal =
    part.freezeTailFromFrame === null ? null : Math.max(0, part.freezeTailFromFrame - part.freezeFrames);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: part.zoomOrigin }}>
        {!clipExists(part.file) ? (
          <MissingClip file={part.file} />
        ) : (
          <>
            {part.freezeFrames > 0 ? (
              <Sequence durationInFrames={part.freezeFrames} layout="none" name="hold first frame">
                <Freeze frame={0}>
                  <Footage part={part} />
                </Freeze>
              </Sequence>
            ) : null}
            <Sequence from={part.freezeFrames} layout="none" name={part.clipId}>
              {tailLocal === null ? (
                <Footage part={part} />
              ) : (
                <Freeze frame={tailLocal} active={(f) => f >= tailLocal}>
                  <Footage part={part} />
                </Freeze>
              )}
            </Sequence>
          </>
        )}
      </AbsoluteFill>
      {part.darken > 0 ? (
        <AbsoluteFill style={{ backgroundColor: `rgba(5, 6, 10, ${part.darken})` }} />
      ) : null}
      {part.vignette > 0 ? (
        <AbsoluteFill
          style={{ background: VIGNETTE, opacity: part.vignette, pointerEvents: 'none' }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** The screen area: the clips of one scene, a 6 px inner edge and a soft vignette. */
export const ClipStage: React.FC<{ readonly parts: readonly ClipPart[] }> = ({ parts }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    {parts.map((part, i) => (
      <Sequence
        key={`${part.clipId}-${i}`}
        from={part.fromFrame}
        durationInFrames={part.durationInFrames}
        layout="none"
        name={part.clipId}
      >
        <Part part={part} />
      </Sequence>
    ))}
    <AbsoluteFill style={{ boxShadow: `inset 0 0 0 6px ${C.edge}`, pointerEvents: 'none' }} />
  </AbsoluteFill>
);
