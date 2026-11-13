import {
  fillPath,
  type Guard,
  isAlbumDetails,
  isItemDetails,
  isLibrary,
  isMediaItem,
  isMusicGroup,
  isOpaqueId,
  ITEM_IMAGE_KINDS,
  type ItemImageKind,
  type Library,
  libraryOf,
  PICTURE_PARAMS,
  PICTURE_PATHS,
  titleItemIdOf,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  type DownloadEntry,
  type EntryPictures,
  isPictureExtension,
  isPictureFolder,
  PICTURE_EXTENSIONS,
  PICTURE_OWNERS,
  type PictureExtension,
  type PictureOwner,
  type SavedPicture,
  setLibrary,
  setPictures,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { DOWNLOAD_STALL_MS, type StreamFetch } from '@/main/downloads/fetchFile'
import {
  downloadsDirFor,
  pictureFolderFor,
  picturePathFor,
  picturesDirFor,
} from '@/main/downloads/space'
import { removeFolder } from '@/main/downloads/sweep'
import { errorText } from '@/main/log/errorText'
import { parseJson } from '@/main/parseJson'
import { type AllowedCall, CALL_NAMES } from '@/main/servers/allowlist'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/timers'
import { HEADERS, HTTP_STATUSES, isSuccessStatus } from '@shared/http'

/** The most of a picture kept; a larger one is skipped rather than read whole into memory. */
export const PICTURE_MAX_BYTES = 16 * 1024 ** 2

const PICTURE_TYPES = {
  [PICTURE_EXTENSIONS.jpg]: 'image/jpeg',
  [PICTURE_EXTENSIONS.png]: 'image/png',
  [PICTURE_EXTENSIONS.webp]: 'image/webp',
  [PICTURE_EXTENSIONS.avif]: 'image/avif',
} as const satisfies Record<PictureExtension, string>

/** The extension a picture of the answer's content type is saved under; null for any other type. */
const extensionOf = (contentType: string | null): PictureExtension | null => {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return isPictureExtension.values.find((extension) => PICTURE_TYPES[extension] === type) ?? null
}

type WriteBytesProps = { path: string; bytes: Uint8Array }

/** The parts of `node:fs/promises` the pictures use; main passes a recursive `mkdir` and a forced, recursive `rm`. */
export type PictureFs = {
  mkdir: (path: string) => Promise<void>
  writeBytes: (input: WriteBytesProps) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  rm: (path: string) => Promise<void>
}

export type DownloadPicturesDeps = {
  /** Its `update` is the service's `change`, so the page hears of each picture and library. */
  store: DownloadsStore
  calls: Pick<ServerCalls, 'call'>
  /** A bare fetch with no cookie: a picture's address names its version, which is its only key. */
  fetch: StreamFetch
  /** The server Raven plays from: the downloads filed under its id are the ones it is asked about. */
  server: ServerEntry
  /** Whether the page is signed in, so main has an account to ask with. */
  isSignedIn: () => boolean
  fs: PictureFs
  userData: string
  timers: Timers
  newId: () => string
  warn: (message: string) => void
}

/** A saved picture as the `raven-picture:` scheme serves it. */
type PictureFile = { path: string; contentType: string }

export type DownloadPictures = {
  /**
   * Asks the server for what the downloads still lack: the library and title of an entry
   * confirmed before they were kept, then each title's poster and title art and each album's
   * cover, saved once however many downloads share them. What cannot be had now waits for the
   * next call. Never rejects.
   */
  fill: () => Promise<void>
  /** Removes the picture folders no download names any more. Never rejects. */
  sweep: () => Promise<void>
  fileOf: (pictureId: string) => PictureFile | null
  /** Stops the fetches; a pass under way ends where it is. */
  dispose: () => void
}

/** The item or album whose pictures an entry shows. */
type PictureKey = { owner: PictureOwner; id: number }

const folderOf = ({ owner, id }: PictureKey): string => `${owner}-${id}`

/*
 * Whose pictures an entry shows: its album's for a track, its title's for a video. Null when it
 * has none to show, undefined while a video's title is not known yet.
 */
const keyOf = ({ group, titleItemId }: DownloadEntry): PictureKey | null | undefined => {
  if (isMusicGroup(group)) {
    return group.cover === null ? null : { owner: PICTURE_OWNERS.album, id: group.cover.albumId }
  }
  if (titleItemId === undefined || titleItemId === null) return titleItemId
  return { owner: PICTURE_OWNERS.item, id: titleItemId }
}

const folderOfEntry = (entry: DownloadEntry): string | null => {
  const key = keyOf(entry)
  return key === null || key === undefined ? null : folderOf(key)
}

/** One title's or album's pictures to fill, for every download of its server that shows them. */
type Want = { serverId: string; key: PictureKey; folder: string }

const NO_PICTURES = { art: null, logo: null, isComplete: true } as const satisfies EntryPictures

const ANSWER_KINDS = {
  value: 'value',
  /** The server has no such title, album or file: nothing will ever come of asking again. */
  gone: 'gone',
  /** The server would not say now (a locked library, an account it refuses); the next pass asks again. */
  refused: 'refused',
  /** The server did not answer, so the pass ends rather than ask it for the rest. */
  unreachable: 'unreachable',
} as const

type Answer<T> =
  | { kind: typeof ANSWER_KINDS.value; value: T }
  | { kind: Exclude<(typeof ANSWER_KINDS)[keyof typeof ANSWER_KINDS], typeof ANSWER_KINDS.value> }

/** The addresses of a title's or album's pictures at their versions now; null for one it has none of. */
type PicturePaths = { art: string | null; logo: string | null }

type ItemPicturePathProps = {
  id: number
  kind: ItemImageKind
  version: string | null
}

const itemPicturePath = ({ id, kind, version }: ItemPicturePathProps): string | null =>
  version === null
    ? null
    : fillPath({
        path: PICTURE_PATHS.item,
        params: {
          [PICTURE_PARAMS.id]: id,
          [PICTURE_PARAMS.kind]: kind,
          [PICTURE_PARAMS.version]: version,
        },
      })

type AlbumCoverPathProps = { albumId: number; coverVersion: string | null }

const albumCoverPath = ({ albumId, coverVersion }: AlbumCoverPathProps): string | null =>
  coverVersion === null
    ? null
    : fillPath({
        path: PICTURE_PATHS.album,
        params: { [PICTURE_PARAMS.id]: albumId, [PICTURE_PARAMS.version]: coverVersion },
      })

type BytesUpToProps = {
  body: ReadableStream<Uint8Array> | null
  max: number
  signal: AbortSignal
}

/** A body's bytes, read only up to `max`; rejects past them, and null for an empty body. */
const bytesUpTo = async ({ body, max, signal }: BytesUpToProps): Promise<Uint8Array | null> => {
  if (body === null) return null
  const read: { chunks: Uint8Array[]; bytes: number } = { chunks: [], bytes: 0 }
  const sink = new WritableStream<Uint8Array>({
    write: (chunk) => {
      read.bytes += chunk.length
      if (read.bytes > max) throw new RangeError('The picture is larger than Raven keeps')
      read.chunks.push(chunk)
    },
  })
  await body.pipeTo(sink, { signal })
  return read.bytes === 0 ? null : Buffer.concat(read.chunks)
}

type EachInTurnProps<T> = { items: readonly T[]; step: (item: T) => Promise<boolean> }

/** Runs `step` over `items` one at a time; a step that answers false ends the run there. */
const eachInTurn = <T>({ items, step }: EachInTurnProps<T>): Promise<boolean> =>
  items.reduce<Promise<boolean>>(
    async (previous, item) => (await previous) && step(item),
    Promise.resolve(true),
  )

/** Each title and album whose pictures are not settled, once however many downloads share them. */
const wantsOf = (entries: readonly DownloadEntry[]): Want[] =>
  entries.reduce<Want[]>((wants, entry) => {
    const key = keyOf(entry)
    if (key === null || key === undefined || !!entry.pictures?.isComplete) return wants
    const folder = folderOf(key)
    const isKnown = wants.some((want) => want.serverId === entry.serverId && want.folder === folder)
    return isKnown ? wants : [...wants, { serverId: entry.serverId, key, folder }]
  }, [])

/** What saving one picture came to: the picture, and whether there is nothing left to ask for. */
type Saved = { picture: SavedPicture | null; isSettled: boolean }

/** A fill or a sweep, run in its turn. */
type PictureTask = () => Promise<void>

const NOT_SAVED = { picture: null, isSettled: false } as const satisfies Saved

/**
 * The pictures the downloads keep on disk, beside them, so the Downloads page and the player's
 * header show them with no server: `pictures/<item-or-album>/<id>.<extension>` under each
 * server's downloads, one folder a title or an album, shared by all its downloads.
 */
export const createDownloadPictures = (deps: DownloadPicturesDeps): DownloadPictures => {
  const { store, fs, userData, warn } = deps
  const stop = new AbortController()
  // Fills and sweeps run one at a time, so a sweep never meets a picture written but not yet named.
  const turns: { last: Promise<void>; waitingFill: Promise<void> | null } = {
    last: Promise.resolve(),
    waitingFill: null,
  }

  const inTurn = (task: PictureTask): Promise<void> => {
    turns.last = turns.last.then(task).catch((error: unknown) => {
      warn(`Raven could not keep its downloads' pictures: ${loggable(errorText(error))}`)
    })
    return turns.last
  }

  type AskProps<T> = { call: AllowedCall; guard: Guard<T> }

  const ask = async <T>({ call, guard }: AskProps<T>): Promise<Answer<T>> => {
    const result = await deps.calls.call({ call }).catch(() => null)
    if (result === null || !result.ok || stop.signal.aborted) {
      return { kind: ANSWER_KINDS.unreachable }
    }
    if (result.status === HTTP_STATUSES.notFound) return { kind: ANSWER_KINDS.gone }
    if (result.status >= HTTP_STATUSES.badGateway) return { kind: ANSWER_KINDS.unreachable }
    if (!isSuccessStatus(result.status)) return { kind: ANSWER_KINDS.refused }
    const value = parseJson(result.body)
    return guard(value) ? { kind: ANSWER_KINDS.value, value } : { kind: ANSWER_KINDS.refused }
  }

  type FileLibraryProps = {
    entry: DownloadEntry
    /** Each library asked for in this pass, so one is read once however many files it holds. */
    libraries: Map<number, Promise<Answer<Library>>>
  }

  /** Files an entry from before under its library and its title; false when the server is out of reach. */
  const fileLibrary = async ({ entry, libraries }: FileLibraryProps): Promise<boolean> => {
    const { downloadId, mediaId } = entry
    const media = await ask({
      call: { name: CALL_NAMES.getMedia, mediaId },
      guard: isMediaItem,
    })
    if (media.kind !== ANSWER_KINDS.value) return media.kind !== ANSWER_KINDS.unreachable
    const { libraryId } = media.value
    const asked =
      libraries.get(libraryId) ??
      ask({ call: { name: CALL_NAMES.getLibrary, libraryId }, guard: isLibrary })
    libraries.set(libraryId, asked)
    const library = await asked
    if (library.kind !== ANSWER_KINDS.value) return library.kind !== ANSWER_KINDS.unreachable
    store.update((state) =>
      setLibrary({
        state,
        downloadId,
        library: libraryOf(library.value),
        titleItemId: titleItemIdOf(media.value),
      }),
    )
    return true
  }

  const pathsOf = async ({ key }: Want): Promise<Answer<PicturePaths>> => {
    if (key.owner === PICTURE_OWNERS.album) {
      const details = await ask({
        call: { name: CALL_NAMES.getAlbum, albumId: key.id },
        guard: isAlbumDetails,
      })
      if (details.kind !== ANSWER_KINDS.value) return details
      const { id, coverVersion } = details.value.album
      return {
        kind: ANSWER_KINDS.value,
        value: { art: albumCoverPath({ albumId: id, coverVersion }), logo: null },
      }
    }
    const details = await ask({
      call: { name: CALL_NAMES.getItem, itemId: key.id },
      guard: isItemDetails,
    })
    if (details.kind !== ANSWER_KINDS.value) return details
    const { id, posterVersion, logoVersion } = details.value
    return {
      kind: ANSWER_KINDS.value,
      value: {
        art: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.poster, version: posterVersion }),
        logo: itemPicturePath({ id, kind: ITEM_IMAGE_KINDS.logo, version: logoVersion }),
      },
    }
  }

  type SaveProps = { want: Want; path: string | null }

  /** Fetches one picture whole and writes it; a failure is logged and left for the next pass. */
  const save = async ({ want, path }: SaveProps): Promise<Saved> => {
    if (path === null) return { picture: null, isSettled: true }
    if (want.serverId !== deps.server.id) return NOT_SAVED
    const late = new AbortController()
    const timer = deps.timers.set({ run: () => late.abort(), ms: DOWNLOAD_STALL_MS })
    const signal = AbortSignal.any([stop.signal, late.signal])
    try {
      const response = await deps.fetch({
        url: `${deps.server.origin}${path}`,
        headers: {},
        signal,
      })
      const extension = extensionOf(response.headers.get(HEADERS.contentType))
      if (response.status !== HTTP_STATUSES.ok || extension === null) {
        if (response.body !== null) await response.body.cancel().catch(() => undefined)
        warn(`Raven kept no picture for ${want.folder}: the server answered ${response.status}`)
        return NOT_SAVED
      }
      const bytes = await bytesUpTo({ body: response.body, max: PICTURE_MAX_BYTES, signal })
      if (bytes === null) return NOT_SAVED
      const picture = { id: deps.newId(), folder: want.folder, extension }
      const { serverId } = want
      await fs.mkdir(pictureFolderFor({ userData, serverId, folder: want.folder }))
      await fs.writeBytes({ path: picturePathFor({ userData, serverId, picture }), bytes })
      return { picture, isSettled: true }
    } catch (error) {
      if (!stop.signal.aborted) {
        warn(`Raven kept no picture for ${want.folder}: ${loggable(errorText(error))}`)
      }
      return NOT_SAVED
    } finally {
      deps.timers.clear(timer)
    }
  }

  const membersOf = ({ serverId, folder }: Want): DownloadEntry[] =>
    store
      .read()
      .entries.filter((entry) => entry.serverId === serverId && folderOfEntry(entry) === folder)

  type ShareProps = { want: Want; pictures: EntryPictures }

  const share = ({ want, pictures }: ShareProps): void => {
    const downloadIds = membersOf(want).map(({ downloadId }) => downloadId)
    store.update((state) => setPictures({ state, downloadIds, pictures }))
  }

  /** Saves what a title or album still lacks, for all its downloads; false when the server is out of reach. */
  const fillWant = async (want: Want): Promise<boolean> => {
    const held = membersOf(want).flatMap(({ pictures }) =>
      pictures === undefined ? [] : [pictures],
    )
    const kept = {
      art: held.find(({ art }) => art !== null)?.art ?? null,
      logo: held.find(({ logo }) => logo !== null)?.logo ?? null,
    }
    // A download that joins a title whose pictures are settled shows them, with nothing to ask.
    if (held.some(({ isComplete }) => isComplete)) {
      share({ want, pictures: { ...kept, isComplete: true } })
      return true
    }
    const paths = await pathsOf(want)
    if (paths.kind === ANSWER_KINDS.gone) share({ want, pictures: { ...kept, isComplete: true } })
    if (paths.kind !== ANSWER_KINDS.value) return paths.kind !== ANSWER_KINDS.unreachable
    const art =
      kept.art === null
        ? await save({ want, path: paths.value.art })
        : { picture: kept.art, isSettled: true }
    const logo =
      kept.logo === null
        ? await save({ want, path: paths.value.logo })
        : { picture: kept.logo, isSettled: true }
    if (stop.signal.aborted) return false
    share({
      want,
      pictures: {
        art: art.picture,
        logo: logo.picture,
        isComplete: art.isSettled && logo.isSettled,
      },
    })
    return true
  }

  /** The entries main can ask the server about now: its server is held and the page is signed in. */
  const askable = (): DownloadEntry[] =>
    store.read().entries.filter(({ serverId }) => serverId === deps.server.id && deps.isSignedIn())

  const fillAll = async (): Promise<void> => {
    if (stop.signal.aborted) return
    const libraries = new Map<number, Promise<Answer<Library>>>()
    const isReached = await eachInTurn({
      items: askable().filter(({ library }) => library === undefined),
      step: (entry) => fileLibrary({ entry, libraries }),
    })
    if (!isReached) return
    // A title with no item, or a playlist with no cover, has no picture to wait for.
    const bare = store
      .read()
      .entries.filter((entry) => entry.pictures === undefined && keyOf(entry) === null)
      .map(({ downloadId }) => downloadId)
    store.update((state) => setPictures({ state, downloadIds: bare, pictures: NO_PICTURES }))
    await eachInTurn({ items: wantsOf(askable()), step: fillWant })
  }

  /** The names in a folder; none when it does not exist or cannot be read. */
  const namesIn = (path: string): Promise<string[]> => fs.readdir(path).catch(() => [])

  const sweepServer = async (serverId: string): Promise<void> => {
    const names = (await namesIn(picturesDirFor({ userData, serverId }))).filter(isPictureFolder)
    // Read once the folder is listed, so a picture saved meanwhile keeps its folder.
    const named = new Set(
      store
        .read()
        .entries.filter((entry) => entry.serverId === serverId)
        .flatMap(({ pictures }) => [pictures?.art ?? null, pictures?.logo ?? null])
        .flatMap((picture) => (picture === null ? [] : [picture.folder])),
    )
    await Promise.all(
      names
        .filter((name) => !named.has(name))
        .map((folder) =>
          removeFolder({
            fs,
            warn,
            path: pictureFolderFor({ userData, serverId, folder }),
            what: 'a picture folder no download names',
          }),
        ),
    )
  }

  const sweepAll = async (): Promise<void> => {
    const serverIds = (await namesIn(downloadsDirFor({ userData }))).filter(isOpaqueId)
    await Promise.all(serverIds.map(sweepServer))
  }

  const fill: DownloadPictures['fill'] = () => {
    // A fill asked for while one waits its turn is that one: it reads the entries when it starts.
    if (turns.waitingFill !== null) return turns.waitingFill
    const run = inTurn(() => {
      turns.waitingFill = null
      return fillAll()
    })
    turns.waitingFill = run
    return run
  }

  const fileOf: DownloadPictures['fileOf'] = (pictureId) => {
    const [found] = store
      .read()
      .entries.flatMap(({ serverId, pictures }) =>
        [pictures?.art ?? null, pictures?.logo ?? null].flatMap((picture) =>
          picture !== null && picture.id === pictureId ? [{ serverId, picture }] : [],
        ),
      )
    if (found === undefined) return null
    return {
      path: picturePathFor({ userData, ...found }),
      contentType: PICTURE_TYPES[found.picture.extension],
    }
  }

  return { fill, sweep: () => inTurn(sweepAll), fileOf, dispose: () => stop.abort() }
}
