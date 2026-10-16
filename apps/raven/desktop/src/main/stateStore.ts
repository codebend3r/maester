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

export type StateStore = {
  read: () => PlayerState
  update: (change: (state: PlayerState) => PlayerState) => void
  flush: () => Promise<void>
  isDirty: () => boolean
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

/** Never throws: whatever cannot be read as a state is kept aside and the app starts empty. */
export const loadState = async ({
  fs,
  file,
  now,
}: {
  fs: StateFs
  file: string
  now: () => number
}): Promise<PlayerState> => {
  const text = await fs.readFile(file).then(
    (read) => ({ found: true as const, read }),
    (error: unknown) => ({ found: false as const, error }),
  )
  if (!text.found && isMissingFile(text.error)) return EMPTY_STATE
  if (text.found) {
    const parsed = parseJson(text.read)
    if (isPlayerState(parsed)) return parsed
  }
  // Keep the unreadable file for a person to inspect; the next save would otherwise replace it.
  await fs.rename(file, `${file}.corrupt-${now()}`).catch(() => undefined)
  return EMPTY_STATE
}

export const createStateStore = ({
  fs,
  file,
  initial,
  timers,
  debounceMs,
  onError,
}: {
  fs: StateFs
  file: string
  initial: PlayerState
  timers: Timers
  debounceMs: number
  onError: (error: unknown) => void
}): StateStore => {
  const tmp = `${file}.tmp`
  let state = initial
  let version = 0
  let savedVersion = 0
  let timer: unknown
  let queue = Promise.resolve()

  const writeIfDirty = async (): Promise<void> => {
    if (savedVersion === version) return
    const writing = { state, version }
    try {
      await fs.writeFile(tmp, JSON.stringify(writing.state))
      await fs.rename(tmp, file)
      savedVersion = writing.version
    } catch (error) {
      onError(error)
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
    read: () => state,
    isDirty: () => savedVersion !== version,
    update: (change) => {
      state = change(state)
      version += 1
      cancelTimer()
      timer = timers.set(() => {
        timer = undefined
        enqueue().catch(onError)
      }, debounceMs)
    },
    flush: () => {
      cancelTimer()
      return enqueue()
    },
  }
}
