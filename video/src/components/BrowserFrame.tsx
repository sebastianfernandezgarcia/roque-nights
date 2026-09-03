import React from 'react';
import {
  BAR_CHIP,
  BAR_CHIP_TEXT,
  BAR_H,
  BAR_TAB_TITLE,
  BAR_URL,
  DOTS,
  DOT_CY,
  TAB,
  URL_FIELD,
  WINDOW_W,
  WINDOW_X,
} from '../browserFrame';
import { C, MONO } from '../theme';
import { HEIGHT } from '../timeline';

/** The bar's ground: a shade above the app's own #05060a so the window edge reads. */
const BAR_BG = '#0b0e15';

const box = (b: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
  position: 'absolute',
  left: b.x,
  top: b.y,
  width: b.w,
  height: b.h,
});

/** A closed padlock, drawn rather than imported so nothing has to load. */
const Lock: React.FC = () => (
  <svg width={11} height={14} viewBox="0 0 11 14" fill="none">
    <path d="M3 6V4a2.5 2.5 0 0 1 5 0v2" stroke={C.faint} strokeWidth={1.2} />
    <rect x={1} y={6} width={9} height={7} stroke={C.faint} strokeWidth={1.2} />
  </svg>
);

/**
 * A minimal, unbranded browser window around the recording.
 *
 * Drawn over the footage — the footage itself is placed and scaled by ClipStage through
 * the same constants (src/browserFrame.ts), so the bar and the page always agree. Only
 * shots of the app get one: the bare-dome shots (cold open, the title's dome bed, the
 * closing dome) and the outro are the piece's own frame, not a page in a browser.
 */
export const BrowserFrame: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: MONO }}>
    {/* the window: bar + page, 1 px edge all the way round */}
    <div
      style={{
        position: 'absolute',
        left: WINDOW_X,
        top: 0,
        width: WINDOW_W,
        height: HEIGHT,
        boxShadow: `inset 0 0 0 1px ${C.edge}`,
      }}
    />

    {/* the bar */}
    <div
      style={{
        position: 'absolute',
        left: WINDOW_X,
        top: 0,
        width: WINDOW_W,
        height: BAR_H,
        backgroundColor: BAR_BG,
        borderBottom: `1px solid ${C.edge}`,
        boxSizing: 'border-box',
      }}
    />

    {DOTS.map((cx) => (
      <div
        key={cx}
        style={{
          position: 'absolute',
          left: cx - 4.5,
          top: DOT_CY - 4.5,
          width: 9,
          height: 9,
          borderRadius: 9,
          backgroundColor: '#232b3a',
        }}
      />
    ))}

    {/* one tab */}
    <div
      style={{
        ...box(TAB),
        backgroundColor: C.panel,
        boxShadow: `inset 0 0 0 1px ${C.edge}`,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        paddingLeft: 14,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: C.amber }} />
      <div style={{ fontSize: 18, fontWeight: 400, color: C.text, whiteSpace: 'nowrap' }}>
        {BAR_TAB_TITLE}
      </div>
    </div>

    {/* the URL field */}
    <div
      style={{
        ...box(URL_FIELD),
        backgroundColor: C.bg,
        boxShadow: `inset 0 0 0 1px ${C.edge}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 15,
        boxSizing: 'border-box',
      }}
    >
      <Lock />
      <div style={{ fontSize: 19, fontWeight: 400, color: '#c3cbdb', whiteSpace: 'nowrap' }}>
        {BAR_URL}
      </div>
    </div>

    {/* what the page exposes */}
    <div
      style={{
        ...box(BAR_CHIP),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        boxShadow: 'inset 0 0 0 1px rgba(255, 180, 84, 0.34)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: C.amber }} />
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: '0.04em',
          color: C.amber,
          whiteSpace: 'nowrap',
        }}
      >
        {BAR_CHIP_TEXT}
      </div>
    </div>
  </div>
);
