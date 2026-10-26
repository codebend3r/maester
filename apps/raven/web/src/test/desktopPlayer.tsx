import {
  DESKTOP_PATHS,
  isPlayerRequest,
  PAGE_ORIGIN,
  PAGE_PATHS,
  PLAYER_COMMANDS,
  PLAYER_CONNECTION_STATUSES,
  type PlayerCommand,
  type PlayerRefusalReason,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'
import { Toaster } from '@raven/ui'
import { waitFor } from '@testing-library/react'
import { type ReactNode, StrictMode } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { DesktopClient } from '@/desktop/client'
import { PlayRoute } from '@/desktop/PlayPage/PlayPage'
import { listenForPlayer, type PlayerConnections } from '@/desktop/playerConnection'
import { PinPrompt } from '@/components/PinPrompt/PinPrompt'
import { WatchPage } from '@/pages/WatchPage/WatchPage'
import { Where } from '@/test/authPage'
import { asPlayingDesktop } from '@/test/desktop'
import { renderWithProviders } from '@/test/render'

type RenderPlayersProps = {
  client: DesktopClient
  player?: PlayerConnections
  route: string
  state?: unknown
  behind?: string[]
  /** Mounts under StrictMode, which runs every effect twice in development. */
  isStrict?: boolean
  /** Rendered beside the pages, as the app's own parts are: a way to navigate, say. */
  beside?: ReactNode
}

/**
 * Raven's two players, the watch page and the play page, over `client` and `player`,
 * with `Where` standing in for every page they lead to, and the PIN prompt and toasts the app
 * runs over them. Returns the Playback menu's hub and what `renderWithProviders` does.
 */
export const renderPlayers = ({
  client,
  player,
  route,
  state,
  behind = [],
  isStrict = false,
  beside = null,
}: RenderPlayersProps) => {
  const { menu } = asPlayingDesktop({ client, player })
  const pages = (
    <>
      <Routes>
        <Route path={`${PAGE_PATHS.watch}/:id`} element={<WatchPage />} />
        <Route path={DESKTOP_PATHS.play} element={<PlayRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
      <PinPrompt />
      <Toaster />
      {beside}
    </>
  )
  const rendered = renderWithProviders({
    route,
    state,
    behind,
    ui: isStrict ? <StrictMode>{pages}</StrictMode> : pages,
  })
  return { ...rendered, menu }
}

/**
 * The html engine's video once it is pointed at `url`. The element mounts first and its
 * source is set in an effect after, so waiting for the element alone races a slow runner.
 */
export const sourcedVideo = (url: string) =>
  waitFor(() => {
    const element = document.querySelector('video')
    if (element === null) throw new Error('no video element')
    const source = element.getAttribute('src')
    if (source !== url) throw new Error(`video source is ${source ?? 'unset'}`)
    return element
  })

/**
 * The page's real connection, with the test playing main on the other end of a real channel:
 * it answers each command at once, or with the refusal `refusals` holds for its type.
 */
export const handedOver = () => {
  const connections = listenForPlayer({ target: window, origin: PAGE_ORIGIN })
  const { port1, port2 } = new MessageChannel()
  const commands: PlayerCommand[] = []
  const refusals = new Map<
    PlayerCommand['type'],
    { reason: PlayerRefusalReason; message: string }
  >()
  port2.addEventListener('message', (event) => {
    const data: unknown = event.data
    if (!isPlayerRequest(data)) return
    commands.push(data.command)
    const refusal = refusals.get(data.command.type)
    port2.postMessage(
      refusal === undefined ? { id: data.id, ok: true } : { id: data.id, ok: false, ...refusal },
    )
  })
  port2.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: WINDOW_MESSAGE_TYPES.playerPort,
        connection: { status: PLAYER_CONNECTION_STATUSES.native },
      },
      origin: PAGE_ORIGIN,
      source: window,
      ports: [port1],
    }),
  )
  return {
    connections,
    commands,
    refusals,
    loads: () => commands.filter((command) => command.type === PLAYER_COMMANDS.load),
    fromMain: (data: unknown) => port2.postMessage(data),
  }
}
