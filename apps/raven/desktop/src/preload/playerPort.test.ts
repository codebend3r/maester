import { describe, expect, test } from 'bun:test'
import { forwardPlayerPort } from '@/preload/playerPort'
import { PLAYER_PORT_MESSAGE } from '@/shared/protocol'

const { port1, port2 } = new MessageChannel()

const forward = ({ payload, ports }: { payload: unknown; ports: readonly MessagePort[] }) => {
  const sent: { message: unknown; transfer: MessagePort[] }[] = []
  forwardPlayerPort({
    payload,
    ports,
    post: ({ message, transfer }) => {
      sent.push({ message, transfer })
    },
  })
  return sent
}

describe('forwardPlayerPort', () => {
  test('forwards a native connection with its one port', () => {
    expect(forward({ payload: { status: 'native' }, ports: [port1] })).toEqual([
      {
        message: { type: PLAYER_PORT_MESSAGE, connection: { status: 'native' } },
        transfer: [port1],
      },
    ])
  })

  test.each([
    ['no port', []],
    ['two ports', [port1, port2]],
  ])('drops a native connection with %s', (_name, ports) => {
    expect(forward({ payload: { status: 'native' }, ports })).toEqual([])
  })

  test('forwards an unavailable connection with no port', () => {
    expect(forward({ payload: { status: 'unavailable', message: 'x' }, ports: [] })).toEqual([
      {
        message: {
          type: PLAYER_PORT_MESSAGE,
          connection: { status: 'unavailable', message: 'x' },
        },
        transfer: [],
      },
    ])
  })

  test('drops an unavailable connection that carries a port', () => {
    expect(forward({ payload: { status: 'unavailable', message: 'x' }, ports: [port1] })).toEqual(
      [],
    )
  })

  test.each([
    ['an unknown status', { status: 'nope' }],
    ['an unavailable connection without a message', { status: 'unavailable' }],
    ['a string', 'native'],
    ['nothing', null],
  ])('drops %s', (_name, payload) => {
    expect(forward({ payload, ports: [] })).toEqual([])
  })

  test('rebuilds the connection from its known fields only', () => {
    const [sent] = forward({ payload: { status: 'native', path: '/x' }, ports: [port1] })
    expect(sent!.message).toStrictEqual({
      type: PLAYER_PORT_MESSAGE,
      connection: { status: 'native' },
    })
    const [unavailable] = forward({
      payload: { status: 'unavailable', message: 'x', path: '/x' },
      ports: [],
    })
    expect(unavailable!.message).toStrictEqual({
      type: PLAYER_PORT_MESSAGE,
      connection: { status: 'unavailable', message: 'x' },
    })
  })
})
