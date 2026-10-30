type PlaceProps = { at: number; count: number }

type AnnouncementProps = { title: string; at: number; count: number }

export const HOME_COPY = {
  emptyShelf: 'Nothing here yet.',
  searchResultsFor: (query: string) => `Search results for ${query}`,
  searching: 'Searching every library',
  noMatches: (query: string) => `Nothing in any library matches "${query}".`,
  gatheringHero: 'Gathering the newest titles',
  gatheringLibraries: 'Gathering your libraries',
  bare: 'Nothing to show yet. Pin a library in its settings and its newest videos show here, and whatever you start watching waits at the top.',
  continueWatching: 'Continue watching',
  timeLeft: (left: string) => `${left} left`,
  playTitle: (title: string) => `Play ${title}`,
  showFewer: 'Show fewer',
  showAll: (count: number) => `Show all ${count}`,
  carousel: 'carousel',
  slide: 'slide',
  featured: 'Featured',
  featuredIn: (library: string) => `Featured in ${library}`,
  details: 'Details',
  previous: 'Previous',
  next: 'Next',
  place: ({ at, count }: PlaceProps) => `${at} of ${count}`,
  counter: ({ at, count }: PlaceProps) => `${at} / ${count}`,
  announcement: ({ title, at, count }: AnnouncementProps) => `${title}, ${at} of ${count}`,
} as const
