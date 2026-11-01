type CouldNotProps = { verb: string; message: string }

export const LIBRARY_ACTIONS_COPY = {
  verbs: {
    quickScan: 'quick scan',
    scanMarkers: 'scan intros and credits',
    cancelQuickScan: 'cancel the quick scan',
    fullScan: 'run a full scan',
    cancelFullScan: 'cancel the full scan',
    updateRatings: 'update ratings',
    cancelRatings: 'cancel the ratings update',
    rematch: 'match again',
    mergeAlbums: 'merge duplicate albums',
  },
  couldNot: ({ verb, message }: CouldNotProps) => `Could not ${verb}: ${message}`,
  cancel: (label: string) => `Cancel ${label.toLowerCase()}`,
  tmdbDown: 'TMDB is not answering, so files cannot be matched right now',
  nothingToMatch: (matchType: string) =>
    `Every file in this library has its ${matchType}, so there is nothing to match again`,
  matchAgainTitle: (matchType: string) =>
    `Search TMDB again for the files no ${matchType} was found for`,
  historyTitle: 'See what has been played in this library, the most recent first',
  matchAgain: 'Match again',
  editTitle: "Change this library's name, folders and settings",
  edit: 'Edit',
  mergeAlbums: 'Merge duplicate albums',
  mergeAlbumsTitle:
    'Look through the whole library and fold albums that are the same release into one: the same MusicBrainz release, or the same title, year and track count under an artist in common',
  albumsMerged: (count: number) =>
    count === 0
      ? 'No duplicate albums found.'
      : `Merged ${count} duplicate ${count === 1 ? 'album' : 'albums'}.`,
  scanMarkers: 'Scan intros and credits',
  markersQueued: 'Intro and credits scan queued.',
  quickScan: 'Quick scan',
  quickScanTitle:
    'Look only for videos added since the last scan and add them, then fetch their ratings once they are matched',
  cancelQuickScanTitle: 'Stop the quick scan, and the ratings that would follow it',
  fullScan: 'Full scan',
  fullScanTitle:
    'Read every file in the library again, picking up new, renamed, moved and replaced videos',
  cancelFullScanTitle: 'Stop the full scan at its next step; the library keeps what was indexed',
  updateRatings: 'Update ratings',
  updateRatingsTitle:
    'Find the movies and shows with no rating and fetch their ratings; needs a ratings source (TMDB, OMDb or MDBList)',
  cancelRatingsTitle:
    'Stop updating ratings: the titles still waiting are not asked for, and the ratings already fetched stay',
} as const
