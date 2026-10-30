type WatchedOfProps = { watched: number; total: number }

export const SAGA_COPY = {
  noun: 'saga',
  sagas: 'Sagas',
  saga: 'Saga',
  watchedOf: ({ watched, total }: WatchedOfProps) => `${watched} of ${total} watched`,
  editBackdrop: 'Edit backdrop',
  playAll: 'Play all',
  releaseOrder: 'Release order',
  inOrder: 'In order',
  upNext: 'Up next',
  versions: (count: number) => `${count} versions`,
  play: (title: string) => `Play ${title}`,
  motions: {
    fade: { label: 'Crossfade', hint: 'Each picture fades into the next.' },
    kenBurns: { label: 'Ken Burns', hint: 'A slow zoom across each picture as it fades in.' },
    slide: { label: 'Slide', hint: 'Each picture slides in and pushes the last one out.' },
    off: { label: 'Off', hint: "One movie's backdrop, held still." },
  },
  slideshow: 'Slideshow',
  slideshowHint: "Behind the title, each movie's backdrop in turn, first to last and round again.",
  picture: 'Picture',
  saveFailed: (reason: string) => `Could not save the backdrop: ${reason}`,
  save: 'Save',
} as const
