import type { Credit, ItemSummary, MediaItem, Rating, ScanStatus, ShowEntry } from '@raven/core'

/**
 * Made-up videos for the design page. Negative ids never match a real
 * video, and no thumbnail is ready, so nothing here loads from the server.
 */
const sample = (overrides: Partial<MediaItem> & Pick<MediaItem, 'id' | 'title'>): MediaItem => ({
  libraryId: -1,
  fileName: `${overrides.title}.mkv`,
  folder: '',
  size: 4_200_000_000,
  container: 'mkv',
  duration: 6120,
  width: 1920,
  height: 1080,
  videoCodec: 'hevc',
  videoBitDepth: 10,
  hdr: false,
  audioCodec: 'aac',
  audioChannels: 6,
  bitrate: 5_400_000,
  thumbnail: 'pending',
  thumbnailVersion: 0,
  position: 0,
  favourite: false,
  addedAt: '2026-10-02T12:00:00.000Z',
  match: 'off',
  year: null,
  edition: null,
  item: null,
  versions: 1,
  ...overrides,
})

/** The one shown on its own: 4K HDR, a favourite, partly watched. */
export const FEATURED_SAMPLE: MediaItem = sample({
  id: -1,
  title: 'Weirwood at Night',
  width: 3840,
  height: 2160,
  hdr: true,
  size: 28_400_000_000,
  bitrate: 38_200_000,
  position: 2400,
  favourite: true,
  folder: 'Nature/2026',
})

export const SAMPLE_MEDIA: MediaItem[] = [
  FEATURED_SAMPLE,
  sample({ id: -2, title: 'The Long Winter', videoCodec: 'h264', videoBitDepth: 8 }),
  sample({
    id: -3,
    title: 'Ravens of the North',
    width: 1280,
    height: 720,
    videoCodec: 'av1',
    size: 820_000_000,
    bitrate: 1_900_000,
    duration: 2580,
    addedAt: '2026-09-14T09:00:00.000Z',
  }),
  sample({
    id: -4,
    title: 'An Old Tape',
    container: 'avi',
    width: 720,
    height: 480,
    videoCodec: 'mpeg4',
    videoBitDepth: 8,
    audioCodec: 'mp3',
    audioChannels: 2,
    size: 700_000_000,
    bitrate: 1_100_000,
    duration: 5400,
    addedAt: '2026-09-01T09:00:00.000Z',
  }),
  sample({
    id: -5,
    title: 'Still Probing',
    duration: null,
    width: null,
    height: null,
    videoCodec: null,
    videoBitDepth: null,
    audioCodec: null,
    audioChannels: null,
    bitrate: null,
  }),
]

export const SAMPLE_SCANS: Array<{ label: string; scan: ScanStatus }> = [
  {
    label: 'Scanning',
    scan: {
      state: 'scanning',
      discovered: 1240,
      processed: 812,
      startedAt: '2026-10-09T12:00:00.000Z',
      finishedAt: null,
      error: null,
    },
  },
  {
    label: 'Done',
    scan: {
      state: 'idle',
      discovered: 1240,
      processed: 1240,
      startedAt: '2026-10-09T12:00:00.000Z',
      finishedAt: new Date().toISOString(),
      error: null,
    },
  },
  {
    label: 'Failed',
    scan: {
      state: 'idle',
      discovered: 0,
      processed: 0,
      startedAt: '2026-10-09T12:00:00.000Z',
      finishedAt: '2026-10-09T12:00:01.000Z',
      error: 'Could not read /media/movies.',
    },
  },
]

/** A made-up movie for the poster and page specimens; no poster, so nothing loads. */
const sampleMovie = (
  overrides: Partial<ItemSummary> & Pick<ItemSummary, 'id' | 'title'>,
): ItemSummary => ({
  type: 'movie',
  year: 2026,
  show: null,
  season: null,
  episode: null,
  posterVersion: null,
  ...overrides,
})

/** A Movies library's cards: matched, kept twice, and one nothing matched. */
export const SAMPLE_MOVIES: MediaItem[] = [
  sample({
    id: -11,
    title: 'Weirwood at Night',
    year: 2026,
    match: 'matched',
    item: sampleMovie({ id: -11, title: 'Weirwood at Night' }),
    position: 2400,
    favourite: true,
  }),
  sample({
    id: -12,
    title: 'The Long Winter',
    year: 2019,
    match: 'matched',
    item: sampleMovie({ id: -12, title: 'The Long Winter', year: 2019 }),
    versions: 2,
  }),
  sample({ id: -13, title: 'Ravens of the North', year: 2024, match: 'unmatched' }),
]

/** A TV library's cards: one still airing with an episode to watch next, one ended and all watched. */
export const SAMPLE_SHOWS: ShowEntry[] = [
  {
    show: { ...sampleMovie({ id: -21, title: 'The Long Winter' }), type: 'show', year: 2019 },
    episodes: 18,
    endedYear: null,
    addedAt: '2026-10-02T12:00:00.000Z',
    next: sample({
      id: -22,
      title: 'The Long Winter - S02E03 - Thaw',
      match: 'matched',
      item: {
        ...sampleMovie({ id: -23, title: 'Thaw' }),
        type: 'episode',
        show: { id: -21, title: 'The Long Winter' },
        season: 2,
        episode: 3,
      },
    }),
  },
  {
    show: { ...sampleMovie({ id: -24, title: 'Ravens of the North' }), type: 'show', year: 2014 },
    episodes: 10,
    endedYear: 2016,
    addedAt: '2026-09-14T09:00:00.000Z',
    next: null,
  },
]

export const SAMPLE_RATINGS: Rating[] = [
  { source: 'tmdb', kind: 'audience', value: 7.8, votes: 1840 },
]

export const SAMPLE_CREDITS: Credit[] = [
  { personId: -1, name: 'Arya Hollow', job: 'cast', role: 'The Watcher', photoVersion: null },
  { personId: -2, name: 'Bran Stone', job: 'cast', role: 'Old Nan', photoVersion: null },
  { personId: -3, name: 'Mark Kimball', job: 'cast', role: 'Ferryman', photoVersion: null },
  { personId: -3, name: 'Mark Kimball', job: 'director', role: 'Director', photoVersion: null },
  { personId: -4, name: 'Jeyne Pool', job: 'writer', role: 'Screenplay', photoVersion: null },
  { personId: -5, name: 'Osha Vale', job: 'producer', role: 'Producer', photoVersion: null },
]
