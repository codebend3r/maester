import {
  desktopPlatformFor,
  ENVELOPE_KINDS,
  type InvokeEnvelope,
  PAGE_ORIGIN,
  type RavenDesktopBridge,
} from '@raven/core'
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'
import { dropPaths } from '@/preload/dropPaths'
import { forwardPlayerPort } from '@/preload/playerPort'
import { IPC_CHANNELS } from '@/shared/hostNames'

// The page's request goes on unchecked: main narrows the whole envelope at its boundary.
type Envelope =
  | Extract<InvokeEnvelope, { kind: typeof ENVELOPE_KINDS.drop }>
  | { kind: typeof ENVELOPE_KINDS.page; request: unknown }

const invoke = (envelope: Envelope): Promise<unknown> =>
  ipcRenderer.invoke(IPC_CHANNELS.request, envelope)

// The preload builds the envelope, so the page can ask for things but never hand main a path:
// only a drop carries paths, and those come from `webUtils`, not from the page.
const bridge = {
  request: (request) => invoke({ kind: ENVELOPE_KINDS.page, request }),
  // Typed as what it is: whatever the page passed, which `dropPaths` checks itself.
  dropFiles: (files: unknown) =>
    invoke({
      kind: ENVELOPE_KINDS.drop,
      paths: dropPaths({ files, pathOf: (file) => webUtils.getPathForFile(file) }),
    }),
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

// Only the web host's page gets the bridge. Main refuses any other frame too, and the window
// never navigates away, so this is a second lock rather than the only one.
if (window.location.origin === PAGE_ORIGIN) {
  contextBridge.exposeInMainWorld('ravenDesktop', bridge)

  // The player's port cannot cross `contextBridge`, so it reaches the page as a window message
  // on the page's origin, which the page checks before taking the port.
  ipcRenderer.on(IPC_CHANNELS.player, (event, payload: unknown) =>
    forwardPlayerPort({
      payload,
      ports: event.ports,
      post: ({ message, transfer }) => window.postMessage(message, PAGE_ORIGIN, transfer),
    }),
  )
}
