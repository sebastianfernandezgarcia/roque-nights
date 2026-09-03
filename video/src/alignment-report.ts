/** `npm run alignment` — prints the solved edit so the numbers can be checked by eye. */
import { CALLOUTS, overlapsOverTwo, span } from './callouts';
import { SUBTITLE_REPORT } from './subtitles';
import { ALIGNMENT_REPORT } from './timeline';

const f2 = (n: number) => n.toFixed(2).padStart(7);

const CALLOUT_REPORT = (): string => {
  const lines = [`callouts: ${CALLOUTS.length}`];
  for (const c of CALLOUTS) {
    const [a, b] = span(c);
    lines.push(
      `   ${f2(a)} → ${f2(b)}  ${c.color.padEnd(5)} ${c.kind.padEnd(6)} ${c.id.padEnd(15)} ` +
        `${(c.label ?? '—').replace(/\n/g, ' / ').padEnd(46)} ${c.why}`,
    );
  }
  const bad = overlapsOverTwo();
  lines.push(
    bad.length === 0
      ? '   never more than two on screen ✓'
      : `   THREE OR MORE ON SCREEN:\n${bad.map((b) => `      ${b}`).join('\n')}`,
  );
  return lines.join('\n');
};

// eslint-disable-next-line no-console
console.log(`${ALIGNMENT_REPORT()}\n\n${SUBTITLE_REPORT()}\n\n${CALLOUT_REPORT()}`);
