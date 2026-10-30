export const ALBUM_COPY = {
  noun: 'album',
  eyebrow: 'Album',
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  addTrackToPlaylist: (title: string) => `Add ${title} to a playlist`,
  match: 'Match',
  disc: (disc: number) => `Disc ${disc}`,
  discTracks: (disc: number) => `Disc ${disc} tracks`,
  tracks: 'Tracks',
} as const
