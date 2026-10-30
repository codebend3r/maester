import { describe, expect, it } from 'bun:test'
import { SERVER_STREAM_EVENTS, SERVER_STREAM_STATES } from '@raven/ui/headless'

import {
  APP_STATES,
  type AppActivity,
  type NativeEventSource,
  RECONNECT_MS,
  type Schedule,
  type SourceRequest,
  eventSourceFor,
  isForegroundState,
} from '@/servers/eventSource'

const EVENTS_URL = 'http://nas:8080/api/events'

type Heard = { type: string; listener: Parameters<NativeEventSource['addEventListener']>[1] }

type Made = SourceRequest & { heard: Heard[]; isClosed: boolean }

/** Event sources that record how each was made and what listens, and can be made to speak. */
const fakeSources = () => {
  const made: Made[] = []
  const createSource = ({ url, headers }: SourceRequest): NativeEventSource => {
    const heard: Heard[] = []
    const source: Made = { url, headers, heard, isClosed: false }
    made.push(source)
    return {
      addEventListener: (type, listener) => {
        heard.push({ type, listener })
      },
      close: () => {
        source.isClosed = true
      },
    }
  }
  type SayProps = { source: Made | undefined; type: string; data?: string }

  const say = ({ source, type, data }: SayProps) =>
    (source?.heard ?? [])
      .filter((entry) => entry.type === type)
      .forEach(({ listener }) => listener({ type, data }))
  const open = () => made.filter(({ isClosed }) => !isClosed)
  return { made, createSource, say, open }
}

/** A clock that runs what is scheduled only when told, and records each wait. */
const fakeClock = () => {
  const waits: Array<{ ms: number; run: () => void; isCancelled: boolean }> = []
  const schedule: Schedule = ({ run, ms }) => {
    const wait = { ms, run, isCancelled: false }
    waits.push(wait)
    return () => {
      wait.isCancelled = true
    }
  }
  const pending = () => waits.filter(({ isCancelled }) => !isCancelled)
  const runNext = () => {
    const [next] = pending()
    if (next === undefined) throw new Error('Nothing is waiting')
    next.isCancelled = true
    next.run()
  }
  return { waits, schedule, pending, runNext }
}

