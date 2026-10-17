import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { PlayerEvent } from '@raven/core'
import {
  CONNECTION_STATUSES,
  isEngineGone,
  listenForPlayer,
  nativePlayerOver,
  PLAYER_CLOSED,
  PLAYER_NO_ANSWER,
  PLAYER_NOT_HANDED,
  PlayerRefusal,
} from '@/renderer/desktop/playerConnection'
import { APP_ORIGIN, ENGINE_STOPPED, IPC_CHANNELS, WINDOW_MESSAGE_TYPES } from '@/shared/protocol'

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

/** A real channel: the page holds `port1`, the test plays main on `port2`. */
const channel = () => {
  const { port1, port2 } = new MessageChannel()
  const received: unknown[] = []
  port2.addEventListener('message', (event) => {
    received.push(event.data)
  })
  port2.start()
  return {
    page: port1,
    main: port2,
    received,
    fromMain: (data: unknown) => port2.postMessage(data),
  }
}

let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>

beforeEach(() => {
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('nativePlayerOver', () => {
  it('posts each command with an increasing id and resolves on its reply', async () => {
    const { page, fromMain, received } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const played = player.send({ type: 'play' })
    const paused = player.send({ type: 'pause' })
    await wait()
    expect(received).toEqual([
      { id: 1, command: { type: 'play' } },
      { id: 2, command: { type: 'pause' } },
    ])
    fromMain({ id: 2, ok: true })
    fromMain({ id: 1, ok: true })
    expect(await played).toBeUndefined()
    expect(await paused).toBeUndefined()
    player.close()
  })

  it('rejects with the refusal main gave', async () => {
    const { page, fromMain } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const loading = player.send({ type: 'stats' })
    await wait()
    fromMain({ id: 1, ok: false, reason: 'refused', message: 'raven player could not do that.' })
    await expect(loading).rejects.toThrow('raven player could not do that.')
    player.close()
  })

  it('rejects when main does not answer in time, and drops the late reply', async () => {
    const { page, fromMain } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 10 })
    await expect(player.send({ type: 'play' })).rejects.toThrow(PLAYER_NO_ANSWER)
    fromMain({ id: 1, ok: true })
    await wait()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    player.close()
  })

  it('drops a reply to a request it never sent without settling another', async () => {
    const { page, fromMain } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const states: string[] = []
    player.send({ type: 'play' }).then(
      () => states.push('resolved'),
      () => states.push('rejected'),
    )
    await wait()
    fromMain({ id: 9, ok: true })
    await wait()
    expect(states).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    fromMain({ id: 1, ok: true })
    await wait()
    expect(states).toEqual(['resolved'])
    player.close()
  })

  it('hands well formed events to subscribers and drops the rest', async () => {
    const { page, fromMain } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const heard: PlayerEvent[] = []
    const unsubscribe = player.subscribe((event) => heard.push(event))
    fromMain({ type: 'time', time: 3 })
    fromMain({ type: 'time', time: 'x' })
    fromMain({ type: 'run', args: ['quit'] })
    await wait()
    expect(heard).toEqual([{ type: 'time', time: 3 }])
    expect(warnSpy).toHaveBeenCalledTimes(2)
    unsubscribe()
    fromMain({ type: 'ended' })
    await wait()
    expect(heard).toEqual([{ type: 'time', time: 3 }])
    player.close()
  })

  it('close rejects what is pending and every later send', async () => {
    const { page } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const pending = player.send({ type: 'play' })
    player.close()
    player.close()
    await expect(pending).rejects.toThrow(PLAYER_CLOSED)
    await expect(player.send({ type: 'pause' })).rejects.toThrow(PLAYER_CLOSED)
  })

  it('main closing its end rejects what is pending', async () => {
    const { page, main } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 1000 })
    const pending = player.send({ type: 'play' })
    await wait()
    main.close()
    await expect(pending).rejects.toThrow(PLAYER_CLOSED)
  })
})

const portMessage = ({
  data,
  origin = APP_ORIGIN,
  source = window,
  ports = [],
}: {
  data: unknown
  origin?: string
  source?: Window | null
  ports?: MessagePort[]
}) => {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source, ports }))
}

