type NeighbourLabelProps = { direction: string; title: string }

export const PLAYABLE_ITEM_VIEW_COPY = {
  guestStars: 'Guest stars & crew',
  neighbours: 'Episodes either side',
  previous: 'Previous',
  next: 'Next',
  timeLeft: (left: string) => `${left} left`,
  playTitle: (title: string) => `Play ${title}`,
  resumeFrom: (position: string) => `Resume from ${position}`,
  neighbourLabel: ({ direction, title }: NeighbourLabelProps) => `${direction}: ${title}`,
} as const
