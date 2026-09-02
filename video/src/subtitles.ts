/**
 * Burned-in subtitles: the FULL sentences of the voice-over, straight from
 * public/voice.json (absolute composition seconds — the same file the narration audio
 * was laid out against, so a cue can never drift from what is being said).
 *
 * A cue is on screen from `startSec - LEAD` to `endSec + TAIL`, never overlapping the
 * next one. A sentence longer than two lines of ~47 characters is broken at a comma or
 * a clause boundary into consecutive pills that share the sentence's window in
 * proportion to their length, so no pill is ever taller than two lines.
 */
import voiceJson from '../public/voice.json';

export type VoiceCue = {
  id: string;
  scene: string;
  text: string;
  startSec: number;
  endSec: number;
};

export const VOICE_CUES = (voiceJson as unknown as VoiceCue[])
  .slice()
  .sort((a, b) => a.startSec - b.startSec);

/** The pill comes up just before the word and lingers a beat after it. */
const LEAD_SEC = 0.1;
const TAIL_SEC = 0.35;
/** Never let two pills touch. */
const GAP_SEC = 0.05;

/** IBM Plex Mono at 36 px is 21.6 px per glyph: 47 glyphs is 1015 px inside the pill. */
export const MAX_LINE_CHARS = 47;
const MAX_PILL_CHARS = MAX_LINE_CHARS * 2;

const CLAUSE_MARKS = new Set([',', '.', ';', ':', '!', '?']);

/** Break a sentence at its clause marks, keeping the mark on the left-hand piece. */
const clausesOf = (text: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    if (CLAUSE_MARKS.has(text[i]) && text[i + 1] === ' ') {
      parts.push(text.slice(start, i + 1));
      start = i + 2;
    }
  }
  const rest = text.slice(start).trim();
  if (rest.length > 0) parts.push(rest);
  return parts.length > 0 ? parts : [text];
};

/** Two balanced lines, broken at a clause mark when one is near the middle. */
const wrapTwo = (text: string): string[] | null => {
  if (text.length <= MAX_LINE_CHARS) return [text];
  const words = text.split(' ');
  let best: { lines: string[]; score: number } | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length > MAX_LINE_CHARS || b.length > MAX_LINE_CHARS) continue;
    const clauseBreak = CLAUSE_MARKS.has(a[a.length - 1]) ? MAX_LINE_CHARS / 3 : 0;
    const score = Math.abs(a.length - b.length) - clauseBreak;
    if (best === null || score < best.score) best = { lines: [a, b], score };
  }
  return best === null ? null : best.lines;
};

/** Cut `parts` into `k` consecutive groups that each fit a pill; the most even wins. */
const splitInto = (parts: string[], k: number): string[][] | null => {
  if (k > parts.length) return null;
  let best: { groups: string[][]; spread: number } | null = null;

  const walk = (index: number, left: number, acc: string[][]) => {
    if (left === 0) {
      if (index !== parts.length) return;
      const lengths = acc.map((g) => g.join(' ').length);
      const spread = Math.max(...lengths) - Math.min(...lengths);
      if (best === null || spread < best.spread) best = { groups: acc.map((g) => [...g]), spread };
      return;
    }
    for (let end = index + 1; end <= parts.length - (left - 1); end += 1) {
      const group = parts.slice(index, end);
      const text = group.join(' ');
      if (text.length > MAX_PILL_CHARS || wrapTwo(text) === null) continue;
      walk(end, left - 1, [...acc, group]);
    }
  };

  walk(0, k, []);
  return best === null ? null : (best as { groups: string[][] }).groups;
};

const pillsFor = (text: string): string[][] => {
  const parts = clausesOf(text);
  for (let k = 1; k <= parts.length; k += 1) {
    const groups = splitInto(parts, k);
    if (groups) return groups.map((g) => wrapTwo(g.join(' ')) as string[]);
  }
  // no clause boundary works: fall back to a hard word wrap into two-line pills
  const words = text.split(' ');
  const out: string[][] = [];
  let line: string[] = [];
  for (const w of words) {
    if ([...line, w].join(' ').length > MAX_LINE_CHARS) {
      out.push([line.join(' ')]);
      line = [];
    }
    line.push(w);
  }
  if (line.length > 0) out.push([line.join(' ')]);
  return out;
};

export type Pill = {
  /** one or two lines, already wrapped */
  lines: string[];
  startSec: number;
  endSec: number;
  cueId: string;
};

const build = (): Pill[] => {
  const out: Pill[] = [];

  VOICE_CUES.forEach((cue, index) => {
    const next = VOICE_CUES[index + 1];
    const from = Math.max(0, cue.startSec - LEAD_SEC);
    const hardEnd = next ? next.startSec - LEAD_SEC - GAP_SEC : Number.POSITIVE_INFINITY;
    const to = Math.min(cue.endSec + TAIL_SEC, hardEnd);

    const groups = pillsFor(cue.text);
    const weights = groups.map((g) => g.join(' ').length);
    const total = weights.reduce((a, b) => a + b, 0);

    let cursor = from;
    groups.forEach((lines, i) => {
      const share = ((to - from) * weights[i]) / total;
      const end = i === groups.length - 1 ? to : cursor + share;
      out.push({ lines, startSec: cursor, endSec: end, cueId: cue.id });
      cursor = end;
    });
  });

  return out;
};

export const PILLS: Pill[] = build();

/**
 * Tool names inside a subtitle are amber: snake_case identifiers (describe_current_view)
 * and the protocol itself (WebMCP).
 */
export const TOOL_NAME_RE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+|WebMCP)\b/g;

/** Printed by `npm run alignment`. */
export const SUBTITLE_REPORT = (): string => {
  const lines: string[] = [`subtitles: ${PILLS.length} pills from ${VOICE_CUES.length} cues`];
  let widest = 0;
  for (const p of PILLS) {
    widest = Math.max(widest, ...p.lines.map((l) => l.length));
    lines.push(
      `   ${p.startSec.toFixed(2).padStart(7)} → ${p.endSec.toFixed(2).padStart(7)}  ` +
        `[${p.cueId}] ${p.lines.map((l) => `${l} (${l.length})`).join(' / ')}`,
    );
  }
  lines.push(`   widest line ${widest} chars (cap ${MAX_LINE_CHARS})`);
  return lines.join('\n');
};
