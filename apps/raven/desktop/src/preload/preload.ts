import {
  PAGE_ORIGIN,
  RAVEN_DESKTOP_BRIDGE_KEY,
  type RavenDesktopBridge,
  WINDOW_MESSAGE_TYPES,
} from '@raven/core'
import { desktopPlatformFor } from '@/shared/platform'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { forwardPlayerPort } from '@/preload/playerPort'
import { IPC_CHANNELS } from '@/shared/hostNames'

/*
 * The page's request goes on unchecked: main narrows it at its boundary. No request carries a
 * path, so the page can never hand main one.
 */
const bridge = {
  request: (request: unknown) => ipcRenderer.invoke(IPC_CHANNELS.request, request),
  subscribe: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(IPC_CHANNELS.event, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.event, handler)
    }
  },
  // Main reads the same platform, so the page draws exactly the controls the window lacks.
  platform: desktopPlatformFor({ platform: process.platform }),
} satisfies RavenDesktopBridge

/** Each port main hands the page, by its channel and the window message the page takes it in. */
const PORT_CHANNELS = [
  [IPC_CHANNELS.player, WINDOW_MESSAGE_TYPES.playerPort],
  [IPC_CHANNELS.audio, WINDOW_MESSAGE_TYPES.audioPort],
] as const

/*
 * Only the web host's page gets the bridge. Main refuses any other frame too, and the window
 * never navigates away, so this is a second lock rather than the only one.
 */
if (window.location.origin === PAGE_ORIGIN) {
  contextBridge.exposeInMainWorld(RAVEN_DESKTOP_BRIDGE_KEY, bridge)

  /*
   * The player's port cannot cross `contextBridge`, so it reaches the page as a window message
   * on the page's origin, which the page checks before taking the port.
   */
  PORT_CHANNELS.forEach(([channel, type]) =>
    ipcRenderer.on(channel, (event, payload: unknown) =>
      forwardPlayerPort({
        payload,
        ports: event.ports,
        type,
        post: ({ message, transfer }) => window.postMessage(message, PAGE_ORIGIN, transfer),
      }),
    ),
  )
}
