type ChooseLabelProps = { title: string; artist: string }

export const ALBUM_MATCH_DIALOG_COPY = {
  chooseLabel: ({ title, artist }: ChooseLabelProps) => `Choose ${title} by ${artist}`,
  choose: 'Choose',
  searchLabel: 'Search MusicBrainz',
  searchPlaceholder: 'Search MusicBrainz for other words',
  searching: 'Searching MusicBrainz',
  noResults: 'MusicBrainz lists nothing by that name.',
  releases: 'Releases',
  notOnMusicBrainz: 'Not on MusicBrainz',
} as const
