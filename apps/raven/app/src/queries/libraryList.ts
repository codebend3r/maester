import { KINDS, type Library, plural } from '@raven/core'

import { LIBRARY_LIST_COPY } from '@/queries/copy'

const count = new Intl.NumberFormat()

/**
 * What a library's card says under its name, as the web's Libraries page says it: its type, a
 * locked one marked, how many videos it holds and how many are not matched yet.
 */
export const libraryLineOf = ({ settings, itemCount, unmatchedCount }: Library): string =>
  [
    KINDS[settings.kind].label,
    ...(settings.locked ? [LIBRARY_LIST_COPY.locked] : []),
    plural({ n: itemCount, ...LIBRARY_LIST_COPY.videos }),
    ...(unmatchedCount > 0 ? [LIBRARY_LIST_COPY.notMatched(count.format(unmatchedCount))] : []),
  ].join(LIBRARY_LIST_COPY.separator)

/** How many libraries there are and how many videos they hold between them: "3 libraries · 1,204 videos". */
export const librariesSummaryOf = (libraries: readonly Library[]): string =>
  [
    plural({ n: libraries.length, ...LIBRARY_LIST_COPY.libraries }),
    plural({
      n: libraries.reduce((sum, library) => sum + library.itemCount, 0),
      ...LIBRARY_LIST_COPY.videos,
    }),
  ].join(LIBRARY_LIST_COPY.separator)
