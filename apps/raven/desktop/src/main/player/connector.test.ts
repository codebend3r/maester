import { describe, expect, mock, test } from 'bun:test'
import { createConnector, OPEN_MS } from '@/main/player/connector'
import { ENGINE_MESSAGES, type OpenedEngine } from '@/main/player/engine'
import type { PlayerService } from '@/main/player/playerService'
import { fakePort, fakeService, fakeTimers } from '@/main/test/playerFakes'
import type { PlayerConnectionStatus } from '@/shared/protocol'

type Engine = { service: PlayerService }
/** Stands in for Electron's `MessagePortMain`: the connector passes it on without knowing its type. */
type RemotePort = { name: string }
type Posted = { connection: PlayerConnectionStatus; ports: RemotePort[] }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const setup = ({
  engine,
}: {
  engine?: (service: ReturnType<typeof fakeService>) => () => Promise<OpenedEngine<Engine>>
} = {}) => {
  const log: string[] = []
  const service = fakeService({ log })
  const ports: ReturnType<typeof fakePort>[] = []
  const posted: Posted[] = []
  const warn = mock((_message: string) => {})
  const clock = fakeTimers()
  const connector = createConnector({
    engine:
      engine?.(service) ??
      (async () => ({ status: 'native', engine: { service: service.service } })),
    channel: () => {
      const port = fakePort({ log })
      ports.push(port)
      return { local: port.port, remote: { name: `remote-${ports.length}` } }
    },
    post: (input) => {
      log.push('post')
      posted.push(input)
    },
    warn,
    timers: clock.timers,
  })
  return { connector, service, ports, posted, log, warn, clock }
}

const remote = (name: string): RemotePort => ({ name })

describe('createConnector', () => {
  test('connect hands the page one port over a started local end', async () => {
    const { connector, ports, posted } = setup()
    await connector.connect()
    expect(posted).toEqual([{ connection: { status: 'native' }, ports: [remote('remote-1')] }])
    expect(ports).toHaveLength(1)
    expect(ports[0]!.flags.isStarted).toBe(true)
  })

  test('the local end carries commands to the service', async () => {
    const { connector, ports, service } = setup()
    await connector.connect()
    ports[0]!.send({ id: 1, command: { type: 'play' } })
    await settle()
    expect(service.handled).toEqual([{ type: 'play' }])
    expect(ports[0]!.posted).toEqual([{ id: 1, ok: true }])
  })

  test('a second connect closes the first port and stops playback before posting', async () => {
    const { connector, ports, posted, service, log } = setup()
    await connector.connect()
    await connector.connect()
    expect(ports[0]!.flags.closes).toBe(1)
    expect(service.flags.resets).toBe(1)
    expect(log).toEqual(['post', 'reset', 'close', 'post'])
    expect(posted.at(-1)).toEqual({ connection: { status: 'native' }, ports: [remote('remote-2')] })
    service.emit({ type: 'time', time: 3 })
    expect(ports[0]!.posted).toEqual([])
    expect(ports[1]!.posted).toEqual([{ type: 'time', time: 3 }])
  })

  test('an unavailable engine is posted with its message and no port', async () => {
    const { connector, ports, posted } = setup({
      engine: () => async () => ({ status: 'unavailable', message: ENGINE_MESSAGES.off }),
    })
    await connector.connect()
    expect(posted).toEqual([
      { connection: { status: 'unavailable', message: ENGINE_MESSAGES.off }, ports: [] },
    ])
    expect(ports).toEqual([])
  })

  test('an engine that throws is posted as unavailable and warned', async () => {
    const { connector, posted, warn } = setup({
      engine: () => () => Promise.reject(new Error('no addon')),
    })
    await connector.connect()
    expect(posted).toEqual([
      { connection: { status: 'unavailable', message: ENGINE_MESSAGES.unavailable }, ports: [] },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('a connect overtaken while the engine opens posts nothing', async () => {
    const opening: { open: () => void } = { open: () => {} }
    const { connector, ports, posted } = setup({
      engine: (service) => {
        const opened = new Promise<OpenedEngine<Engine>>((resolve) => {
          opening.open = () => resolve({ status: 'native', engine: { service: service.service } })
        })
        return () => opened
      },
    })
    const first = connector.connect()
    const second = connector.connect()
    opening.open()
    await Promise.all([first, second])
    expect(ports).toHaveLength(1)
    expect(posted).toEqual([{ connection: { status: 'native' }, ports: [remote('remote-1')] }])
  })

  test('disconnect closes the port and stops playback; a pending connect then posts nothing', async () => {
    const { connector, ports, posted, service } = setup()
    await connector.connect()
    connector.disconnect()
    connector.disconnect()
    expect(ports[0]!.flags.closes).toBe(1)
    expect(service.flags.resets).toBe(1)
    const pending = connector.connect()
    connector.disconnect()
    await pending
    expect(posted).toHaveLength(1)
  })

  test('a post that throws closes the port it made', async () => {
    const service = fakeService()
    const ports: ReturnType<typeof fakePort>[] = []
    const warn = mock((_message: string) => {})
    const connector = createConnector({
      engine: async () => ({ status: 'native', engine: { service: service.service } }),
      channel: () => {
        const port = fakePort()
        ports.push(port)
        return { local: port.port, remote: remote('remote') }
      },
      post: () => {
        throw new Error('window gone')
      },
      warn,
      timers: fakeTimers().timers,
    })
    await connector.connect()
    expect(ports[0]!.flags.closes).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('an engine that has not opened within OPEN_MS is posted as unavailable and warned', async () => {
    const { connector, posted, warn, clock, ports } = setup({
      engine: () => () => new Promise<OpenedEngine<Engine>>(() => undefined),
    })
    const connecting = connector.connect()
    await settle()
    expect(posted).toEqual([])
    expect([...clock.pending.values()].map(({ ms }) => ms)).toEqual([OPEN_MS])
    clock.fire()
    await connecting
    expect(posted).toEqual([
      { connection: { status: 'unavailable', message: ENGINE_MESSAGES.unavailable }, ports: [] },
    ])
    expect(ports).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('an engine that opens after the deadline hands that page nothing more', async () => {
    const opening: { open: () => void } = { open: () => {} }
    const { connector, posted, clock, ports } = setup({
      engine: (service) => {
        const opened = new Promise<OpenedEngine<Engine>>((resolve) => {
          opening.open = () => resolve({ status: 'native', engine: { service: service.service } })
        })
        return () => opened
      },
    })
    const connecting = connector.connect()
    clock.fire()
    await connecting
    opening.open()
    await settle()
    expect(posted).toHaveLength(1)
    expect(ports).toEqual([])
    // The next page load finds the engine open.
    await connector.connect()
    expect(posted.at(-1)).toEqual({ connection: { status: 'native' }, ports: [remote('remote-1')] })
  })

  test('an engine that opens in time clears its deadline', async () => {
    const { connector, clock } = setup()
    await connector.connect()
    expect(clock.pending.size).toBe(0)
  })
})
