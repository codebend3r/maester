type EditionTitleProps = { title: string; edition: string }

export const METADATA_EDITOR_COPY = {
  fields: {
    contentRating: 'Content rating',
    tagline: 'Tagline',
    summary: 'Summary',
  },
  hint: 'Only the title and year can be changed. What is written there shows instead of TMDB’s words, and an emptied year shows nothing; TMDB’s stay underneath and come back with Use TMDB’s. A refresh never touches an edit.',
  couldNotSave: (message: string) => `Could not save: ${message}`,
  addEdition: (edition: string) => `Add the edition from the file name: ${edition}`,
  editionTitle: ({ title, edition }: EditionTitleProps) => `${title} (${edition})`,
  titleItAs: (title: string) => `Title it “${title}”, as the file name says`,
  tmdb: (text: string) => `TMDB: ${text}`,
  nothing: 'nothing',
  takeTmdbs: 'Use TMDB’s',
  save: 'Save',
  reading: 'Reading what TMDB says',
} as const
