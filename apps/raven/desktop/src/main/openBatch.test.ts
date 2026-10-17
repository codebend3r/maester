import { describe, expect, it } from 'bun:test'
import { createOpenBatch, eventForOpen, launchPaths, pathsFromArgv } from '@/main/openBatch'
import type { Timers } from '@/main/stateStore'
import { MAX_QUEUE } from '@/shared/protocol'

const FILM = '00000000-0000-4000-8000-000000000001'
const NEXT = '00000000-0000-4000-8000-000000000002'

const createFakeTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>()
  const counter = { next: 1 }
  const timers: Timers = {
    set: (run, ms) => {
      const handle = counter.next
      counter.next += 1
      pending.set(handle, { run, ms })
      return handle
    },
    clear: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
  }
  const fire = () => {
    const due = [...pending.entries()]
    pending.clear()
    due.forEach(([, timer]) => timer.run())
  }
  return { timers, fire, pending }
}

const setup = () => {
  const fake = createFakeTimers()
  const delivered: string[][] = []
  const batch = createOpenBatch<string>({
    delayMs: 100,
    timers: fake.timers,
    deliver: (items) => {
      delivered.push(items)
    },
  })
  return { ...fake, delivered, batch }
}

describe('createOpenBatch', () => {
  it('holds pushes until ready, then delivers them as one batch', () => {
    const { batch, delivered, fire } = setup()
    batch.push('a')
    batch.push('b')
    batch.push('c')
    fire()
    expect(delivered).toEqual([])

    batch.ready()
    expect(delivered).toEqual([['a', 'b', 'c']])
  })

  it('delivers nothing on ready when nothing was pushed', () => {
    const { batch, delivered } = setup()
    batch.ready()
    expect(delivered).toEqual([])
  })

  it('groups pushes after ready that arrive within the delay, in push order', () => {
    const { batch, delivered, fire, pending } = setup()
    batch.ready()
    batch.push('a')
    batch.push('b')
    expect(delivered).toEqual([])
    expect([...pending.values()].map((timer) => timer.ms)).toEqual([100])

    fire()
    expect(delivered).toEqual([['a', 'b']])

    batch.push('c')
    fire()
    expect(delivered).toEqual([['a', 'b'], ['c']])
  })

  it('treats a second ready (a renderer reload) as harmless', () => {
    const { batch, delivered, fire } = setup()
    batch.push('a')
    batch.ready()
    batch.ready()
    fire()
    expect(delivered).toEqual([['a']])
  })

  it('caps a held batch at the first item plus a full queue', () => {
    const { batch, delivered } = setup()
    Array.from({ length: 5000 }, (_, index) => `/m/${index}.mkv`).forEach((item) =>
      batch.push(item),
    )
    batch.ready()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toHaveLength(MAX_QUEUE + 1)
    const [held = []] = delivered
    expect(held[0]).toBe('/m/0.mkv')
    expect(held.at(-1)).toBe(`/m/${MAX_QUEUE}.mkv`)
  })
})

describe('pathsFromArgv', () => {
  it('keeps only absolute paths after the executable, skipping switches', () => {
    expect(
      pathsFromArgv([
        '/Applications/raven player.app/Contents/MacOS/raven player',
        '--inspect',
        '/m/Film.mkv',
        '.',
        'relative.mkv',
      ]),
    ).toEqual(['/m/Film.mkv'])
  })

  it('never takes the executable itself', () => {
    expect(pathsFromArgv(['/usr/local/bin/electron'])).toEqual([])
  })
})

describe('launchPaths', () => {
  it('skips the app folder Electron is given when run unpackaged', () => {
    expect(
      launchPaths({
        argv: ['/usr/local/bin/electron', '/src/apps/raven/desktop', '/m/Film.mkv'],
        isDefaultApp: true,
      }),
    ).toEqual(['/m/Film.mkv'])
  })

  it('keeps every path after a packaged executable', () => {
    expect(
      launchPaths({
        argv: ['/Applications/raven player.app/Contents/MacOS/raven player', '/m/Film.mkv'],
        isDefaultApp: false,
      }),
    ).toEqual(['/m/Film.mkv'])
  })
})

describe('eventForOpen', () => {
  it('turns a play reply into a play event', () => {
    expect(eventForOpen({ type: 'play', target: { fileId: FILM, queue: [NEXT] } })).toEqual({
      type: 'play',
      target: { fileId: FILM, queue: [NEXT] },
    })
  })

  it('turns a refusal into a notice', () => {
    expect(
      eventForOpen({ type: 'refused', message: 'raven player opens video files only.' }),
    ).toEqual({ type: 'notice', message: 'raven player opens video files only.' })
  })

  it('turns a server title into a playServer event', () => {
    const target = { serverId: NEXT, mediaId: 7, at: 30, next: [8] }
    expect(eventForOpen({ type: 'playServer', target })).toEqual({ type: 'playServer', target })
  })

  it('turns a download ask into the event that shows it', () => {
    const ask = {
      askId: FILM,
      serverId: NEXT,
      serverName: 'Vhagar',
      autoDelete: false,
      status: { kind: 'locked' },
    } as const
    expect(eventForOpen({ type: 'downloadAsk', ask })).toEqual({ type: 'downloadAsk', ask })
  })

  it('sends nothing for a reply that opens nothing', () => {
    expect(eventForOpen({ type: 'done' })).toBeNull()
    expect(eventForOpen({ type: 'downloads', downloads: [], autoDeleteDefault: false })).toBeNull()
    expect(eventForOpen({ type: 'space', space: { free: 1, total: 2, used: 0 } })).toBeNull()
    expect(eventForOpen({ type: 'servers', servers: [] })).toBeNull()
    expect(eventForOpen({ type: 'serverReply', status: 200, body: '{}' })).toBeNull()
    expect(eventForOpen({ type: 'serverUnreachable', message: 'gone' })).toBeNull()
    expect(
      eventForOpen({
        type: 'output',
        output: { profile: 'pcm', device: 'auto', passthrough: [], spatial: false },
        devices: [],
        isEngineReady: false,
      }),
    ).toBeNull()
  })
})
