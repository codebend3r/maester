import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'
import { dropPaths } from '@/preload/dropPaths'
import type { RavenDesktopBridge } from '@/shared/bridge'
import { EVENT_CHANNEL, type InvokeEnvelope, REQUEST_CHANNEL } from '@/shared/protocol'

// The page's request goes on unchecked: main narrows the whole envelope at its boundary.
type Envelope = Extract<InvokeEnvelope, { kind: 'drop' }> | { kind: 'page'; request: unknown }

const invoke = (envelope: Envelope): Promise<unknown> =>
  ipcRenderer.invoke(REQUEST_CHANNEL, envelope)

// The preload builds the envelope, so the page can ask for things but never hand main a path:
// only a drop carries paths, and those come from `webUtils`, not from the page.
const bridge = {
  request: (request) => invoke({ kind: 'page', request }),
  dropFiles: (files) =>
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
