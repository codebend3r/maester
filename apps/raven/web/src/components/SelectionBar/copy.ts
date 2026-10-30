type MarkedProps = { count: number; watched: boolean }

export const SELECTION_BAR_COPY = {
  label: 'Selection',
  selected: (count: number) => `${count} selected`,
  pause: '. ',
  marked: ({ count, watched }: MarkedProps) =>
    `Marked ${count} ${watched ? 'watched' : 'unwatched'}`,
  failed: 'Could not mark. Try again.',
  selectAll: 'Select all',
  markWatched: 'Mark watched',
  markUnwatched: 'Mark unwatched',
  clear: 'Clear',
  done: 'Done',
} as const
