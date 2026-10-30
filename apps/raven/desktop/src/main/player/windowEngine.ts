import type { AudioEvent, Guard, PlayerEvent } from '@raven/core'
import { app, type BrowserWindow, MessageChannelMain, type MessagePortMain } from 'electron'
import { errorText } from '@/main/log/errorText'
import { createConnector } from '@/main/player/connector'
import { type EngineWords, engineModeFrom, type OpenedEngine } from '@/main/player/engine'
import { createEngineSlot, type WatchedService, watchService } from '@/main/player/engineSlot'
import type { PortLike, PortRequest, PortService } from '@/main/player/playerPort'
import { isPageUrl } from '@/main/security'
import type { Timers } from '@/main/stateStore'
import type { IPC_CHANNELS } from '@/shared/hostNames'

// A test hook too: an unpackaged run reads `RAVEN_DESKTOP_MPV` (`headless` or `off`).
export const engineMode = () => engineModeFrom({ isPackaged: app.isPackaged, env: process.env })

/** Electron's port behind the bridge's `PortLike`, so the bridge never sees Electron. */
const portLike = (port: MessagePortMain): PortLike => ({
  onMessage: (listener) => {
    port.on('message', (event) => listener(event.data))
  },
  onClose: (listener) => {
    port.on('close', listener)
  },
  post: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close(),
})

const isPageLive = (window: BrowserWindow): boolean =>
  !window.isDestroyed() &&
  !window.webContents.isDestroyed() &&
  isPageUrl(window.webContents.getURL())

type WindowService<C, E extends PlayerEvent | AudioEvent> = PortService<C, E> & WatchedService<E>

type AttachWindowEngineProps<
  C extends { type: string },
  E extends PlayerEvent | AudioEvent,
  T extends { service: WindowService<C, E> },
> = {
  window: BrowserWindow
  /** The channel the page's preload forwards this engine's port on. */
  channel: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
  isRequest: Guard<PortRequest<C>>
  words: EngineWords
  /** Opens the engine once, under the page; what it answers when it cannot is the slot's. */
  open: () => Promise<OpenedEngine<T>>
  destroyOf: (engine: T) => Promise<void>
  /** Told once the engine stops for good, before the slot is. */
  onDied: () => void
  timers: Timers
  warn: (message: string) => void
}

/**
 * One of a window's engines (the video player's, the music engine's): opened once under the
 * page, from `ready-to-show` or the page's first `ready`, and handed to each page load on a
 * port of its own, which a new page load, a crashed page or the window closing drops.
 */
export const attachWindowEngine = <
  C extends { type: string },
  E extends PlayerEvent | AudioEvent,
  T extends { service: WindowService<C, E> },
>({
  window,
  channel,
  isRequest,
  words,
  open,
  destroyOf,
  onDied,
  timers,
  warn,
}: AttachWindowEngineProps<C, E, T>) => {
  const engine = createEngineSlot<T>({
    open,
    destroyOf,
    watch: ({ engine: opened, onDied: died }) =>
      watchService({
        engine: opened,
        onDied: () => {
          onDied()
          died()
        },
      }),
    words,
    warn,
  })

  const connector = createConnector({
    engine: engine.get,
    isRequest,
    channel: () => {
      const { port1, port2 } = new MessageChannelMain()
      return { local: portLike(port1), remote: port2 }
    },
    post: ({ connection, ports }) => {
      if (!isPageLive(window)) throw new Error('its page is gone.')
      window.webContents.postMessage(channel, connection, ports)
    },
    unavailable: words.unavailable,
    warn,
    timers,
  })

  // Whichever comes first of this and the page's `ready` (through the connector).
  window.once('ready-to-show', () => {
    engine.get().catch((error: unknown) => {
      warn(`Raven could not open its ${words.name}: ${errorText(error)}`)
    })
  })
  // A new page load drops the port the last page's `ready` is still waiting on the engine for.
  // Handed over late, it would reach the new page, which keeps the first port it gets, and
  // the new page's own `ready` would then close it under it.
  window.webContents.on('did-navigate', () => connector.disconnect())
  // A crashed page holds no port; stop what it was playing until its reload asks again.
  window.webContents.on('render-process-gone', () => connector.disconnect())
  window.on('closed', () => connector.disconnect())

  return { engine, connect: connector.connect }
}
