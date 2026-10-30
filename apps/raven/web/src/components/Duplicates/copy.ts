export const DUPLICATES_COPY = {
  standardCut: 'Standard',
  deleteFile: (fileName: string) => `Delete ${fileName}`,
  files: 'Files',
  splitApart: 'Split apart',
  smartSplit: 'Smart split apart',
  smartSplitHint:
    'Smart split apart gives each cut its own card and keeps copies of one cut together.',
  sameCutHint: 'Every file reads as the same cut, so Smart split apart has nothing to tell apart.',
  fileWords: { one: 'file', many: 'files' },
  cardWords: { one: 'card', many: 'cards' },
  cards: 'Cards',
  putBack: 'Put back together',
  putBackHint: 'Its files go back on one card.',
  movies: 'Movies with more than one file',
} as const
