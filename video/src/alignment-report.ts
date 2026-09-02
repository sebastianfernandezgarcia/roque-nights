/** `npm run alignment` — prints the solved edit so the numbers can be checked by eye. */
import { SUBTITLE_REPORT } from './subtitles';
import { ALIGNMENT_REPORT } from './timeline';

// eslint-disable-next-line no-console
console.log(`${ALIGNMENT_REPORT()}\n\n${SUBTITLE_REPORT()}`);
