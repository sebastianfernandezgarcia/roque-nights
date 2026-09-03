import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { CALLOUTS, DRAW_SEC, FADE_SEC, type Callout, type LabelSide } from '../callouts';
import { type Box, toScreenBox, toScreenLen } from '../browserFrame';
import { PILLS } from '../subtitles';
import { C, MONO } from '../theme';
import { FPS, HEIGHT, WIDTH } from '../timeline';

/** Stroke weights: a human mark is heavier than an agent mark. */
const HUMAN_STROKE = 3;
const AGENT_STROKE = 2;
/** Corner ticks on a human rect. */
const TICK = 10;
/** Gap between a shape and its label pill, and between the pill and the frame edge. */
const LABEL_GAP = 16;
const EDGE_MARGIN = 24;

const LABEL_SIZE = 22;
const LABEL_PAD_X = 14;
const LABEL_PAD_Y = 9;
const LABEL_TRACKING = 0.12;
/** IBM Plex Mono advances 0.6 em per glyph; the tracking adds 0.12 em to each. */
const CHAR_EM = 0.6 + LABEL_TRACKING;

const hue = (c: Callout): string => (c.color === 'amber' ? C.amber : C.red);

/** The shape's bounding box on screen, whatever kind it is. */
const screenBox = (c: Callout): Box => {
  if (c.space === 'screen') {
    return c.kind === 'rect'
      ? { x: c.x, y: c.y, w: c.w, h: c.h ?? c.w }
      : { x: c.x - c.w / 2, y: c.y - c.w / 2, w: c.w, h: c.w };
  }
  if (c.kind === 'rect') return toScreenBox({ x: c.x, y: c.y, w: c.w, h: c.h ?? c.w });
  const d = toScreenLen(c.w);
  const p = toScreenBox({ x: c.x, y: c.y, w: 0, h: 0 });
  return { x: p.x - d / 2, y: p.y - d / 2, w: d, h: d };
};

const linesOf = (label: string): string[] => label.split('\n');

const pillSize = (label: string, size: number): { w: number; h: number } => {
  const lines = linesOf(label);
  const chars = Math.max(...lines.map((l) => l.length));
  return {
    w: chars * CHAR_EM * size + LABEL_PAD_X * 2,
    h: lines.length * size * 1.25 + LABEL_PAD_Y * 2,
  };
};

/** Where the subtitle pill is at second `t`, or null. Callout labels stay off it. */
const subtitleBox = (t: number): Box | null => {
  const pill = PILLS.find((p) => t >= p.startSec - 0.3 && t <= p.endSec + 0.3);
  if (!pill) return null;
  const chars = Math.max(...pill.lines.map((l) => l.length));
  const w = Math.min(1400, chars * 36 * 0.6 + 60);
  const h = pill.lines.length * 36 * 1.3 + 28;
  return { x: (WIDTH - w) / 2, y: HEIGHT - 150 - h, w, h };
};

const hits = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const place = (box: Box, pill: { w: number; h: number }, side: LabelSide): Box => {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (side) {
    case 'right':
      return { x: box.x + box.w + LABEL_GAP, y: cy - pill.h / 2, ...pill };
    case 'left':
      return { x: box.x - LABEL_GAP - pill.w, y: cy - pill.h / 2, ...pill };
    case 'above':
      return { x: cx - pill.w / 2, y: box.y - LABEL_GAP - pill.h, ...pill };
    case 'below':
      return { x: cx - pill.w / 2, y: box.y + box.h + LABEL_GAP, ...pill };
  }
};

const clamp = (b: Box): Box => ({
  ...b,
  x: Math.min(Math.max(b.x, EDGE_MARGIN), WIDTH - EDGE_MARGIN - b.w),
  y: Math.min(Math.max(b.y, EDGE_MARGIN), HEIGHT - EDGE_MARGIN - b.h),
});

/**
 * The label pill, and the leader that ties it to the shape.
 *
 * The requested side wins unless the pill would land on the subtitle, in which case it
 * goes above the target instead — the subtitle is the one thing on screen the callouts
 * are never allowed to cover.
 */
const labelLayout = (
  c: Callout,
  box: Box,
): { pill: Box; from: { x: number; y: number }; to: { x: number; y: number } } | null => {
  if (!c.label) return null;
  const size = c.labelSize ?? LABEL_SIZE;
  const dims = pillSize(c.label, size);
  const wanted: LabelSide = c.labelSide ?? 'right';
  const sub = subtitleBox(c.atSec + DRAW_SEC);

  let side = wanted;
  let pill = clamp(place(box, dims, side));
  if (sub && hits(pill, sub) && wanted !== 'above') {
    side = 'above';
    pill = clamp(place(box, dims, side));
  }

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const pcx = pill.x + pill.w / 2;
  const pcy = pill.y + pill.h / 2;
  const from =
    side === 'right'
      ? { x: pill.x, y: pcy }
      : side === 'left'
        ? { x: pill.x + pill.w, y: pcy }
        : side === 'above'
          ? { x: pcx, y: pill.y + pill.h }
          : { x: pcx, y: pill.y };
  const to =
    side === 'right'
      ? { x: box.x + box.w, y: cy }
      : side === 'left'
        ? { x: box.x, y: cy }
        : side === 'above'
          ? { x: cx, y: box.y }
          : { x: cx, y: box.y + box.h };
  return { pill, from, to };
};

