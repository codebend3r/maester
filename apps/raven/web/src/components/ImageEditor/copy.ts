type ImageSizeProps = { width: number; height: number }

type OptionLabelProps = { kind: string; description: string }

export const IMAGE_EDITOR_COPY = {
  kinds: {
    poster: 'Poster',
    backdrop: 'Backdrop',
    logo: 'Logo',
  },
  besideFiles: 'Beside the files',
  size: ({ width, height }: ImageSizeProps) => `${width} by ${height}`,
  noText: 'No text',
  noOptions: (kind: string) => `No ${kind}s to choose from.`,
  optionLabel: ({ kind, description }: OptionLabelProps) => `${kind}: ${description}`,
  picturesFor: 'Pictures for',
  library: (id: number) => `Library ${id}`,
  ownPictures: 'Each library chooses its own; the others keep the pictures they show.',
  thisFile: 'This file',
  linkedFiles: 'Linked files',
  thisFileHint:
    'The pictures below are this library’s, so a second version of it here would share them.',
  linkedFilesHint:
    'These files are the same movie in this library and share the pictures below; each plays on its own.',
  standardEdition: 'Standard',
  couldNotChange: (message: string) => `Could not change the picture: ${message}`,
  asking: 'Asking TMDB for pictures',
  pictures: 'Pictures',
  done: 'Done',
  noLibrary: 'No library you can see holds this title, so it has no pictures to choose.',
  gathering: 'Gathering the pictures',
} as const
