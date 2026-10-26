type PlayerQueryKeysSubtitlesProps = { id: number; trackId: string; window: number }

export const playerQueryKeys = {
  mediaTracks: (id: number) => ['media', id, 'tracks'],
  mediaStreams: (id: number) => ['media', id, 'streams'],
  mediaTicket: (id: number) => ['media', id, 'ticket'],
  subtitles: ({ id, trackId, window }: PlayerQueryKeysSubtitlesProps) => [
    'media',
    id,
    'subtitles',
    trackId,
    window,
  ],
  /** How the server plays video, for every viewer. */
  playbackSettings: ['settings', 'playback'],
}
