import { describe, expect, it } from 'bun:test'
import { EMPTY_STATE, addRecent, type PlayerState } from '@/main/playerState'
import { EMPTY_CONFIG, isDesktopConfig } from '@/main/desktopConfig'
import {
  createJsonStore,
  createStateStore,
  isMissingFile,
  loadJson,
  loadState,
  type StateFs,
  type Timers,
} from '@/main/stateStore'

const FILE = '/data/player-state.json'
const TMP = `${FILE}.tmp`

type Call = { op: 'readFile' | 'writeFile' | 'rename'; args: string[] }

const missing = (path: string): Error =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })

const createFakeFs = (initial: Record<string, string> = {}) => {
  const files = new Map(Object.entries(initial))
  const calls: Call[] = []
  const gates: Array<Promise<void>> = []
  const state = {
    failWrites: 0,
    failRenames: 0,
    gates,
  }

  const fs: StateFs = {
    readFile: async (path) => {
      calls.push({ op: 'readFile', args: [path] })
      const text = files.get(path)
      if (text === undefined) throw missing(path)
      return text
    },
    writeFile: async (path, data) => {
      calls.push({ op: 'writeFile', args: [path, data] })
      const gate = state.gates.shift()
      if (gate) await gate
      if (state.failWrites > 0) {
        state.failWrites -= 1
        throw new Error('disk full')
      }
      files.set(path, data)
    },
    rename: async (from, to) => {
      calls.push({ op: 'rename', args: [from, to] })
      if (state.failRenames > 0) {
        state.failRenames -= 1
        throw new Error('rename refused')
      }
      const text = files.get(from)
      if (text === undefined) throw missing(from)
      files.delete(from)
      files.set(to, text)
    },
  }

  const holdNextWrite = () => {
    const gate = Promise.withResolvers<void>()
    state.gates.push(gate.promise)
    return { release: () => gate.resolve() }
  }

  return { fs, files, calls, state, holdNextWrite }
}

