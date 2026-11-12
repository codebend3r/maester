import { ITEM_IMAGE_KINDS, type ItemImageKind } from '@raven/core'
import type { DownloadDisk } from '@/browserDownloads/disk'
import {
  type BrowserEntry,
  pictureExtensionOf,
  pictureFolderOf,
  type SavedPicture,
} from '@/browserDownloads/entries'
import type { DownloadServer } from '@/browserDownloads/server'
import type { DownloadStore } from '@/browserDownloads/store'

/** Where object URLs come from and go, so a test counts them. */
export type ObjectUrls = { create: (blob: Blob) => string; revoke: (url: string) => void }

type DownloadPicturesDeps = {
  disk: DownloadDisk
  server: DownloadServer
  urls: ObjectUrls
  newId: () => string
  store: DownloadStore
}

export type DownloadPictures = {
  /** The object URL of a saved picture; null until it is read from disk. */
  urlOf: (pictureId: string) => string | null
  /**
   * A title's poster and title art, saved once for every download that wears them. One that
   * fails leaves the entry incomplete, so the next fill asks again; it never fails the download.
   */
  save: (downloadId: string) => Promise<void>
  /** Reads the pictures the account's downloads show into object URLs, once each; says whether any was asked for. */
  load: () => Promise<boolean>
  /** Asks again for the pictures a download could not get when it ran; says whether any was lacking. */
  fill: () => Promise<boolean>
  /** Lets go of the object URLs no download of the account shows any more. */
  drop: () => void
  /** Removes a title's pictures from disk once the last download that wore them is gone. */
  removeOf: (entry: BrowserEntry) => Promise<void>
}

type SaveOneProps = {
  entry: BrowserEntry
  itemId: number
  kind: ItemImageKind
  version: string | null
}

type PictureOutcome = { saved: SavedPicture | null; isDone: boolean }

/**
 * The pictures the browser's downloads keep: on disk under their title's folder, and in memory
 * as the object URLs the page shows them by.
 */
export const createDownloadPictures = ({
  disk,
  server,
  urls,
  newId,
  store,
}: DownloadPicturesDeps): DownloadPictures => {
  const shown = new Map<string, string>()
  const turns: { last: Promise<void> } = { last: Promise.resolve() }

  const saveOne = async ({
    entry,
    itemId,
    kind,
    version,
  }: SaveOneProps): Promise<PictureOutcome> => {
    if (version === null) return { saved: null, isDone: true }
    const blob = await server.picture({ itemId, kind, version })
    const extension = blob === null ? null : pictureExtensionOf(blob.type)
    if (blob === null || extension === null) return { saved: null, isDone: false }
    const id = newId()
    const name = `${id}.${extension}`
    await disk.write({
      path: [...pictureFolderOf({ accountId: entry.accountId, itemId }), name],
      data: blob,
    })
    shown.set(id, urls.create(blob))
    return { saved: { id, name }, isDone: true }
  }

  const saveNow = async (downloadId: string): Promise<void> => {
    const entry = store.entryOf(downloadId)
    if (entry === null || entry.pictures.isComplete) return
    const itemId = entry.titleItemId
    if (itemId === null) {
      return store.patch({
        downloadId,
        patch: { pictures: { ...entry.pictures, isComplete: true } },
      })
    }
    const shared = store
      .own()
      .find((other) => other.titleItemId === itemId && other.pictures.isComplete)
    if (shared !== undefined)
      return store.patch({ downloadId, patch: { pictures: shared.pictures } })
    const details = await server.api.getItem(itemId)
    const art =
      entry.pictures.art === null
        ? await saveOne({
            entry,
            itemId,
            kind: ITEM_IMAGE_KINDS.poster,
            version: details.posterVersion,
          })
        : { saved: entry.pictures.art, isDone: true }
    const logo =
      entry.pictures.logo === null
        ? await saveOne({
            entry,
            itemId,
            kind: ITEM_IMAGE_KINDS.logo,
            version: details.logoVersion,
          })
        : { saved: entry.pictures.logo, isDone: true }
    store.patch({
      downloadId,
      patch: {
        pictures: { art: art.saved, logo: logo.saved, isComplete: art.isDone && logo.isDone },
      },
    })
  }

  /** One title at a time, so a fill and a run that want the same title's pictures save them once. */
  const save: DownloadPictures['save'] = (downloadId) => {
    const saved = turns.last.then(() => saveNow(downloadId))
    turns.last = saved.catch(() => undefined)
    return saved
  }

  const load: DownloadPictures['load'] = async () => {
    const wanted = store.own().flatMap((entry) => {
      const itemId = entry.titleItemId
      if (itemId === null) return []
      return [entry.pictures.art, entry.pictures.logo].flatMap((saved) =>
        saved === null || shown.has(saved.id)
          ? []
          : [
              {
                saved,
                path: [...pictureFolderOf({ accountId: entry.accountId, itemId }), saved.name],
              },
            ],
      )
    })
    const read = await Promise.all(
      wanted.map(async ({ saved, path }) => ({
        saved,
        blob: await disk.read(path).catch(() => null),
      })),
    )
    read.forEach(({ saved, blob }) => {
      if (blob !== null && !shown.has(saved.id)) shown.set(saved.id, urls.create(blob))
    })
    return read.length > 0
  }

  const fill: DownloadPictures['fill'] = async () => {
    const lacking = store.own().filter(({ pictures }) => !pictures.isComplete)
    await lacking.reduce<Promise<void>>(async (previous, { downloadId }) => {
      await previous
      await save(downloadId).catch(() => undefined)
    }, Promise.resolve())
    return lacking.length > 0
  }

  const drop: DownloadPictures['drop'] = () => {
    const held = new Set(
      store.own().flatMap(({ pictures }) => [pictures.art?.id ?? null, pictures.logo?.id ?? null]),
    )
    shown.forEach((url, id) => {
      if (held.has(id)) return
      urls.revoke(url)
      shown.delete(id)
    })
  }

  const removeOf: DownloadPictures['removeOf'] = async ({ accountId, titleItemId }) => {
    const isShared = store
      .all()
      .some((other) => other.accountId === accountId && other.titleItemId === titleItemId)
    if (titleItemId === null || isShared) return
    await disk.remove(pictureFolderOf({ accountId, itemId: titleItemId })).catch(() => undefined)
  }

  return { urlOf: (pictureId) => shown.get(pictureId) ?? null, save, load, fill, drop, removeOf }
}
