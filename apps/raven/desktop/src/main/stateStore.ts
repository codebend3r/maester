import { parseJson } from '@/main/parseJson'
import type { Timers } from '@/main/timers'
import {
  EMPTY_STATE,
  isStoredPlayerState,
  type PlayerState,
  upgradeState,
} from '@/main/playerState'

type WriteFileProps = { path: string; data: string }

type RenameProps = { from: string; to: string }

export type StateFs = {
  readFile: (path: string) => Promise<string>
  writeFile: (input: WriteFileProps) => Promise<void>
  rename: (input: RenameProps) => Promise<void>
}

export type JsonStore<T> = {
  read: () => T
  update: (change: (value: T) => T) => void
  flush: () => Promise<void>
  isDirty: () => boolean
}

export type StateStore = JsonStore<PlayerState>

export type JsonStoreOptions<T> = {
  fs: StateFs
  file: string
  initial: T
  timers: Timers
  debounceMs: number
  onError: (error: unknown) => void
  /** `initial` is not what the file holds (an upgrade read it), so the next flush writes it. */
  isInitialUnsaved?: boolean
}

/** The `code` of the Node system errors Raven tells apart. */
export const ERROR_CODES = {
  enoent: 'ENOENT',
  noSpace: 'ENOSPC',
  addressInUse: 'EADDRINUSE',
  addressNotAvailable: 'EADDRNOTAVAIL',
  familyNotSupported: 'EAFNOSUPPORT',
} as const

/** The `code` a Node system error carries; null for an error without one, or anything else thrown. */
export const errorCodeOf = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null

export const isMissingFile = (error: unknown): boolean => errorCodeOf(error) === ERROR_CODES.enoent

/** What a JSON file held: nothing, a value its guard accepts, or something else, now set aside. */
export const JSON_READ_KINDS = { missing: 'missing', read: 'read', setAside: 'setAside' } as const

export type JsonRead<T> =
  | { kind: typeof JSON_READ_KINDS.missing }
  | { kind: typeof JSON_READ_KINDS.read; value: T }
  | { kind: typeof JSON_READ_KINDS.setAside }

type JsonFile<T> = {
  fs: StateFs
  file: string
  now: () => number
  guard: (value: unknown) => value is T
}

export const readJsonFile = async <T>({
  fs,
  file,
  now,
  guard,
}: JsonFile<T>): Promise<JsonRead<T>> => {
  const text = await fs.readFile(file).then(
    (read) => ({ found: true as const, read }),
    (error: unknown) => ({ found: false as const, error }),
  )
  if (!text.found && isMissingFile(text.error)) return { kind: JSON_READ_KINDS.missing }
  if (text.found) {
    const parsed = parseJson(text.read)
    if (guard(parsed)) return { kind: JSON_READ_KINDS.read, value: parsed }
  }
  // Keep the unreadable file for a person to inspect; the next save would otherwise replace it.
  await fs.rename({ from: file, to: `${file}.corrupt-${now()}` }).catch(() => undefined)
  return { kind: JSON_READ_KINDS.setAside }
}

export const loadJson = async <T>({ empty, ...input }: JsonFile<T> & { empty: T }): Promise<T> => {
  const read = await readJsonFile(input)
  return read.kind === JSON_READ_KINDS.read ? read.value : empty
}

type LoadStateProps = {
  fs: StateFs
  file: string
  now: () => number
}

export const loadState = async ({ fs, file, now }: LoadStateProps): Promise<PlayerState> =>
  upgradeState(await loadJson({ fs, file, now, guard: isStoredPlayerState, empty: EMPTY_STATE }))

export const createJsonStore = <T>({
  fs,
  file,
  initial,
  timers,
  debounceMs,
  onError,
  isInitialUnsaved = false,
}: JsonStoreOptions<T>): JsonStore<T> => {
  const tmp = `${file}.tmp`
  let value = initial
  let version = isInitialUnsaved ? 1 : 0
  let savedVersion = 0
  let timer: unknown
  let queue = Promise.resolve()

  const report = (error: unknown): void => {
    try {
      onError(error)
    } catch {
      // A throwing reporter must not reject the queue, or every later write would be skipped.
    }
  }

  // Never rejects, so the queue it extends never rejects either.
  const writeIfDirty = async (): Promise<void> => {
    if (savedVersion === version) return
    const writing = { value, version }
    try {
      await fs.writeFile({ path: tmp, data: JSON.stringify(writing.value) })
      await fs.rename({ from: tmp, to: file })
      savedVersion = writing.version
    } catch (error) {
      report(error)
    }
  }

  const enqueue = (): Promise<void> => {
    queue = queue.then(writeIfDirty)
    return queue
  }

  const cancelTimer = () => {
    if (timer === undefined) return
    timers.clear(timer)
    timer = undefined
  }

  return {
    read: () => value,
    isDirty: () => savedVersion !== version,
    update: (change) => {
      const next = change(value)
      // A change that kept the same value has nothing to write.
      if (next === value) return
      value = next
      version += 1
      cancelTimer()
      timer = timers.set({
        run: () => {
          timer = undefined
          void enqueue()
        },
        ms: debounceMs,
      })
    },
    flush: () => {
      cancelTimer()
      return enqueue()
    },
  }
}

export const createStateStore = (options: JsonStoreOptions<PlayerState>): StateStore =>
  createJsonStore(options)
