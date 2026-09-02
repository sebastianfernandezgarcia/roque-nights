import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import manifest from './manifest.json';
import { ClipStage } from './components/ClipStage';
import { ClosingDome } from './components/ClosingDome';
import { ColdOpen } from './components/ColdOpen';
import { Outro } from './components/Outro';
import { SubtitleTrack } from './components/SubtitleTrack';
import { ToolChips } from './components/ToolChips';
import { TitleScene } from './components/TitleScene';
import { C, MONO } from './theme';
import { FPS, SCENES, TOTAL_FRAMES, VOICE_OFFSET_SEC, type Scene } from './timeline';

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
      return <ClipStage parts={scene.parts} />;
  }
};

const AMBIENT_FADE_FRAMES = 3 * FPS;

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

    <ToolChips />
    <SubtitleTrack />

    {manifest.hasAmbient ? (
      <Audio
        src={staticFile('ambient.m4a')}
        // the bed fades itself in; this only takes it out under the outro
        volume={(f) =>
          interpolate(f, [TOTAL_FRAMES - AMBIENT_FADE_FRAMES, TOTAL_FRAMES - 1], [0.5, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    ) : null}

    {manifest.hasVoice ? (
      <Sequence from={Math.max(0, Math.round(VOICE_OFFSET_SEC * FPS))} layout="none" name="voice-over">
        <Audio
          src={staticFile('voice.mp3')}
          volume={1}
          trimBefore={VOICE_OFFSET_SEC < 0 ? Math.round(-VOICE_OFFSET_SEC * FPS) : undefined}
        />
      </Sequence>
    ) : null}
  </AbsoluteFill>
);
