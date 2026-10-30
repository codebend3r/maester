import { describe, expect, mock, test } from 'bun:test'
import { isPlayerReply, isPlayerRequest, PLAYER_COMMANDS } from '@raven/core'
import { connectPort, MAX_PENDING, UNKNOWN_COMMAND } from '@/main/player/playerPort'
import { fakePort, fakeService } from '@/main/test/playerFakes'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

type ConnectProps = { service?: ReturnType<typeof fakeService> }

const connect = ({ service = fakeService() }: ConnectProps = {}) => {
  const port = fakePort()
  const warn = mock((_message: string) => {})
  const connection = connectPort({
    port: port.port,
    service: service.service,
    isRequest: isPlayerRequest,
    warn,
  })
  return { port, service, warn, connection }
}

describe('connectPort', () => {
  test('starts the port and answers a narrowed command', async () => {
    const { port, service } = connect()
    expect(port.flags.isStarted).toBe(true)
    port.send({ id: 1, command: { type: 'play' } })
    await settle()
    expect(service.handled).toEqual([{ type: 'play' }])
    expect(port.posted).toEqual([{ id: 1, ok: true }])
  })

  test('hands the service only the command, never the request around it', async () => {
    const { port, service } = connect()
    port.send({ id: 1, command: { type: 'pause' }, path: '/etc/hosts' })
    await settle()
    expect(service.handled).toEqual([{ type: 'pause' }])
  })

  test('answers a refusal with its message, as a reply the page can read', async () => {
    const service = fakeService({
      outcome: () => ({ ok: false, reason: 'refused', message: 'That video is no longer open.' }),
    })
    const { port } = connect({ service })
    port.send({ id: 7, command: { type: 'play' } })
    await settle()
    expect(port.posted).toEqual([
      { id: 7, ok: false, reason: 'refused', message: 'That video is no longer open.' },
    ])
    expect(port.posted.every(isPlayerReply)).toBe(true)
  })

  test('passes on that the engine stopped as the reason, not only the words', async () => {
    const service = fakeService({
      outcome: () => ({ ok: false, reason: 'engine', message: 'Stopped.' }),
    })
    const { port } = connect({ service })
    port.send({ id: 3, command: { type: 'play' } })
    await settle()
    expect(port.posted).toEqual([{ id: 3, ok: false, reason: 'engine', message: 'Stopped.' }])
    expect(port.posted.every(isPlayerReply)).toBe(true)
  })

  test('refuses forged commands without reaching the service', async () => {
    const { port, service, warn } = connect()
    port.send({ id: 2, command: { type: 'run', args: ['quit'] } })
    port.send({
      id: 3,
      command: {
        type: 'load',
        source: { kind: 'path', path: '/etc/hosts' },
        start: 0,
        audio: null,
        subtitle: null,
      },
    })
    port.send({ id: 4, command: { type: 'seek', time: 'end' } })
    await settle()
    expect(service.handled).toEqual([])
    expect(port.posted).toEqual([
      { id: 2, ok: false, reason: 'refused', message: UNKNOWN_COMMAND },
      { id: 3, ok: false, reason: 'refused', message: UNKNOWN_COMMAND },
      { id: 4, ok: false, reason: 'refused', message: UNKNOWN_COMMAND },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('drops what has no numeric id, and says so', async () => {
    const { port, service, warn } = connect()
    port.send({ id: '5', command: { type: 'play' } })
    port.send('play')
    port.send(null)
    port.send({ id: Number.NaN, command: { type: 'play' } })
    await settle()
    expect(service.handled).toEqual([])
    expect(port.posted).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('warns once per run of messages it cannot use, and again after a command it knows', async () => {
    const { port, warn } = connect()
    port.send(null)
    port.send({ id: 1, command: { type: 'run' } })
    port.send({ id: 2, command: { type: 'play' } })
    port.send({ id: 3, command: { type: 'run' } })
    port.send('play')
    await settle()
    expect(warn.mock.calls).toEqual([
      ['Raven dropped a player message without a request id.'],
      ['Raven refused player request 3: it is not a command it knows.'],
    ])
  })

  test('handles one command at a time and answers in arrival order', async () => {
    const { port, service } = connect()
    service.deferNext()
    port.send({ id: 1, command: { type: 'audio', index: 0 } })
    port.send({ id: 2, command: { type: 'audio', index: 1 } })
    await settle()
    expect(service.handled).toEqual([{ type: 'audio', index: 0 }])
    expect(port.posted).toEqual([])
    service.release()
    await settle()
    expect(service.handled).toEqual([
      { type: 'audio', index: 0 },
      { type: 'audio', index: 1 },
    ])
    expect(port.posted).toEqual([
      { id: 1, ok: true },
      { id: 2, ok: true },
    ])
  })

  test('answers a failing service with a refusal and keeps going', async () => {
    const service = fakeService({
      outcome: (command) => {
        if (command.type === PLAYER_COMMANDS.stats) throw new Error('boom')
        return { ok: true }
      },
    })
    const { port, warn } = connect({ service })
    port.send({ id: 1, command: { type: 'stats' } })
    port.send({ id: 2, command: { type: 'play' } })
    await settle()
    expect(port.posted).toEqual([
      { id: 1, ok: false, reason: 'refused', message: 'Raven could not do that.' },
      { id: 2, ok: true },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('refuses a flood past the queue limit instead of holding it', async () => {
    const { port, service, warn } = connect()
    service.deferNext()
    Array.from({ length: MAX_PENDING + 2 }, (_, index) => index + 1).forEach((id) => {
      port.send({ id, command: { type: 'seek', time: id } })
    })
    await settle()
    expect(service.handled).toHaveLength(1)
    expect(port.posted).toEqual([
      {
        id: MAX_PENDING + 1,
        ok: false,
        reason: 'refused',
        message: 'Raven is busy. Try again.',
      },
      {
        id: MAX_PENDING + 2,
        ok: false,
        reason: 'refused',
        message: 'Raven is busy. Try again.',
      },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    service.release()
    await settle()
    expect(service.handled).toHaveLength(MAX_PENDING)
    expect(port.posted).toHaveLength(MAX_PENDING + 2)
  })

  test('posts each service event as is', () => {
    const { port, service } = connect()
    service.emit({ type: 'time', time: 3 })
    expect(port.posted).toEqual([{ type: 'time', time: 3 }])
  })

  test('on the far end closing, stops posting, resets the player once and closes the port', async () => {
    const { port, service } = connect()
    port.fireClose()
    port.fireClose()
    service.emit({ type: 'time', time: 3 })
    await settle()
    expect(port.posted).toEqual([])
    expect(service.listenerCount()).toBe(0)
    expect(service.flags.resets).toBe(1)
    expect(port.flags.closes).toBe(1)
  })

  test('close drops queued work and the answer in flight', async () => {
    const { port, service, connection } = connect()
    service.deferNext()
    port.send({ id: 1, command: { type: 'play' } })
    port.send({ id: 2, command: { type: 'pause' } })
    await settle()
    connection.close()
    connection.close()
    service.release()
    await settle()
    port.send({ id: 3, command: { type: 'play' } })
    await settle()
    expect(service.handled).toEqual([{ type: 'play' }])
    expect(port.posted).toEqual([])
    expect(service.flags.resets).toBe(1)
    expect(port.flags.closes).toBe(1)
  })

  test('a rejecting reset is warned, not thrown', async () => {
    const service = fakeService()
    const { connection, warn } = connect({
      service: {
        ...service,
        service: { ...service.service, reset: () => Promise.reject(new Error('gone')) },
      },
    })
    connection.close()
    await settle()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