const createFakeTimers = () => {
  const pending = new Map<number, () => void>()
  const delays: number[] = []
  const counter = { next: 1 }
  const timers: Timers = {
    set: (run, ms) => {
      const handle = counter.next
      counter.next += 1
      pending.set(handle, run)
      delays.push(ms)
      return handle
    },
    clear: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
  }
  const fire = () => {
    const runs = [...pending.values()]
    pending.clear()
    runs.forEach((run) => run())
  }
  return { timers, fire, pending, delays }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const writes = (calls: Call[]) => calls.filter((call) => call.op === 'writeFile')

const named = (path: string): PlayerState => addRecent(EMPTY_STATE, { path, at: 1 })

const setup = (initial: Record<string, string> = {}) => {
  const fake = createFakeFs(initial)
  const clock = createFakeTimers()
  const errors: unknown[] = []
  const store = createStateStore({
    fs: fake.fs,
    file: FILE,
    initial: EMPTY_STATE,
    timers: clock.timers,
    debounceMs: 2000,
    onError: (error) => errors.push(error),
  })
  return { ...fake, ...clock, store, errors }
}

describe('isMissingFile', () => {
  it('is true for an Error with code ENOENT', () => {
    expect(isMissingFile(missing('/x'))).toBe(true)
  })

  it('is false for other errors and non-errors', () => {
    expect(isMissingFile(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingFile(new Error('x'))).toBe(false)
    expect(isMissingFile({ code: 'ENOENT' })).toBe(false)
    expect(isMissingFile('ENOENT')).toBe(false)
    expect(isMissingFile(null)).toBe(false)
  })
})

describe('loadState', () => {
  const now = () => 1700000000000

  it('loads EMPTY_STATE for a missing file and renames nothing', async () => {
    const { fs, calls } = createFakeFs()
    expect(await loadState({ fs, file: FILE, now })).toEqual(EMPTY_STATE)
    expect(calls.filter((call) => call.op === 'rename')).toEqual([])
  })

  it('keeps a truncated file as .corrupt-<time> and loads empty', async () => {
    const { fs, files } = createFakeFs({ [FILE]: '{"version":1,' })
    expect(await loadState({ fs, file: FILE, now })).toEqual(EMPTY_STATE)
    expect(files.has(FILE)).toBe(false)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe('{"version":1,')
  })

  it('keeps a file of a future version and loads empty', async () => {
    const text = JSON.stringify({ ...EMPTY_STATE, version: 2 })
    const { fs, files } = createFakeFs({ [FILE]: text })
    expect(await loadState({ fs, file: FILE, now })).toEqual(EMPTY_STATE)
    expect(files.get(`${FILE}.corrupt-1700000000000`)).toBe(text)
  })

  it('keeps valid JSON of the wrong shape', async () => {
    const { fs, files } = createFakeFs({ [FILE]: '[1,2,3]' })
    expect(await loadState({ fs, file: FILE, now })).toEqual(EMPTY_STATE)
    expect(files.has(`${FILE}.corrupt-1700000000000`)).toBe(true)
  })

  it('loads a valid file as written and renames nothing', async () => {
    const written = named('/a.mkv')
    const { fs, calls } = createFakeFs({ [FILE]: JSON.stringify(written) })
    expect(await loadState({ fs, file: FILE, now })).toEqual(written)
    expect(calls.filter((call) => call.op === 'rename')).toEqual([])
  })

  it('still yields empty when the rename fails, and never throws', async () => {
    const fake = createFakeFs({ [FILE]: 'not json' })
    fake.state.failRenames = 1
    expect(await loadState({ fs: fake.fs, file: FILE, now })).toEqual(EMPTY_STATE)
  })

  it('treats an unreadable file as damaged, not as missing', async () => {
    const fake = createFakeFs({ [FILE]: '{}' })
    const unreadable: StateFs = {
      ...fake.fs,
      readFile: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    }
    expect(await loadState({ fs: unreadable, file: FILE, now })).toEqual(EMPTY_STATE)
    expect(fake.files.get(`${FILE}.corrupt-1700000000000`)).toBe('{}')
  })
})

describe('createStateStore', () => {
  it('reads the initial state', () => {
    const { store } = setup()
    expect(store.read()).toEqual(EMPTY_STATE)
    expect(store.isDirty()).toBe(false)
  })

  it('an update that changes nothing marks nothing dirty and writes nothing', async () => {
    const { store, calls, fire } = setup()
    store.update((current) => current)
    expect(store.isDirty()).toBe(false)
    fire()
    await settle()
    expect(writes(calls)).toEqual([])
  })

  it('writes nothing until the timer fires', async () => {
    const { store, calls } = setup()
    store.update(() => named('/a'))
    expect(store.isDirty()).toBe(true)
    await settle()
    expect(writes(calls)).toEqual([])
  })

  it('three updates then the timer write once, with the third change, tmp then rename', async () => {
    const { store, calls, files, fire, pending, delays } = setup()
    store.update(() => named('/one'))
    store.update(() => named('/two'))
    store.update(() => named('/three'))
    expect(pending.size).toBe(1)
    expect(delays).toEqual([2000, 2000, 2000])

    fire()
    await settle()

    const ops = calls.map((call) => ({ op: call.op, path: call.args[0] }))
    expect(ops).toEqual([
      { op: 'writeFile', path: TMP },
      { op: 'rename', path: TMP },
    ])
    expect(calls[1]!.args).toEqual([TMP, FILE])
    expect(JSON.parse(files.get(FILE) ?? 'null')).toEqual(named('/three'))
    expect(files.has(TMP)).toBe(false)
    expect(store.isDirty()).toBe(false)
  })

  it('flush with nothing dirty writes nothing', async () => {
    const { store, calls } = setup()
    await store.flush()
    expect(calls).toEqual([])
  })

  it('flush after an update writes at once, and the timer fired later writes nothing more', async () => {
    const { store, calls, fire, pending } = setup()
    store.update(() => named('/a'))
    await store.flush()
    expect(writes(calls).length).toBe(1)
    expect(pending.size).toBe(0)
    expect(store.isDirty()).toBe(false)

    fire()
    await settle()
    expect(writes(calls).length).toBe(1)
  })

  it('a rejected writeFile calls onError once, stays dirty, and the next flush retries', async () => {
    const { store, state, errors, files } = setup()
    state.failWrites = 1
    store.update(() => named('/a'))
    await store.flush()
    expect(errors.length).toBe(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(store.isDirty()).toBe(true)
    expect(files.has(FILE)).toBe(false)

    await store.flush()
    expect(errors.length).toBe(1)
    expect(store.isDirty()).toBe(false)
    expect(JSON.parse(files.get(FILE) ?? 'null')).toEqual(named('/a'))
  })

  it('a throwing onError does not stop later writes', async () => {
    const fake = createFakeFs()
    const clock = createFakeTimers()
    const reported: unknown[] = []
    const store = createStateStore({
      fs: fake.fs,
      file: FILE,
      initial: EMPTY_STATE,
      timers: clock.timers,
      debounceMs: 2000,
      onError: (error) => {
        reported.push(error)
        throw new Error('reporter broke')
      },
    })
    fake.state.failWrites = 1
    store.update(() => named('/a'))
    clock.fire()
    await settle()
    expect(reported.length).toBe(1)
    store.update(() => named('/b'))
    clock.fire()
    await settle()
    expect(JSON.parse(fake.files.get(FILE) ?? 'null')).toEqual(named('/b'))
    store.update(() => named('/c'))
    await store.flush()
    expect(JSON.parse(fake.files.get(FILE) ?? 'null')).toEqual(named('/c'))
    expect(store.isDirty()).toBe(false)
  })

  it('a refused rename leaves the old file intact and the store dirty', async () => {
    const old = JSON.stringify(named('/old'))
    const { store, state, errors, files } = setup({ [FILE]: old })
    state.failRenames = 1
    store.update(() => named('/new'))
    await store.flush()
    expect(files.get(FILE)).toBe(old)
    expect(errors.length).toBe(1)
    expect(store.isDirty()).toBe(true)
  })

  it('the old file is untouched while the temp file is being written', async () => {
    const old = JSON.stringify(named('/old'))
    const { store, files, holdNextWrite } = setup({ [FILE]: old })
    const held = holdNextWrite()
    store.update(() => named('/new'))
    const flushing = store.flush()
    await settle()
    expect(files.get(FILE)).toBe(old)
    held.release()
    await flushing
    expect(JSON.parse(files.get(FILE) ?? 'null')).toEqual(named('/new'))
  })

  it('an update during an in-flight write waits: the second write starts after the first resolves and carries the newer state', async () => {
    const { store, calls, files, holdNextWrite } = setup()
    const held = holdNextWrite()
    store.update(() => named('/first'))
    const firstFlush = store.flush()
    await settle()
    expect(writes(calls).length).toBe(1)

    store.update(() => named('/second'))
    const secondFlush = store.flush()
    await settle()
    expect(writes(calls).length).toBe(1)

    held.release()
    await Promise.all([firstFlush, secondFlush])

    const written = writes(calls).map((call) => JSON.parse(call.args[1] ?? 'null'))
    expect(written).toEqual([named('/first'), named('/second')])
    expect(JSON.parse(files.get(FILE) ?? 'null')).toEqual(named('/second'))
    expect(store.isDirty()).toBe(false)
  })

  it('an update that lands while a write is in flight keeps the store dirty after it finishes', async () => {
    const { store, holdNextWrite } = setup()
    const held = holdNextWrite()
    store.update(() => named('/first'))
    const flushing = store.flush()
    await settle()
    store.update(() => named('/second'))
    held.release()
    await flushing
    expect(store.isDirty()).toBe(true)
  })

  it('a flush while a write is in flight and nothing newer waits for it, then writes nothing more', async () => {
    const { store, calls, holdNextWrite } = setup()
    const held = holdNextWrite()
    store.update(() => named('/first'))
    const firstFlush = store.flush()
    await settle()
    const secondFlush = store.flush()
    held.release()
    await Promise.all([firstFlush, secondFlush])
    expect(writes(calls).length).toBe(1)
  })
})

describe('loadJson', () => {
  const now = () => 1700000000000
  const CONFIG = '/data/desktop-config.json'
  const load = (fs: StateFs) =>
    loadJson({ fs, file: CONFIG, now, guard: isDesktopConfig, empty: EMPTY_CONFIG })

  it('loads a valid config as written', async () => {
    const written = {
      ...EMPTY_CONFIG,
      output: { ...EMPTY_CONFIG.output, profile: 'passthrough' as const },
    }
    const { fs, calls } = createFakeFs({ [CONFIG]: JSON.stringify(written) })
    expect(await load(fs)).toEqual(written)
    expect(calls.filter((call) => call.op === 'rename')).toEqual([])
  })

  it('returns the empty value for a missing file', async () => {
    const { fs } = createFakeFs()
    expect(await load(fs)).toEqual(EMPTY_CONFIG)
  })

  it('keeps a truncated config as .corrupt-<time> and loads empty', async () => {
    const { fs, files } = createFakeFs({ [CONFIG]: '{"version":1,' })
    expect(await load(fs)).toEqual(EMPTY_CONFIG)
    expect(files.has(CONFIG)).toBe(false)
    expect(files.get(`${CONFIG}.corrupt-1700000000000`)).toBe('{"version":1,')
  })

  it('keeps valid JSON its guard rejects as .corrupt-<time> and loads empty', async () => {
    const text = JSON.stringify({ version: 1, output: { profile: 'loud' } })
    const { fs, files } = createFakeFs({ [CONFIG]: text })
    expect(await load(fs)).toEqual(EMPTY_CONFIG)
    expect(files.has(CONFIG)).toBe(false)
    expect(files.get(`${CONFIG}.corrupt-1700000000000`)).toBe(text)
  })
})

describe('createJsonStore', () => {
  it('writes a value that is not player state through its .tmp file, then renames it into place', async () => {
    const CONFIG = '/data/desktop-config.json'
    const fake = createFakeFs()
    const clock = createFakeTimers()
    const store = createJsonStore({
      fs: fake.fs,
      file: CONFIG,
      initial: EMPTY_CONFIG,
      timers: clock.timers,
      debounceMs: 0,
      onError: () => {},
    })
    const next = { ...EMPTY_CONFIG, output: { ...EMPTY_CONFIG.output, spatial: true } }
    store.update(() => next)
    expect(clock.delays).toEqual([0])
    clock.fire()
    await settle()
    expect(fake.calls.map((call) => ({ op: call.op, path: call.args[0] }))).toEqual([
      { op: 'writeFile', path: `${CONFIG}.tmp` },
      { op: 'rename', path: `${CONFIG}.tmp` },
    ])
    expect(fake.calls.at(-1)?.args[1] ?? null).toBe(CONFIG)
    expect(JSON.parse(fake.files.get(CONFIG) ?? 'null')).toEqual(next)
    expect(fake.files.has(`${CONFIG}.tmp`)).toBe(false)
    expect(store.isDirty()).toBe(false)
  })
})
