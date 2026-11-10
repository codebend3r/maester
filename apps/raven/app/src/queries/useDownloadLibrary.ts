import { useQuery } from '@tanstack/react-query'

import type { DownloadLibrary } from '@/downloads/downloadEntries'
import { downloadLibraryOf } from '@/downloads/downloadRequests'
import type { AppQueries } from '@/queries/useAppQueries'

type UseDownloadLibraryProps = {
  session: AppQueries
  /** The library the downloads are filed under; null when nothing names one. */
  libraryId: number | null
}

/**
 * The library a page's or a card menu's downloads are filed under, as the server lists it now:
 * null until the libraries are read, or for one not known here.
 */
export const useDownloadLibrary = ({
  session,
  libraryId,
}: UseDownloadLibraryProps): DownloadLibrary | null => {
  const libraries = useQuery(session.queries.librariesQuery)
  return downloadLibraryOf({ libraries: libraries.data ?? [], libraryId })
}
