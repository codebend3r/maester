import { REPEAT_MODES } from '@raven/core'
export const NOW_PLAYING_COPY = {
  moveUp: 'Move up',
  removeFromQueue: 'Remove from queue',
  title: 'Now playing',
  empty: 'Nothing is playing. Open an album and press Play, or add tracks to the queue.',
  position: 'Position',
  shuffleOn: 'Shuffle on',
  shuffleOff: 'Shuffle off',
  previousTrack: 'Previous track',
  nextTrack: 'Next track',
  repeatOne: '1',
  clear: 'Clear',
  queue: 'Queue',
  previousChapter: 'Previous chapter',
  nextChapter: 'Next chapter',
  speed: 'Speed',
  speedOption: (speed: number) => `${speed}×`,
  chapters: 'Chapters',
  lyrics: 'Lyrics',
  instrumental: '♪',
  noLyrics: 'No lyrics for this track.',
  findingLyrics: 'Looking for lyrics…',
  lyricsFailed: 'Could not read the lyrics.',
  noChapters: 'This book names no chapters.',
  chapter: (number: number) => `Chapter ${number}`,
} as const

/** What the repeat button says in each of its modes. */
export const REPEAT_COPY = {
  [REPEAT_MODES.off]: 'Repeat off',
  [REPEAT_MODES.all]: 'Repeat all',
  [REPEAT_MODES.one]: 'Repeat one',
} as const
