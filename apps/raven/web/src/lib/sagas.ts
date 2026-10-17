import { type Saga, type WatchTarget, formatRuntime } from '@raven/core'

const count = new Intl.NumberFormat()

/** ["3 movies", "2002 to 2026"]: how many of the saga are here, and the years they span. */
export const sagaFacts = (saga: Saga): string[] => {
  const years = saga.media.flatMap((media) => media.item?.year ?? [])
  const first = Math.min(...years)
  const last = Math.max(...years)
  const span = years.length === 0 ? [] : [first === last ? String(first) : `${first} to ${last}`]
  return [`${count.format(saga.media.length)} movies`, ...span]
}

/**
 * "20h 14m in all": the saga watched end to end, by the length of each
 * movie's file shown; null until any of them has been probed.
 */
export const sagaRuntime = (saga: Saga): string | null => {
  const total = formatRuntime(saga.media.reduce((sum, media) => sum + (media.duration ?? 0), 0))
  return total && `${total} in all`
}

/** A saga's own page, under its library's. */
export const sagaPath = ({ libraryId, saga }: { libraryId: number; saga: Saga }): string =>
  `/libraries/${libraryId}/sagas/${encodeURIComponent(saga.tmdbId)}`

/** A saga's movies as targets: each by its item in the saga's library, else its own file. */
export const sagaTargets = ({
  saga,
  libraryId,
}: {
  saga: Saga
  libraryId: number
}): WatchTarget[] =>
  saga.media.map((media) =>
    media.item ? { kind: 'item', id: media.item.id, libraryId } : { kind: 'media', id: media.id },
  )
