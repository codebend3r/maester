/** How much of a title was watched, as a ready download says it. */
export const watchedLabel = (watched: number | null): string =>
  watched === null ? 'Not started' : `${Math.round(watched * 100)}% watched`
