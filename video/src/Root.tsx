import React from 'react';
import { Composition, Still } from 'remotion';
import { RoqueNightsPromo } from './RoqueNightsPromo';
import { Thumbnail } from './Thumbnail';
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from './timeline';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RoqueNightsPromo"
      component={RoqueNightsPromo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
  </>
);
