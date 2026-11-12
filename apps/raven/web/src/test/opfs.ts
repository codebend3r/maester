import { type DiskStorage, ERROR_NAMES } from '@/browserDownloads/disk'

type Folder = Awaited<ReturnType<DiskStorage['getDirectory']>>

type File = Awaited<ReturnType<Folder['getFileHandle']>>

/** A DOMException as the file system throws it, which the disk reads by name. */
const named = (name: string): Error => Object.assign(new Error(name), { name })

type FakeFolder = { folders: Map<string, FakeFolder>; files: Map<string, Blob> }

const newFolder = (): FakeFolder => ({ folders: new Map(), files: new Map() })

type FakeStorageProps = {
  /** The most bytes the origin holds before a write is refused for the quota; none by default. */
  quota?: number
}

/**
 * The Origin Private File System in memory, as far as the downloads use it: folders and files by
 * name, and a writable whose bytes join the file only when it closes.
 */
export const fakeStorage = ({ quota = Number.POSITIVE_INFINITY }: FakeStorageProps = {}) => {
  const root = newFolder()
  const calls = { persisted: 0 }

  const sizeOf = (folder: FakeFolder): number =>
    [...folder.files.values()].reduce((sum, blob) => sum + blob.size, 0) +
    [...folder.folders.values()].reduce((sum, child) => sum + sizeOf(child), 0)

  type FileHandleProps = { folder: FakeFolder; name: string }

  const fileHandle = ({ folder, name }: FileHandleProps): File => ({
    getFile: async () => folder.files.get(name) ?? new Blob([]),
    createWritable: async (options) => {
      const swap = {
        blob: !!options?.keepExistingData ? (folder.files.get(name) ?? new Blob([])) : new Blob([]),
      }
      return {
        truncate: async (size) => {
          swap.blob = swap.blob.slice(0, size)
        },
        write: async (data) => {
          const next =
            typeof data === 'string' || data instanceof Blob
              ? new Blob([data])
              : new Blob([swap.blob.slice(0, data.position), data.data])
          if (sizeOf(root) + next.size > quota) throw named(ERROR_NAMES.quota)
          swap.blob = next
        },
        close: async () => {
          folder.files.set(name, swap.blob)
        },
      }
    },
  })

  const folderHandle = (folder: FakeFolder): Folder => ({
    getDirectoryHandle: async (name, options) => {
      const found = folder.folders.get(name)
      if (found !== undefined) return folderHandle(found)
      if (!options?.create) throw named(ERROR_NAMES.notFound)
      const made = newFolder()
      folder.folders.set(name, made)
      return folderHandle(made)
    },
    getFileHandle: async (name, options) => {
      if (!folder.files.has(name) && !options?.create) throw named(ERROR_NAMES.notFound)
      if (!folder.files.has(name)) folder.files.set(name, new Blob([]))
      return fileHandle({ folder, name })
    },
    removeEntry: async (name) => {
      if (!folder.files.has(name) && !folder.folders.has(name)) throw named(ERROR_NAMES.notFound)
      folder.files.delete(name)
      folder.folders.delete(name)
    },
  })

  return { root, calls, quota, sizeOf: () => sizeOf(root), folderHandle: () => folderHandle(root) }
}

/** The fake as the `navigator.storage` the disk is handed. */
export const storageOf = (fake: ReturnType<typeof fakeStorage>): DiskStorage => ({
  getDirectory: async () => fake.folderHandle(),
  estimate: async () => ({ usage: fake.sizeOf(), quota: fake.quota }),
  persist: async () => {
    fake.calls.persisted += 1
    return true
  },
})
