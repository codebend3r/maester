import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'
import { dropPaths } from '@/preload/dropPaths'
import { forwardPlayerPort } from '@/preload/playerPort'
import type { RavenDesktopBridge } from '@/shared/bridge'
import {
  APP_ORIGIN,
  EVENT_CHANNEL,
  type InvokeEnvelope,
  PLAYER_PORT_CHANNEL,
  REQUEST_CHANNEL,
} from '@/shared/protocol'

// The page's request goes on unchecked: main narrows the whole envelope at its boundary.
type Envelope = Extract<InvokeEnvelope, { kind: 'drop' }> | { kind: 'page'; request: unknown }

const invoke = (envelope: Envelope): Promise<unknown> =>
  ipcRenderer.invoke(REQUEST_CHANNEL, envelope)

// The preload builds the envelope, so the page can ask for things but never hand main a path:
// only a drop carries paths, and those come from `webUtils`, not from the page.
const bridge = {
  request: (request) => invoke({ kind: 'page', request }),
  // Typed as what it is: whatever the page passed, which `dropPaths` checks itself.
  dropFiles: (files: unknown) =>
    invoke({
      kind: 'drop',
      paths: dropPaths({ files, pathOf: (file) => webUtils.getPathForFile(file) }),
    }),
  subscribe: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler)
    }
  },
} satisfies RavenDesktopBridge

contextBridge.exposeInMainWorld('ravenDesktop', bridge)

// The player's port cannot cross `contextBridge`, so it reaches the page as a window message
// on the app's origin, which the page checks before taking the port.
ipcRenderer.on(PLAYER_PORT_CHANNEL, (event, payload: unknown) =>
  forwardPlayerPort({
    payload,
    ports: event.ports,
    post: ({ message, transfer }) => window.postMessage(message, APP_ORIGIN, transfer),
  }),
)
