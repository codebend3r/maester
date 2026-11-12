import {
  type ApiClient,
  ApiError,
  artworkOfMedia,
  DOWNLOAD_MAX_FILES,
  DOWNLOAD_TARGET_KINDS,
  type DownloadArtwork,
  type DownloadFacts,
  type DownloadGroup,
  type DownloadKind,
  type DownloadLibrary,
  type DownloadTarget,
  draftOfItem,
  draftOfMedia,
  draftOfSaga,
  factsOf,
  isLockedError,
  type ItemDetails,
  libraryOf,
  type MediaItem,
  oncePerFile,
  seasonIdsOf,
  type TitleDraft,
  type TitleEntry,
  titleItemIdOf,
} from '@raven/core'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import { HTTP } from '@/browserDownloads/outcomes'

/** The server calls an expansion makes, so a test answers them from a table. */
export type ExpandApi = Pick<ApiClient, 'getMedia' | 'getItem' | 'listSagas' | 'getLibrary'>

export type ExpandedFile = {
  media: MediaItem
  label: string
  group: DownloadGroup
  artwork: DownloadArtwork
  library: DownloadLibrary
  /** The item whose poster and title art the file wears, its show's for an episode; null for none. */
  titleItemId: number | null
  facts: DownloadFacts
}

export const EXPAND_REASONS = { locked: 'locked', refused: 'refused' } as const

export type Expansion =
  | { ok: true; kind: DownloadKind; title: string; files: ExpandedFile[] }
  | { ok: false; reason: (typeof EXPAND_REASONS)[keyof typeof EXPAND_REASONS]; message: string }

type ItemDraftProps = { api: ExpandApi; details: ItemDetails }

/** An item's title, a show's seasons read one after another, each for its episodes. */
const draftOfDetails = async ({ api, details }: ItemDraftProps): Promise<TitleDraft | null> => {
  const seasons = await seasonIdsOf(details).reduce<Promise<ItemDetails[]>>(
    async (previous, itemId) => [...(await previous), await api.getItem(itemId)],
    Promise.resolve([]),
  )
  return draftOfItem({ details, seasons })
}

type DraftOfProps = { api: ExpandApi; target: DownloadTarget }

/** The title a target names, as core files it, or null when the server has none of it left. */
const draftOf = async ({ api, target }: DraftOfProps): Promise<TitleDraft | null> => {
  switch (target.kind) {
    case DOWNLOAD_TARGET_KINDS.media:
      return draftOfMedia(await api.getMedia(target.mediaId))
    case DOWNLOAD_TARGET_KINDS.item:
      return draftOfDetails({ api, details: await api.getItem(target.itemId) })
    case DOWNLOAD_TARGET_KINDS.saga: {
      const sagas = await api.listSagas(target.libraryId)
      const saga = sagas.find(({ tmdbId }) => tmdbId === target.tmdbId)
      return saga === undefined ? null : draftOfSaga({ saga, libraryId: target.libraryId })
    }
    // Music stays Raven's for now: the browser offers no Download on an album or a playlist.
    case DOWNLOAD_TARGET_KINDS.album:
    case DOWNLOAD_TARGET_KINDS.playlist:
      return null
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

const refusal = (message: string): Expansion => ({
  ok: false,
  reason: EXPAND_REASONS.refused,
  message,
})

/** Why the server would not list a title: its PIN, the account, a title that is gone, or no answer. */
const failureOf = (error: unknown): Expansion => {
  if (isLockedError(error)) {
    return { ok: false, reason: EXPAND_REASONS.locked, message: BROWSER_DOWNLOAD_COPY.locked }
  }
  if (!(error instanceof ApiError)) return refusal(BROWSER_DOWNLOAD_COPY.unreachable)
  if (error.status === HTTP.notFound) return refusal(BROWSER_DOWNLOAD_COPY.gone)
  const isAccount = error.status === HTTP.unauthorized || error.status === HTTP.forbidden
  return refusal(isAccount ? BROWSER_DOWNLOAD_COPY.account : BROWSER_DOWNLOAD_COPY.unreachable)
}

type ExpandTargetProps = {
  api: ExpandApi
  target: DownloadTarget
  /** Whether a file is already downloaded or on its way, so it is not asked for twice. */
  shouldSkip: (mediaId: number) => boolean
}

type FilesOfProps = { api: ExpandApi; draft: TitleDraft; kept: readonly TitleEntry[] }

/** Each library is read once, however many files it holds. */
const filesOf = async ({ api, draft, kept }: FilesOfProps): Promise<ExpandedFile[]> => {
  const libraryIds = [...new Set(kept.map(({ media }) => media.libraryId))]
  const libraries = await Promise.all(libraryIds.map((libraryId) => api.getLibrary(libraryId)))
  return kept.flatMap(({ media, label, order }) => {
    const library = libraries.find(({ id }) => id === media.libraryId)
    if (library === undefined) return []
    return [
      {
        media,
        label,
        group: { ...draft.group, order },
        artwork: draft.artwork ?? artworkOfMedia(media),
        library: libraryOf(library),
        titleItemId: titleItemIdOf(media),
        facts: factsOf(media),
      },
    ]
  })
}

/**
 * Turns a Download button's target into the video files to fetch. The title is filed by core's
 * `downloadTitles`, as Raven's main files it, read here through the page's own API client.
 */
export const expandTarget = async ({
  api,
  target,
  shouldSkip,
}: ExpandTargetProps): Promise<Expansion> => {
  try {
    const draft = await draftOf({ api, target })
    if (draft === null) return refusal(BROWSER_DOWNLOAD_COPY.gone)
    const entries = oncePerFile(draft.entries)
    if (entries.length > DOWNLOAD_MAX_FILES) return refusal(BROWSER_DOWNLOAD_COPY.tooMany)
    const kept = entries.filter(({ media }) => !shouldSkip(media.id))
    const files = await filesOf({ api, draft, kept })
    return { ok: true, kind: draft.group.kind, title: draft.title, files }
  } catch (error) {
    return failureOf(error)
  }
}