const NATIVE = { type: WINDOW_MESSAGE_TYPES.playerPort, connection: { status: 'native' } } as const
const UNAVAILABLE = {
  type: WINDOW_MESSAGE_TYPES.playerPort,
  connection: { status: 'unavailable', message: 'The video engine is off for this run.' },
} as const

const listening: Array<ReturnType<typeof listenForPlayer>> = []

/** Each test's listener goes when it ends, so it never takes the next test's messages. */
const listen = (options: { waitMs?: number } = {}) => {
  const connections = listenForPlayer({ target: window, origin: APP_ORIGIN, ...options })
  listening.push(connections)
  return connections
}

afterEach(() => {
  listening.splice(0).forEach((connections) => connections.dispose())
})

describe('listenForPlayer', () => {
  it('starts waiting and ignores what did not come from the preload', () => {
    const connections = listen()
    const heard: string[] = []
    connections.subscribe(() => heard.push(connections.read().status))
    const { page } = channel()
    portMessage({ data: NATIVE, origin: 'https://example.com', ports: [page] })
    portMessage({ data: NATIVE, source: null, ports: [page] })
    portMessage({ data: { ...NATIVE, type: IPC_CHANNELS.player }, ports: [page] })
    portMessage({ data: NATIVE, ports: [] })
    portMessage({ data: NATIVE, ports: [page, channel().page] })
    portMessage({
      data: { type: WINDOW_MESSAGE_TYPES.playerPort, connection: { status: 'unavailable' } },
    })
    expect(connections.read()).toEqual({ status: 'waiting' })
    expect(heard).toEqual([])
  })

  it('becomes native over the port', async () => {
    const connections = listen()
    const heard: string[] = []
    connections.subscribe(() => heard.push(connections.read().status))
    const first = channel()
    portMessage({ data: NATIVE, ports: [first.page] })
    const native = connections.read()
    if (native.status !== CONNECTION_STATUSES.native)
      throw new Error(`expected native, got ${native.status}`)
    const played = native.player.send({ type: 'play' })
    await wait()
    expect(first.received).toEqual([{ id: 1, command: { type: 'play' } }])
    first.fromMain({ id: 1, ok: true })
    expect(await played).toBeUndefined()
    expect(heard).toEqual(['native'])
  })

  it('keeps its first choice: a later hand-over is ignored and its port closed', async () => {
    const connections = listen()
    const heard: string[] = []
    connections.subscribe(() => heard.push(connections.read().status))
    const first = channel()
    const second = channel()
    const closed: string[] = []
    first.main.addEventListener('close', () => closed.push('first'))
    second.main.addEventListener('close', () => closed.push('second'))
    portMessage({ data: NATIVE, ports: [first.page] })
    const native = connections.read()
    portMessage({ data: NATIVE, ports: [second.page] })
    portMessage({ data: UNAVAILABLE })
    await wait()
    expect(connections.read()).toBe(native)
    expect(closed).toEqual(['second'])
    expect(heard).toEqual(['native'])
  })

  it('keeps the html engine when the hand-over comes after its choice', async () => {
    const connections = listen()
    portMessage({ data: UNAVAILABLE })
    const late = channel()
    const closed: string[] = []
    late.main.addEventListener('close', () => closed.push('late'))
    portMessage({ data: NATIVE, ports: [late.page] })
    await wait()
    expect(connections.read()).toEqual({
      status: 'unavailable',
      message: 'The video engine is off for this run.',
    })
    expect(closed).toEqual(['late'])
  })

  it('ignores a hand-over that comes after the wait ran out', async () => {
    const connections = listen({ waitMs: 5 })
    await wait(20)
    const late = channel()
    const closed: string[] = []
    late.main.addEventListener('close', () => closed.push('late'))
    portMessage({ data: NATIVE, ports: [late.page] })
    await wait()
    expect(connections.read()).toEqual({ status: 'unavailable', message: PLAYER_NOT_HANDED })
    expect(closed).toEqual(['late'])
  })

  it('goes unavailable when the video engine stops, and closes the port', async () => {
    const connections = listen()
    const heard: string[] = []
    connections.subscribe(() => heard.push(connections.read().status))
    const { page, main, fromMain } = channel()
    const closed: string[] = []
    main.addEventListener('close', () => closed.push('main'))
    portMessage({ data: NATIVE, ports: [page] })
    fromMain({ type: 'error', reason: 'decode', message: 'raven player could not keep playing.' })
    await wait()
    expect(connections.read().status).toBe('native')
    fromMain({ type: 'error', reason: 'engine', message: ENGINE_STOPPED })
    await wait()
    expect(connections.read()).toEqual({ status: 'unavailable', message: ENGINE_STOPPED })
    expect(closed).toEqual(['main'])
    expect(heard).toEqual(['native', 'unavailable'])
  })

  it('goes unavailable when main answers that the video engine stopped', async () => {
    const connections = listen()
    const { page, fromMain } = channel()
    portMessage({ data: NATIVE, ports: [page] })
    const native = connections.read()
    if (native.status !== CONNECTION_STATUSES.native)
      throw new Error(`expected native, got ${native.status}`)
    const refused = native.player.send({ type: 'play' })
    const loading = native.player.send({ type: 'pause' })
    await wait()
    fromMain({ id: 1, ok: false, reason: 'refused', message: 'raven player could not do that.' })
    await expect(refused).rejects.toThrow('raven player could not do that.')
    expect(connections.read().status).toBe('native')
    fromMain({ id: 2, ok: false, reason: 'engine', message: ENGINE_STOPPED })
    await expect(loading).rejects.toThrow(ENGINE_STOPPED)
    expect(connections.read()).toEqual({ status: 'unavailable', message: ENGINE_STOPPED })
  })

  it('reads the reason, never the words, to tell the engine stopped', async () => {
    const connections = listen()
    const { page, fromMain } = channel()
    portMessage({ data: NATIVE, ports: [page] })
    const native = connections.read()
    if (native.status !== CONNECTION_STATUSES.native)
      throw new Error(`expected native, got ${native.status}`)
    const worded = native.player.send({ type: 'play' })
    const gone = native.player.send({ type: 'pause' })
    await wait()
    fromMain({ id: 1, ok: false, reason: 'refused', message: ENGINE_STOPPED })
    await expect(worded).rejects.toThrow(ENGINE_STOPPED)
    expect(connections.read().status).toBe('native')
    fromMain({ id: 2, ok: false, reason: 'engine', message: 'Gone.' })
    const refusal = await gone.then(
      () => null,
      (error: unknown) => error,
    )
    expect(isEngineGone(refusal)).toBe(true)
    expect(connections.read()).toEqual({ status: 'unavailable', message: 'Gone.' })
  })

  it('counts a timeout as a refusal that leaves the engine in place', async () => {
    const { page } = channel()
    const player = nativePlayerOver({ port: page, timeoutMs: 5 })
    const refusal = await player.send({ type: 'play' }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refusal).toBeInstanceOf(PlayerRefusal)
    expect(isEngineGone(refusal)).toBe(false)
    expect(isEngineGone(new Error(ENGINE_STOPPED))).toBe(false)
    player.close()
  })

  it('goes unavailable when its port is closed under it', async () => {
    const connections = listen()
    const { page, main } = channel()
    portMessage({ data: NATIVE, ports: [page] })
    const native = connections.read()
    if (native.status !== CONNECTION_STATUSES.native)
      throw new Error(`expected native, got ${native.status}`)
    main.close()
    await wait()
    await expect(native.player.send({ type: 'play' })).rejects.toThrow(PLAYER_CLOSED)
    expect(connections.read()).toEqual({ status: 'unavailable', message: PLAYER_CLOSED })
  })

  it('gives up waiting after waitMs, so the page plays through the html engine', async () => {
    const connections = listen({ waitMs: 5 })
    const heard: string[] = []
    connections.subscribe(() => heard.push(connections.read().status))
    await wait(20)
    expect(connections.read()).toEqual({ status: 'unavailable', message: PLAYER_NOT_HANDED })
    expect(heard).toEqual(['unavailable'])
  })

  it('dispose stops listening and waiting', async () => {
    const connections = listen({ waitMs: 5 })
    connections.dispose()
    const { page } = channel()
    portMessage({ data: NATIVE, ports: [page] })
    await wait(20)
    expect(connections.read()).toEqual({ status: 'waiting' })
  })

  it('a hand-over in time stops the wait', async () => {
    const connections = listen({ waitMs: 20 })
    const { page } = channel()
    portMessage({ data: NATIVE, ports: [page] })
    await wait(40)
    expect(connections.read().status).toBe('native')
  })
})
