import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  ENGINE_STOPPED,
  PAGE_ORIGIN,
  PLAYER_CONNECTION_STATUSES,
  PLAYER_ERROR_REASONS,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'
import { afterEach, describe, expect, it } from 'bun:test'
import { AUDIO_NOT_HANDED, listenForAudio } from '@/desktop/audioConnection'
import { CONNECTION_STATUSES } from '@/desktop/portConnection'

const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

const NATIVE = {
  type: WINDOW_MESSAGE_TYPES.audioPort,
  connection: { status: PLAYER_CONNECTION_STATUSES.native },
}

const stops: Array<() => void> = []

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
})

const listen = (waitMs?: number) => {
  const connections = listenForAudio({ target: window, origin: PAGE_ORIGIN, waitMs })
  stops.push(connections.dispose)
  return connections
}

type PortMessageProps = { data: unknown; ports?: MessagePort[] }

const portMessage = ({ data, ports = [] }: PortMessageProps) =>
  window.dispatchEvent(
    new MessageEvent('message', { data, origin: PAGE_ORIGIN, source: window, ports }),
  )

describe('listenForAudio', () => {
  it('takes only the music engine’s hand-over, not the player’s', () => {
    const connections = listen()
    const { port1 } = new MessageChannel()
    portMessage({ data: { ...NATIVE, type: WINDOW_MESSAGE_TYPES.playerPort }, ports: [port1] })
    expect(connections.read()).toEqual({ status: CONNECTION_STATUSES.waiting })
    portMessage({ data: NATIVE, ports: [port1] })
    expect(connections.read().status).toBe(CONNECTION_STATUSES.native)
  })

  it('sends commands over the port and hears the engine’s events', async () => {
    const connections = listen()
    const { port1, port2 } = new MessageChannel()
    const received: unknown[] = []
    port2.addEventListener('message', (event) => received.push(event.data))
    port2.start()
    portMessage({ data: NATIVE, ports: [port1] })
    const connection = connections.read()
    if (connection.status !== CONNECTION_STATUSES.native) throw new Error('expected native')
    const heard: unknown[] = []
    connection.player.subscribe((event) => heard.push(event))
    const played = connection.player.send({ type: AUDIO_COMMANDS.play })
    await wait()
    expect(received).toEqual([{ id: 1, command: { type: AUDIO_COMMANDS.play } }])
    port2.postMessage({ id: 1, ok: true })
    port2.postMessage({ type: AUDIO_EVENTS.advanced })
    port2.postMessage({ type: 'rewind' })
    await played
    await wait()
    expect(heard).toEqual([{ type: AUDIO_EVENTS.advanced }])
  })

  it('is lost once main says the music engine stopped', async () => {
    const connections = listen()
    const { port1, port2 } = new MessageChannel()
    portMessage({ data: NATIVE, ports: [port1] })
    port2.postMessage({
      type: AUDIO_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: ENGINE_STOPPED,
    })
    await wait()
    expect(connections.read()).toEqual({
      status: CONNECTION_STATUSES.lost,
      message: ENGINE_STOPPED,
    })
  })

  it('gives up waiting with its own words', async () => {
    const connections = listen(5)
    await wait(20)
    expect(connections.read()).toEqual({
      status: CONNECTION_STATUSES.unavailable,
      message: AUDIO_NOT_HANDED,
    })
  })
})
