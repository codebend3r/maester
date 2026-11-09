import { LIBRARY_VIEWS, type Library as LibraryRecord, libraryIconOf, plural } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid } from '@/layouts'
import { sagaSectionsOf } from '@/queries/sagaCards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'
import { LIBRARY_COPY } from '@/screens/copy'
import { type PageFrame, PageTools } from '@/screens/PageTools'

type SagasNoticeOfProps = {
  library: LibraryRecord
  count: number | null
  error: Error | null
}

/** The line in place of the cards: while the sagas are read, when they fail, or when there are none. */
const sagasNoticeOf = ({ library, count, error }: SagasNoticeOfProps): string | null => {
  if (count === null) return error === null ? LIBRARY_COPY.gathering.sagas : error.message
  return count === 0 ? LIBRARY_COPY.sagasEmpty(library.name) : null
}

export type SagasGridProps<P extends string> = {
  session: AppQueries
  library: LibraryRecord
  /** The library's pages, whose toggles and Lock are the toolbar; Sagas adds no button of its own. */
  frame: PageFrame<P>
}

/**
 * A movie library's Sagas page: each TMDB collection of two movies or more as a poster card that
 * opens its own page, under the library's name and the way to its other pages.
 */
export const SagasGrid = <P extends string>({
  session: { server, api, queries },
  library,
  frame,
}: SagasGridProps<P>) => {
  const router = useRouter()
  const pictures = usePictures({ server, api })
  const sagas = useQuery(queries.sagasQuery(library.id))
  const listed = sagas.data ?? null
  const sections =
    pictures === null || listed === null
      ? []
      : sagaSectionsOf({
          sagas: listed,
          libraryId: library.id,
          api,
          headersFor: pictures.headersFor,
        })
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={plural({ n: listed?.length ?? 0, ...LIBRARY_COPY.saga })}
      notice={sagasNoticeOf({
        library,
        count: listed?.length ?? null,
        error: sagas.error,
      })}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      title={library.name}
      toolbar={<PageTools frame={frame} />}
      view={LIBRARY_VIEWS.grid}
    />
  )
}
