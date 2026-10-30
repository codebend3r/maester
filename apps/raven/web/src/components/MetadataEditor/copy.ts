type EditionTitleProps = { title: string; edition: string }

export const METADATA_EDITOR_COPY = {
  fields: {
    contentRating: 'Content rating',
    tagline: 'Tagline',
    summary: 'Summary',
  },
  hint: 'What is written here shows instead of TMDB’s words, and an emptied box shows nothing; TMDB’s stay underneath and come back with Use TMDB’s. A refresh never touches an edit.',
  couldNotSave: (message: string) => `Could not save: ${message}`,
  addEdition: (edition: string) => `Add the edition from the file name: ${edition}`,
  editionTitle: ({ title, edition }: EditionTitleProps) => `${title} (${edition})`,
  titleItAs: (title: string) => `Title it “${title}”, as the file name says`,
  tmdb: (text: string) => `TMDB: ${text}`,
  nothing: 'nothing',
  useTmdbs: 'Use TMDB’s',
  save: 'Save',
  reading: 'Reading what TMDB says',
} as const
