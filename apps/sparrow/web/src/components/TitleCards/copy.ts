type TitleWithYearProps = { title: string; year: number }

export const TITLE_CARD_COPY = {
  titleWithYear: ({ title, year }: TitleWithYearProps) => `${title} (${year})`,
  open: (name: string) => `Open ${name}`,
} as const

export const TITLE_CARDS_COPY = {
  label: 'Titles',
} as const
