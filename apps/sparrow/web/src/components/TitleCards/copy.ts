type OpenProps = { title: string; copy: string }

export const TITLE_CARD_COPY = {
  open: ({ title, copy }: OpenProps) => `Open ${title}: ${copy}`,
  separator: ' · ',
} as const

export const TITLE_CARDS_COPY = {
  label: 'Titles',
} as const
