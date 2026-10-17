export const playerQueryKeys = {
  mediaTracks: (id: number) => ['media', id, 'tracks'],
  mediaStreams: (id: number) => ['media', id, 'streams'],
  subtitles: ({ id, trackId, window }: { id: number; trackId: string; window: number }) => [
    'media',
    id,
    'subtitles',
    trackId,
    window,
  ],
  /** How the server plays video, for every viewer. */
  playbackSettings: ['settings', 'playback'],
}
