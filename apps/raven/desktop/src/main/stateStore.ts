import { EMPTY_STATE, isPlayerState, type PlayerState } from '@/main/playerState'

export type StateFs = {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, data: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
}

export type Timers = {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
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
}

export const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Never throws: whatever cannot be read as a `T` is kept aside and the app starts with `empty`. */
/** What a JSON file held: nothing, a value its guard accepts, or something else, now set aside. */
export type JsonRead<T> = { kind: 'missing' } | { kind: 'read'; value: T } | { kind: 'setAside' }

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
  if (!text.found && isMissingFile(text.error)) return { kind: 'missing' }
  if (text.found) {
    const parsed = parseJson(text.read)
    if (guard(parsed)) return { kind: 'read', value: parsed }
  }
  // Keep the unreadable file for a person to inspect; the next save would otherwise replace it.
  await fs.rename(file, `${file}.corrupt-${now()}`).catch(() => undefined)
  return { kind: 'setAside' }
}

export const loadJson = async <T>({ empty, ...input }: JsonFile<T> & { empty: T }): Promise<T> => {
  const read = await readJsonFile(input)
  return read.kind === 'read' ? read.value : empty
}

export const loadState = ({
  fs,
  file,
  now,
}: {
  fs: StateFs
  file: string
  now: () => number
}): Promise<PlayerState> => loadJson({ fs, file, now, guard: isPlayerState, empty: EMPTY_STATE })

export const createJsonStore = <T>({
  fs,
  file,
  initial,
  timers,
  debounceMs,
  onError,
}: JsonStoreOptions<T>): JsonStore<T> => {
  const tmp = `${file}.tmp`
  let value = initial
  let version = 0
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
      await fs.writeFile(tmp, JSON.stringify(writing.value))
      await fs.rename(tmp, file)
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
      timer = timers.set(() => {
        timer = undefined
        void enqueue()
      }, debounceMs)
    },
    flush: () => {
      cancelTimer()
      return enqueue()
    },
  }
}

export const createStateStore = (options: JsonStoreOptions<PlayerState>): StateStore =>
  createJsonStore(options)
