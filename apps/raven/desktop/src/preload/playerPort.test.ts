import { PLAYER_CONNECTION_STATUSES, WINDOW_MESSAGE_TYPES } from '@raven/core'
import { describe, expect, test } from 'bun:test'
import { forwardPlayerPort } from '@/preload/playerPort'

const { port1, port2 } = new MessageChannel()

type ForwardProps = { payload: unknown; ports: readonly MessagePort[] }

const forward = ({ payload, ports }: ForwardProps) => {
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
    expect(
      forward({ payload: { status: PLAYER_CONNECTION_STATUSES.native }, ports: [port1] }),
    ).toEqual([
      {
        message: {
          type: WINDOW_MESSAGE_TYPES.playerPort,
          connection: { status: PLAYER_CONNECTION_STATUSES.native },
        },
        transfer: [port1],
      },
    ])
  })

  test.each([
    ['no port', []],
    ['two ports', [port1, port2]],
  ])('drops a native connection with %s', (_name, ports) => {
    expect(forward({ payload: { status: PLAYER_CONNECTION_STATUSES.native }, ports })).toEqual([])
  })

  test('forwards an unavailable connection with no port', () => {
    expect(
      forward({
        payload: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x' },
        ports: [],
      }),
    ).toEqual([
      {
        message: {
          type: WINDOW_MESSAGE_TYPES.playerPort,
          connection: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x' },
        },
        transfer: [],
      },
    ])
  })

  test('drops an unavailable connection that carries a port', () => {
    expect(
      forward({
        payload: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x' },
        ports: [port1],
      }),
    ).toEqual([])
  })

  test.each([
    ['an unknown status', { status: 'nope' }],
    [
      'an unavailable connection without a message',
      { status: PLAYER_CONNECTION_STATUSES.unavailable },
    ],
    ['a string', PLAYER_CONNECTION_STATUSES.native],
    ['nothing', null],
  ])('drops %s', (_name, payload) => {
    expect(forward({ payload, ports: [] })).toEqual([])
  })

  test('rebuilds the connection from its known fields only', () => {
    const [sent] = forward({
      payload: { status: PLAYER_CONNECTION_STATUSES.native, path: '/x' },
      ports: [port1],
    })
    expect(sent!.message).toStrictEqual({
      type: WINDOW_MESSAGE_TYPES.playerPort,
      connection: { status: PLAYER_CONNECTION_STATUSES.native },
    })
    const [unavailable] = forward({
      payload: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x', path: '/x' },
      ports: [],
    })
    expect(unavailable!.message).toStrictEqual({
      type: WINDOW_MESSAGE_TYPES.playerPort,
      connection: { status: PLAYER_CONNECTION_STATUSES.unavailable, message: 'x' },
    })
  })
})