const Ticks: React.FC<{ readonly box: Box; readonly color: string; readonly o: number }> = ({
  box,
  color,
  o,
}) => {
  const { x, y, w, h } = box;
  const d = [
    `M${x} ${y + TICK} L${x} ${y} L${x + TICK} ${y}`,
    `M${x + w - TICK} ${y} L${x + w} ${y} L${x + w} ${y + TICK}`,
    `M${x + w} ${y + h - TICK} L${x + w} ${y + h} L${x + w - TICK} ${y + h}`,
    `M${x + TICK} ${y + h} L${x} ${y + h} L${x} ${y + h - TICK}`,
  ].join(' ');
  return <path d={d} stroke={color} strokeWidth={HUMAN_STROKE} fill="none" opacity={o} />;
};

const Body: React.FC<{ readonly c: Callout }> = ({ c }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const color = hue(c);
  const box = screenBox(c);
  const fadeSec = c.fadeSec ?? FADE_SEC;
  const total = DRAW_SEC + c.holdSec + fadeSec;

  // draws itself, holds, fades
  const draw = interpolate(t, [0, DRAW_SEC], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const opacity = interpolate(t, [0, DRAW_SEC * 0.6, total - fadeSec, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // a circle keeps breathing once it is drawn
  const breathe =
    c.kind === 'circle' ? 1 + 0.035 * draw * Math.sin((t - DRAW_SEC) * Math.PI * 2 * 1.1) : 1;

  const stroke = c.color === 'amber' ? HUMAN_STROKE : AGENT_STROKE;
  const label = labelLayout(c, box);
  const size = c.labelSize ?? LABEL_SIZE;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', left: 0, top: 0 }}>
        {c.kind === 'rect' ? (
          <>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={c.color === 'amber' ? 0 : 6}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
            {c.color === 'amber' ? <Ticks box={box} color={color} o={draw} /> : null}
          </>
        ) : null}

        {c.kind === 'circle' || c.kind === 'point' ? (
          <g
            transform={`translate(${box.x + box.w / 2} ${box.y + box.h / 2}) scale(${breathe}) translate(${-(box.x + box.w / 2)} ${-(box.y + box.h / 2)})`}
          >
            <circle
              cx={box.x + box.w / 2}
              cy={box.y + box.h / 2}
              r={box.w / 2}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
              transform={`rotate(-90 ${box.x + box.w / 2} ${box.y + box.h / 2})`}
            />
            {c.kind === 'point' ? (
              <circle
                cx={box.x + box.w / 2}
                cy={box.y + box.h / 2}
                r={4}
                fill={color}
                opacity={draw}
              />
            ) : null}
          </g>
        ) : null}

        {label ? (
          <line
            x1={label.from.x}
            y1={label.from.y}
            x2={label.to.x}
            y2={label.to.y}
            stroke={color}
            strokeWidth={1}
            opacity={0.65 * draw}
          />
        ) : null}
      </svg>

      {label && c.label ? (
        <div
          style={{
            position: 'absolute',
            left: label.pill.x,
            top: label.pill.y,
            width: label.pill.w,
            height: label.pill.h,
            boxSizing: 'border-box',
            padding: `${LABEL_PAD_Y}px ${LABEL_PAD_X}px`,
            backgroundColor: 'rgba(5, 6, 10, 0.9)',
            border: `1px solid ${color}`,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: size,
            lineHeight: 1.25,
            letterSpacing: `${LABEL_TRACKING}em`,
            textTransform: 'uppercase',
            color: C.text,
            whiteSpace: 'pre',
            opacity: interpolate(t, [0, DRAW_SEC * 0.7], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {linesOf(c.label).map((line, i) => (
            <div key={`${line}-${i}`} style={{ marginRight: `-${LABEL_TRACKING}em` }}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Every callout in the piece, on one layer over the whole composition.
 *
 * The data — and the coordinate convention — is src/callouts.ts; the mapping from the
 * recording's pixels to the screen's is src/browserFrame.ts#toScreen. Amber is a thing
 * the human did, red is a thing the agent did, and there are never more than two of
 * them up at once.
 */
export const Callouts: React.FC = () => (
  <>
    {CALLOUTS.map((c) => (
      <Sequence
        key={c.id}
        from={Math.round(c.atSec * FPS)}
        durationInFrames={Math.round((DRAW_SEC + c.holdSec + (c.fadeSec ?? FADE_SEC)) * FPS)}
        layout="none"
        name={`callout · ${c.id}`}
      >
        <Body c={c} />
      </Sequence>
    ))}
  </>
);
