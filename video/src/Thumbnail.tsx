import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from 'remotion';
import manifest from './manifest.json';
import { FACTS } from './log';
import { C, MONO, VIGNETTE } from './theme';
import { FPS } from './timeline';

/** 1280x720 still: the dome, the wordmark, and the one claim that matters. */
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: MONO }}>
    {/* push into the sky map so the thumbnail reads as a dome, not as a screenshot */}
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: 'scale(1.55)', transformOrigin: '36% 49%' }}>
        {manifest.hasDomeStill ? (
          <Img
            src={staticFile('dome-still.jpg')}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <OffthreadVideo
            src={staticFile('clips/06-dome.mp4')}
            trimBefore={6 * FPS}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
    <AbsoluteFill style={{ backgroundColor: 'rgba(5, 6, 10, 0.35)' }} />
    <AbsoluteFill style={{ background: VIGNETTE }} />

    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}
    >
      <div
        style={{
          fontSize: 110,
          fontWeight: 700,
          color: C.amber,
          letterSpacing: '0.1em',
          marginRight: '-0.1em',
          lineHeight: 1,
        }}
      >
        ROQUE NIGHTS
      </div>
      <div style={{ height: 26 }} />
      <div
        style={{
          fontSize: 40,
          fontWeight: 400,
          color: C.text,
          letterSpacing: '0.05em',
        }}
      >
        Plan the sky with your agent
      </div>
    </AbsoluteFill>

    <div
      style={{
        position: 'absolute',
        left: 56,
        top: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingRight: 18,
        paddingLeft: 14,
        height: 42,
        backgroundColor: C.panel,
        border: `1px solid ${C.edge}`,
        borderLeft: `4px solid ${C.red}`,
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: C.amber,
        }}
      >
        WebMCP · {FACTS.toolsRegistered} tools
      </div>
    </div>

    <div
      style={{
        position: 'absolute',
        right: 56,
        bottom: 46,
        fontSize: 22,
        fontWeight: 400,
        letterSpacing: '0.08em',
        color: C.faint,
      }}
    >
      roque-nights.netlify.app
    </div>
  </AbsoluteFill>
);
