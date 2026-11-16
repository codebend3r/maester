import {
  type AppPath,
  ITEM_TYPES,
  type MatchItemType,
  type TitleRequest,
  isLibraryRequest,
  moviePath,
  showPath,
} from '@raven/core'
import { comingSoonTitlePath } from '@/lib/appPaths'

/** Where a title in a library opens, by its kind. */
const LIBRARY_PATHS = {
  [ITEM_TYPES.movie]: moviePath,
  [ITEM_TYPES.show]: showPath,
} as const satisfies Record<MatchItemType, (itemId: number) => AppPath>

/** Where a request opens: the title in its library once one holds it, else its Coming soon page. */
export const requestPathOf = (request: TitleRequest): AppPath =>
  isLibraryRequest(request)
    ? LIBRARY_PATHS[request.type](request.libraryItemId)
    : comingSoonTitlePath(request)
