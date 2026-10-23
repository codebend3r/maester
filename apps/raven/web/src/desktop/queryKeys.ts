/** The cache keys of what the page reads from Raven rather than its server. */
export const DESKTOP_QUERY_KEYS = {
  downloads: ['desktop', 'downloads'],
  space: ['desktop', 'space'],
  recents: ['desktop', 'recents'],
  updates: ['desktop', 'updates'],
  output: ['desktop', 'output'],
  file: ['desktop', 'file'],
  title: ['desktop', 'title'],
} as const
