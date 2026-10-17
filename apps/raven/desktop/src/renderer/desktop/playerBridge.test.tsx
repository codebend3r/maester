import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { type PlayerServices, PlayerServicesProvider, Player } from '@raven/ui'
import { act, screen } from '@testing-library/react'
// The one renderer test that imports main's modules: it runs both ends of the real bridge.
import { connectPort, type PortLike } from '@/main/player/playerPort'
import { PLAYER_MESSAGES, type PlayerOutcome } from '@/main/player/playerService'
import { fakeService } from '@/main/test/playerFakes'
import { nativePlayerOver, PLAYER_NO_ANSWER } from '@/renderer/desktop/playerConnection'
import { fakeClient, renderDesktop } from '@/renderer/test/render'

const FILE_ID = '11111111-1111-4111-8111-111111111111'

/** What main.ts does with a `MessagePortMain`, done here over a real `MessagePort`. */
const portLikeOf = (port: MessagePort): PortLike => ({
  onMessage: (listener) => port.addEventListener('message', (event) => listener(event.data)),
  onClose: (listener) => port.addEventListener('close', () => listener()),
  post: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close(),
})

const SERVICES: PlayerServices = {
  title: { label: 'Clip 01', duration: null, resumeAt: 0, backTo: '/', next: null },
  progress: { started: () => {}, save: () => {}, left: () => {} },
  posterUrl: null,
  escape: null,
  unplayableNote: 'raven player could not play this video.',
}

/** The page's player over one real channel, with main's port bridge and a scripted service on the far end. */
const bridge = ({
  outcome,
  timeoutMs = 1000,
  isHeld = false,
}: {
  outcome: () => PlayerOutcome
  timeoutMs?: number
  isHeld?: boolean
}) => {
  const { port1, port2 } = new MessageChannel()
  const service = fakeService({ outcome })
  if (isHeld) service.deferNext()
  connectPort({ port: portLikeOf(port2), service: service.service, warn: () => {} })
  const player = nativePlayerOver({ port: port1, timeoutMs })
  renderDesktop({
    client: fakeClient(),
    routes: [
      {
        path: '/',
        element: (
          <PlayerServicesProvider services={SERVICES}>
            <Player
              engine={{ kind: 'native', player, source: { kind: 'file', fileId: FILE_ID } }}
            />
          </PlayerServicesProvider>
        ),
      },
    ],
  })
  return { service, player }
}

const settled = (ms = 20) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>

beforeEach(() => {
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('the player bridge, page to service and back', () => {
  it("shows main's refusal of the load as the reason the video cannot play", async () => {
    const { service } = bridge({
      outcome: () => ({ ok: false, reason: 'refused', message: PLAYER_MESSAGES.notOpen }),
    })
    await settled()
    expect(service.handled[0]).toEqual({
      type: 'load',
      source: { kind: 'file', fileId: FILE_ID },
      start: 0,
      audio: null,
      subtitle: null,
    })
    expect(await screen.findByText(PLAYER_MESSAGES.notOpen)).toBeInTheDocument()
  })

  it('shows that main did not answer when the load is never answered', async () => {
    bridge({ outcome: () => ({ ok: true }), timeoutMs: 10, isHeld: true })
    await settled(40)
    expect(await screen.findByText(PLAYER_NO_ANSWER)).toBeInTheDocument()
  })

  it('carries an accepted load through, then events reach the page', async () => {
    const { service } = bridge({ outcome: () => ({ ok: true }) })
    await settled()
    expect(service.handled.map((command) => command.type)).toEqual([
      'load',
      'volume',
      'subtitleScale',
    ])
    service.emit({ type: 'duration', duration: 90 })
    service.emit({ type: 'time', time: 30 })
    await settled()
    expect(screen.queryByText(PLAYER_MESSAGES.notOpen)).toBeNull()
    expect(screen.getByRole('slider', { name: /seek/i })).toHaveAttribute('aria-valuemax', '90')
  })
})
