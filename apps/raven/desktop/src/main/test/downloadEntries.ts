import {
  EMPTY_DOWNLOADS,
  NO_PENDING,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'

export const SERVER_A = '11111111-1111-4111-8111-111111111111'
export const SERVER_B = '22222222-2222-4222-8222-222222222222'
export const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A queued movie download of `SERVER_A`, with nothing pending; `overrides` sets the rest. */
export const entry = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  downloadId: id(1),
  serverId: SERVER_A,
  mediaId: 1,
  label: 'The Two Towers',
  group: { kind: 'movie', key: 'movie:1', title: 'The Two Towers', order: 0 },
  container: 'mkv',
  size: 1000,
  duration: 200,
  watchedPercent: 90,
  sidecars: [],
  status: { kind: 'queued' },
  autoDelete: false,
  watchedAt: null,
  serverPosition: 0,
  pending: NO_PENDING,
  createdAt: 100,
  track: undefined,
  ...overrides,
})

export const stateOf = (...entries: DownloadEntry[]): DownloadsState => ({
  ...EMPTY_DOWNLOADS,
  entries,
})
