import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import manifest from './manifest.json';
import voiceCues from '../public/voice.json';
import { Callouts } from './components/Callouts';
import { ClipStage } from './components/ClipStage';
import { ClosingDome } from './components/ClosingDome';
import { ColdOpen } from './components/ColdOpen';
import { Outro } from './components/Outro';
import { SubtitleTrack } from './components/SubtitleTrack';
import { ToolChips } from './components/ToolChips';
import { TitleScene } from './components/TitleScene';
import { C, MONO } from './theme';
import { FPS, SCENES, TOTAL_FRAMES, type Scene } from './timeline';

const SceneBody: React.FC<{ readonly scene: Scene }> = ({ scene }) => {
  switch (scene.kind) {
    case 'coldOpen':
      return <ColdOpen scene={scene} />;
    case 'title':
      return <TitleScene scene={scene} />;
    case 'closing':
      return <ClosingDome scene={scene} />;
    case 'outro':
      return <Outro scene={scene} />;
    case 'screen':
      return <ClipStage segments={scene.segments} />;
  }
};

/** The narration is the piece; the bed sits under it. */
const VOICE_GAIN = 1.15;

/**
 * Music: full under the cold open, title, closing dome and outro; ducked while a
 * sentence is being spoken, with short ramps so the pumping stays musical. The
 * cue times come from voice.json, the same file that drives the subtitles.
 */
const MUSIC_FULL = 0.5;
const MUSIC_DUCKED = 0.16;
const DUCK_RAMP_SEC = 0.35;
const DUCK_LEAD_SEC = 0.15;
const MUSIC_FADE_IN_SEC = 1.2;
const MUSIC_FADE_OUT_SEC = 2.0;
const SPEECH: ReadonlyArray<readonly [number, number]> = (
  voiceCues as Array<{ startSec: number; endSec: number }>
).map((c) => [c.startSec - DUCK_LEAD_SEC, c.endSec + 0.1] as const);
const musicVolume = (f: number): number => {
  const t = f / FPS;
  // distance to the nearest speech interval (0 when inside one)
  let dist = Number.POSITIVE_INFINITY;
  for (const [a, b] of SPEECH) {
    if (t >= a && t <= b) {
      dist = 0;
      break;
    }
    dist = Math.min(dist, t < a ? a - t : t - b);
  }
  const duck = interpolate(dist, [0, DUCK_RAMP_SEC], [MUSIC_DUCKED, MUSIC_FULL], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeIn = interpolate(t, [0, MUSIC_FADE_IN_SEC], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const total = TOTAL_FRAMES / FPS;
  const fadeOut = interpolate(t, [total - MUSIC_FADE_OUT_SEC, total - 0.05], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return duck * fadeIn * fadeOut;
};
const AMBIENT_GAIN = 0.35;
/** The bed comes up as the outro card settles and the voice stops. */
const AMBIENT_SWELL = 0.6;
const AMBIENT_SWELL_SEC = 4;

export const RoqueNightsPromo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: MONO }}>
    {SCENES.map((scene) => (
      <Sequence
        key={scene.id}
        from={scene.from}
        durationInFrames={scene.durationInFrames}
        layout="none"
        name={scene.title}
      >
        <SceneBody scene={scene} />
      </Sequence>
    ))}

    <Callouts />
    <ToolChips />
    <SubtitleTrack />

    {manifest.hasMusic ? <Audio src={staticFile('music.m4a')} volume={musicVolume} /> : null}

    {manifest.hasAmbient && !manifest.hasMusic ? (
      <Audio
        src={staticFile('ambient.m4a')}
        // the bed fades itself in; it swells under the last four seconds and tapers off
        // the very end so the file does not stop on a click
        volume={(f) =>
          interpolate(
            f,
            [
              TOTAL_FRAMES - AMBIENT_SWELL_SEC * FPS,
              TOTAL_FRAMES - 0.4 * FPS,
              TOTAL_FRAMES - 1,
            ],
            [AMBIENT_GAIN, AMBIENT_SWELL, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          )
        }
      />
    ) : null}

    {/* public/voice.mp3 is already laid out on this timeline — no offset, no trim */}
    {manifest.hasVoice ? <Audio src={staticFile('voice.mp3')} volume={VOICE_GAIN} /> : null}
  </AbsoluteFill>
);
