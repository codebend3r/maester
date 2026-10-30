export const ARTIST_COPY = {
  noun: 'artist',
  eyebrow: 'Artist',
  appearsOn: 'Appears on',
  empty: (name: string) => `No albums of ${name}'s are in a library you can see.`,
} as const
