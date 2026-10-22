/** How much of a title was watched, as recents and a ready download say it. */
export const watchedLabel = (watched: number | null): string =>
  watched === null ? 'Not started' : `${Math.round(watched * 100)}% watched`
