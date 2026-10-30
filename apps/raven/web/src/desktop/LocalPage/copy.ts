export const LOCAL_PAGE_COPY = {
  noRecents: 'Raven could not list your recent videos.',
  recentsCleared: 'Recents cleared.',
  title: (computer: string) => `On this ${computer}`,
  hint: 'Play a video file from this computer in Raven.',
  dropToPlay: 'Drop to play',
  dropAnywhere: 'Drop a video anywhere in this window',
  chooseVideo: 'Choose a video',
  recent: 'Recent',
  clearRecents: 'Clear recents',
  nothingOpened: 'Nothing opened yet.',
  removeRecent: (label: string) => `Remove ${label} from recents`,
} as const
