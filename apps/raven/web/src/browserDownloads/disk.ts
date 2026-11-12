/** A file or folder on the downloads disk, as its names from the root down. */
export type DiskPath = readonly string[]

/** The browser gave the origin no more room: the write that met its quota throws this. */
export class DiskFullError extends Error {
  constructor() {
    super('The browser has no more room for downloads.')
    this.name = 'DiskFullError'
  }
}

/** A file open for appending. Nothing written outlives the tab until `commit` or `close`. */
type DiskWriter = {
  write: (chunk: Uint8Array) => Promise<void>
  /** Makes everything written so far part of the file, and carries on. */
  commit: () => Promise<void>
  close: () => Promise<void>
}

type OpenProps = {
  path: DiskPath
  /** The bytes of the file to keep; whatever lies past them is dropped. */
  from: number
}

type WriteProps = { path: DiskPath; data: Blob | string }

type DiskSpace = { usage: number; quota: number }

/** Everything the downloads do to the disk, so a test hands the engine one made of maps. */
export type DownloadDisk = {
  /** The bytes of a file that outlive the tab; 0 for one that is not there. */
  size: (path: DiskPath) => Promise<number>
  open: (input: OpenProps) => Promise<DiskWriter>
  /** Writes a small file whole: the index, a picture, a subtitle. */
  write: (input: WriteProps) => Promise<void>
  /** The file, backed by the disk rather than read into memory; null for one that is not there. */
  read: (path: DiskPath) => Promise<Blob | null>
  /** Removes a file, or a folder and all in it; one that is not there is already gone. */
  remove: (path: DiskPath) => Promise<void>
  space: () => Promise<DiskSpace>
  /** Asks the browser to keep the origin's storage when the device runs short. */
  persist: () => Promise<void>
}

export const ERROR_NAMES = { quota: 'QuotaExceededError', notFound: 'NotFoundError' } as const

type IsNamedProps = { error: unknown; name: string }

const isNamed = ({ error, name }: IsNamedProps): boolean =>
  error instanceof Error && error.name === name

/** One thing asked of the file system, which may refuse it. */
type DiskStep<T> = () => Promise<T>

/** Runs a write, naming the quota's refusal so the engine pauses rather than fails. */
const unlessFull = async <T>(write: DiskStep<T>): Promise<T> => {
  try {
    return await write()
  } catch (error) {
    if (isNamed({ error, name: ERROR_NAMES.quota })) throw new DiskFullError()
    throw error
  }
}

/** What is there, or null when it is not; any other failure is the caller's to hear. */
const unlessMissing = async <T>(find: DiskStep<T>): Promise<T | null> => {
  try {
    return await find()
  } catch (error) {
    if (isNamed({ error, name: ERROR_NAMES.notFound })) return null
    throw error
  }
}

/** The one command a writable is sent: bytes at a place in the file. */
const POSITIONED_WRITE = 'write'

type PositionedWrite = {
  type: typeof POSITIONED_WRITE
  position: number
  data: Uint8Array<ArrayBuffer>
}

/** The parts of the file system's handles the disk uses, which the browser's own satisfy. */
type OpfsWritable = {
  truncate: (size: number) => Promise<void>
  write: (data: string | Blob | PositionedWrite) => Promise<void>
  close: () => Promise<void>
}

type KeepOption = { keepExistingData?: boolean }

type CreateOption = { create?: boolean }

type RecursiveOption = { recursive?: boolean }

type OpfsFile = {
  getFile: () => Promise<Blob>
  createWritable: (options?: KeepOption) => Promise<OpfsWritable>
}

type OpfsFolder = {
  getDirectoryHandle: (name: string, options?: CreateOption) => Promise<OpfsFolder>
  getFileHandle: (name: string, options?: CreateOption) => Promise<OpfsFile>
  removeEntry: (name: string, options?: RecursiveOption) => Promise<void>
}

/** The part of `navigator.storage` the disk uses. */
type SpaceEstimate = { usage?: number; quota?: number }

export type DiskStorage = {
  getDirectory: () => Promise<OpfsFolder>
  estimate: () => Promise<SpaceEstimate>
  persist: () => Promise<boolean>
}

/** A writable that keeps what the file already holds. */
const writableOf = (handle: OpfsFile): Promise<OpfsWritable> =>
  unlessFull(() => handle.createWritable({ keepExistingData: true }))

type FolderAtProps = { names: readonly string[]; shouldCreate: boolean }

type FileAtProps = { path: DiskPath; shouldCreate: boolean }

/**
 * The downloads disk over the Origin Private File System. A file is written through
 * `createWritable`, whose bytes land in a swap file and join the real one only when it closes,
 * so `commit` closes and opens again; `keepExistingData` keeps what was already there.
 */
export const opfsDisk = (storage: DiskStorage): DownloadDisk => {
  const folderAt = ({ names, shouldCreate }: FolderAtProps): Promise<OpfsFolder> =>
    names.reduce<Promise<OpfsFolder>>(
      async (parent, name) => (await parent).getDirectoryHandle(name, { create: shouldCreate }),
      storage.getDirectory(),
    )

  const fileAt = async ({ path, shouldCreate }: FileAtProps): Promise<OpfsFile> => {
    const folder = await folderAt({ names: path.slice(0, -1), shouldCreate })
    return folder.getFileHandle(path.at(-1) ?? '', { create: shouldCreate })
  }

  return {
    size: async (path) => {
      const handle = await unlessMissing(() => fileAt({ path, shouldCreate: false }))
      return handle === null ? 0 : (await handle.getFile()).size
    },
    open: async ({ path, from }) => {
      const handle = await fileAt({ path, shouldCreate: true })
      const state = { stream: await writableOf(handle), at: from }
      await state.stream.truncate(from)
      return {
        write: async (chunk) => {
          // A copy, since a chunk may sit on a shared buffer, which a writable does not take.
          const data = new Uint8Array(chunk)
          await unlessFull(() =>
            state.stream.write({ type: POSITIONED_WRITE, position: state.at, data }),
          )
          state.at += data.byteLength
        },
        commit: async () => {
          await unlessFull(() => state.stream.close())
          state.stream = await writableOf(handle)
        },
        close: () => unlessFull(() => state.stream.close()),
      }
    },
    write: async ({ path, data }) => {
      const handle = await fileAt({ path, shouldCreate: true })
      const stream = await unlessFull(() => handle.createWritable())
      await unlessFull(() => stream.write(data))
      await unlessFull(() => stream.close())
    },
    read: async (path) => {
      const handle = await unlessMissing(() => fileAt({ path, shouldCreate: false }))
      return handle === null ? null : handle.getFile()
    },
    remove: async (path) => {
      const folder = await unlessMissing(() =>
        folderAt({ names: path.slice(0, -1), shouldCreate: false }),
      )
      if (folder === null) return
      await unlessMissing(() => folder.removeEntry(path.at(-1) ?? '', { recursive: true }))
    },
    space: async () => {
      const { usage = 0, quota = 0 } = await storage.estimate()
      return { usage, quota }
    },
    persist: async () => {
      await storage.persist()
    },
  }
}
