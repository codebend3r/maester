export const MEDIA_MENU_COPY = {
  findingFile: 'Finding the file',
  copied: 'Copied',
  copyPath: 'Copy file path',
  removeFavourite: 'Remove favourite',
  markUnwatched: 'Mark as unwatched',
  markWatched: 'Mark as watched',
  refreshDetails: 'Refresh details',
  couldNotRefresh: (message: string) => `Could not refresh: ${message}`,
  options: (label: string) => `Options for ${label}`,
} as const
