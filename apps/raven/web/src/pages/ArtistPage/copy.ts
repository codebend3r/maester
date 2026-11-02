export const ARTIST_COPY = {
  noun: 'artist',
  eyebrow: 'Artist',
  appearsOn: 'Appears on',
  playAlbums: 'Play albums',
  shuffleAlbums: 'Shuffle albums',
  shuffleAppearsOn: 'Shuffle appears on',
  shuffleAll: 'Shuffle all',
  empty: (name: string) => `No albums of ${name}'s are in a library you can see.`,
} as const