/** The app in the foreground, which a test can send to the background and back. */
const fakeApp = () => {
  const state = { isForeground: true, onChange: (_isForeground: boolean) => {}, isWatched: false }
  const app: AppActivity = {
    isForeground: () => state.isForeground,
    watch: (onChange) => {
      state.onChange = onChange
      state.isWatched = true
      return () => {
        state.isWatched = false
      }
    },
  }
  const become = (isForeground: boolean) => {
    state.isForeground = isForeground
    state.onChange(isForeground)
  }
  return { app, become, state }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

const setUp = () => {
  const sources = fakeSources()
  const clock = fakeClock()
  const app = fakeApp()
  const open = eventSourceFor({
    headersFor: async (url) => ({ cookie: `for ${url}` }),
    createSource: sources.createSource,
    schedule: clock.schedule,
    app: app.app,
  })
  return { sources, clock, app, open }
}

describe('eventSourceFor', () => {
  it('opens the stream with the headers for its address, once they are read', async () => {
    const { sources, open } = setUp()
    open(EVENTS_URL)
    expect(sources.made).toHaveLength(0)
    await settled()
    expect(sources.made.map(({ url, headers }) => ({ url, headers }))).toEqual([
      { url: EVENTS_URL, headers: { cookie: `for ${EVENTS_URL}` } },
    ])
  })

  it('hands each listener what the stream says, as it says it', async () => {
    const { sources, open } = setUp()
    const source = open(EVENTS_URL)
    const said: unknown[] = []
    source.addEventListener(SERVER_STREAM_EVENTS.message, ({ data }) => said.push(data))
    source.addEventListener(SERVER_STREAM_EVENTS.open, ({ data }) => said.push(['open', data]))
    await settled()
    const [first] = sources.made
    sources.say({ source: first, type: SERVER_STREAM_EVENTS.open })
    sources.say({ source: first, type: SERVER_STREAM_EVENTS.message, data: '{"type":"library"}' })
    expect(said).toEqual([['open', undefined], '{"type":"library"}'])
  })

  it('opens again after an error, waiting longer each time, and from the start once one has held', async () => {
    const { sources, clock, open } = setUp()
    const source = open(EVENTS_URL)
    const errors: unknown[] = []
    source.addEventListener(SERVER_STREAM_EVENTS.error, () => errors.push('error'))
    await settled()

    sources.say({ source: sources.made[0], type: SERVER_STREAM_EVENTS.error })
    expect(errors).toHaveLength(1)
    expect(sources.open()).toHaveLength(0)
    expect(clock.pending().map(({ ms }) => ms)).toEqual([RECONNECT_MS.first])
    clock.runNext()
    await settled()
    expect(sources.made).toHaveLength(2)

    sources.say({ source: sources.made[1], type: SERVER_STREAM_EVENTS.error })
    clock.runNext()
    await settled()
    sources.say({ source: sources.made[2], type: SERVER_STREAM_EVENTS.error })
    expect(clock.pending().map(({ ms }) => ms)).toEqual([4 * RECONNECT_MS.first])
    clock.runNext()
    await settled()

    sources.say({ source: sources.made[3], type: SERVER_STREAM_EVENTS.open })
    expect(clock.pending().map(({ ms }) => ms)).toEqual([RECONNECT_MS.held])
    clock.runNext()
    sources.say({ source: sources.made[3], type: SERVER_STREAM_EVENTS.error })
    expect(clock.pending().map(({ ms }) => ms)).toEqual([RECONNECT_MS.first])
    expect(sources.open()).toHaveLength(0)
  })

  it('keeps waiting longer when each connection is reset as soon as it opens', async () => {
    const { sources, clock, open } = setUp()
    open(EVENTS_URL)
    await settled()
    await [0, 1, 2].reduce(async (previous: Promise<unknown>, index) => {
      await previous
      const source = sources.made[index]
      sources.say({ source, type: SERVER_STREAM_EVENTS.open })
      sources.say({ source, type: SERVER_STREAM_EVENTS.error })
      clock.runNext()
      await settled()
    }, Promise.resolve())
    sources.say({ source: sources.made[3], type: SERVER_STREAM_EVENTS.error })
    expect(clock.pending().map(({ ms }) => ms)).toEqual([8 * RECONNECT_MS.first])
  })

  it('never waits longer than the most', async () => {
    const { sources, clock, open } = setUp()
    open(EVENTS_URL)
    await settled()
    await Array.from({ length: 8 }).reduce(async (previous: Promise<unknown>) => {
      await previous
      sources.say({ source: sources.made.at(-1), type: SERVER_STREAM_EVENTS.error })
      clock.runNext()
      await settled()
    }, Promise.resolve())
    expect(clock.waits.map(({ ms }) => ms).at(-1)).toBe(RECONNECT_MS.most)
    expect(sources.open()).toHaveLength(1)
  })

  it('stops for good on close: no connection, no wait, no app watch', async () => {
    const { sources, clock, app, open } = setUp()
    const early = open(EVENTS_URL)
    early.close()
    await settled()
    expect(sources.made).toHaveLength(0)

    const late = open(EVENTS_URL)
    await settled()
    sources.say({ source: sources.made[0], type: SERVER_STREAM_EVENTS.error })
    expect(late.readyState).toBe(SERVER_STREAM_STATES.connecting)
    late.close()
    expect(late.readyState).toBe(SERVER_STREAM_STATES.closed)
    expect(clock.pending()).toHaveLength(0)
    app.become(true)
    await settled()
    expect(sources.made).toHaveLength(1)
    expect(sources.open()).toHaveLength(0)
    expect(app.state.isWatched).toBe(false)
  })

  it('closes in the background and opens once on the way back, as a reconnect', async () => {
    const { sources, open, app } = setUp()
    const source = open(EVENTS_URL)
    const heard: string[] = []
    source.addEventListener(SERVER_STREAM_EVENTS.error, () => heard.push('error'))
    await settled()

    app.become(false)
    expect(sources.open()).toHaveLength(0)
    expect(heard).toEqual(['error'])

    app.become(true)
    app.become(true)
    await settled()
    expect(sources.made).toHaveLength(2)
    expect(sources.open()).toHaveLength(1)
  })

  it('waits for the foreground before it first opens, and drops a wait on the way out', async () => {
    const { sources, clock, app, open } = setUp()
    app.state.isForeground = false
    open(EVENTS_URL)
    await settled()
    expect(sources.made).toHaveLength(0)

    app.become(true)
    await settled()
    sources.say({ source: sources.made[0], type: SERVER_STREAM_EVENTS.error })
    app.become(false)
    expect(clock.pending()).toHaveLength(0)
  })

  it('treats headers it cannot read as an error, and tries again', async () => {
    const sources = fakeSources()
    const clock = fakeClock()
    const errors: unknown[] = []
    const source = eventSourceFor({
      headersFor: async () => Promise.reject(new Error('keychain')),
      createSource: sources.createSource,
      schedule: clock.schedule,
      app: fakeApp().app,
    })(EVENTS_URL)
    source.addEventListener(SERVER_STREAM_EVENTS.error, () => errors.push('error'))
    await settled()
    expect(errors).toHaveLength(1)
    expect(clock.pending().map(({ ms }) => ms)).toEqual([RECONNECT_MS.first])
  })
})

describe('isForegroundState', () => {
  it('keeps the stream through inactive, as when Control Center passes over the app', () => {
    expect(isForegroundState(APP_STATES.active)).toBe(true)
    expect(isForegroundState(APP_STATES.inactive)).toBe(true)
  })

  it('closes it in the background', () => {
    expect(isForegroundState(APP_STATES.background)).toBe(false)
  })
})
