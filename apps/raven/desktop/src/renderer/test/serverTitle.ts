import { expect, mock } from 'bun:test'
import { PLAYER_COMMANDS, type PlayerCommand, type PlayerEvent } from '@raven/core'
import type { NativePlayer } from '@raven/ui/headless'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccountView } from '@/shared/protocol'
import { connectionsOf, renderDesktop } from '@/renderer/test/render'
import { OFF_ACCOUNT, reply, S, serverClient } from '@/renderer/test/serverFakes'
import { mediaItemFor } from '@/shared/test/mediaItem'

export const EPISODE = mediaItemFor({})
export const LOCKED = reply({ status: 423, body: { message: 'This library is locked.' } })
export const MISSING = reply({ status: 404, body: { message: 'Not found' } })
export const UNLOCKED = reply({ body: { available: true, unlocked: true } })

/** A player whose commands are recorded and answered at once; `emit` plays main's events. */
const fakePlayer = () => {
  const listeners = new Set<(event: PlayerEvent) => void>()
  const send = mock<NativePlayer['send']>(async () => {})
  const player: NativePlayer = {
    send,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    player,
    send,
    emit: (event: PlayerEvent) =>
      act(() => {
        listeners.forEach((listener) => listener(event))
      }),
  }
}

type FakePlayer = ReturnType<typeof fakePlayer>

export const loadsOf = (
  fake: FakePlayer,
): Extract<PlayerCommand, { type: typeof PLAYER_COMMANDS.load }>[] =>
  fake.send.mock.calls
    .map(([command]) => command)
    .flatMap((command) => (command.type === PLAYER_COMMANDS.load ? [command] : []))

/** The player took the load: it sends its caption size only once the load is answered. */
export const loaded = ({ fake, count = 1 }: { fake: FakePlayer; count?: number }) =>
  waitFor(() => {
    const scales = fake.send.mock.calls.filter(
      ([command]) => command.type === PLAYER_COMMANDS.subtitleScale,
    )
    expect(scales).toHaveLength(count)
  })

export const playTitle = ({
  calls,
  replies,
  account = { current: OFF_ACCOUNT },
  state = { at: 0, next: [] },
  route = `/server/${S}/7`,
}: {
  calls: Parameters<typeof serverClient>[0]['calls']
  replies?: Parameters<typeof serverClient>[0]['replies']
  account?: { current: AccountView }
  state?: unknown
  route?: string
}) => {
  const client = serverClient({ calls, replies, account })
  const fake = fakePlayer()
  const rendered = renderDesktop({
    client,
    route,
    state,
    player: connectionsOf({ status: 'native', player: fake.player }),
  })
  return { client, fake, ...rendered }
}

export const enter = async ({ label, value }: { label: string; value: string }) => {
  await userEvent.type(await screen.findByLabelText(label), value)
  await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
}
