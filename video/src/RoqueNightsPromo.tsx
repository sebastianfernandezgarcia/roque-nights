import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import manifest from './manifest.json';
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

    {manifest.hasAmbient ? (
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
