import { RATING_SOURCES, type Rating, type RatingSource } from '@raven/core'
import { TABLE_SORT_DIRECTIONS, type SortColumn } from '@/lib/tableSort'
import { RatingBadge } from '@/components/RatingPanel/RatingPanel'
import { COMMON_COPY } from '@/lib/copy'

/** A table's score columns, in the order it shows them, each headed by its source's short name. */
export const RATING_COLUMNS = [
  { source: RATING_SOURCES.rottenTomatoes, label: COMMON_COPY.rottenTomatoes },
  { source: RATING_SOURCES.imdb, label: COMMON_COPY.imdb },
  { source: RATING_SOURCES.metacritic, label: COMMON_COPY.metacritic },
  { source: RATING_SOURCES.tmdb, label: COMMON_COPY.tmdb },
] as const satisfies readonly { source: RatingSource; label: string }[]

type RatingOfProps = { ratings: readonly Rating[]; source: RatingSource }

const ratingOf = ({ ratings, source }: RatingOfProps): Rating | null =>
  ratings.find((rating) => rating.source === source) ?? null

type RatingSortColumnsProps<T> = {
  /** A row's scores; a row with none of a source sorts as having no value. */
  ratingsOf: (row: T) => readonly Rating[]
}

/** Each score's sort column, highest first on the first click. */
export const ratingSortColumns = <T,>({
  ratingsOf,
}: RatingSortColumnsProps<T>): Record<RatingSource, SortColumn<T>> => {
  const scoreColumn = (source: RatingSource): SortColumn<T> => ({
    value: (row) => ratingOf({ ratings: ratingsOf(row), source })?.value ?? null,
    first: TABLE_SORT_DIRECTIONS.desc,
  })
  return {
    [RATING_SOURCES.rottenTomatoes]: scoreColumn(RATING_SOURCES.rottenTomatoes),
    [RATING_SOURCES.imdb]: scoreColumn(RATING_SOURCES.imdb),
    [RATING_SOURCES.metacritic]: scoreColumn(RATING_SOURCES.metacritic),
    [RATING_SOURCES.tmdb]: scoreColumn(RATING_SOURCES.tmdb),
  }
}

type RatingCellsProps = { ratings: readonly Rating[]; className: string }

/** A row's score cells, one under each of `RATING_COLUMNS`, empty where the source gave none. */
export const RatingCells = ({ ratings, className }: RatingCellsProps) =>
  RATING_COLUMNS.map(({ source }) => {
    const rating = ratingOf({ ratings, source })
    return (
      <td key={source} className={className}>
        {rating && <RatingBadge rating={rating} isBare />}
      </td>
    )
  })
