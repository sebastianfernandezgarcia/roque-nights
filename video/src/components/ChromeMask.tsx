import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C } from '../theme';
import { WIDTH } from '../timeline';

/** Right 30 % of the frame — the app's panel column — plus its header and time bar. */
const RIGHT_FRACTION = 0.3;
const FEATHER = 70;
const TOP_HEIGHT = 58;
const BOTTOM_HEIGHT = 112;

type Props = {
  /** 0 = plate fully covering, 1 = fully retracted */
  readonly right: number;
  readonly top?: number;
  readonly bottom?: number;
};

/**
 * Slides #05060a plates over the app's chrome so a shot can be the bare dome.
 *
 * Used three times: closed under the cold open, retracting under the title (the app
 * reveals itself as the wordmark settles), and closing again over the last shot.
 */
export const ChromeMask: React.FC<Props> = ({ right, top = right, bottom = right }) => {
  const plateWidth = WIDTH * RIGHT_FRACTION;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: TOP_HEIGHT,
          backgroundColor: C.bg,
          transform: `translateY(${-top * TOP_HEIGHT}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: BOTTOM_HEIGHT,
          backgroundColor: C.bg,
          transform: `translateY(${bottom * BOTTOM_HEIGHT}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: plateWidth + FEATHER,
          display: 'flex',
          transform: `translateX(${right * (plateWidth + FEATHER)}px)`,
        }}
      >
        <div
          style={{
            width: FEATHER,
            height: '100%',
            background: `linear-gradient(to right, rgba(5,6,10,0), ${C.bg})`,
          }}
        />
        <div style={{ flex: 1, height: '100%', backgroundColor: C.bg }} />
      </div>
      <AbsoluteFill style={{ boxShadow: `inset 0 0 0 6px ${C.edge}` }} />
    </AbsoluteFill>
  );
};
