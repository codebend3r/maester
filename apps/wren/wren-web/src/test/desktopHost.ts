import { WREN_HOST_META } from '@raven/wren'

/** A raven origin Wren for Mac could name, as its web host tags the page with it. */
export const DESKTOP_SERVER = 'https://raven.example:8443'

/** Tags the document as Wren for Mac's web host tags the page it serves; the result takes the tag off again. */
export const servedByDesktop = (serverAddress: string = DESKTOP_SERVER): (() => void) => {
  const meta = document.createElement('meta')
  meta.name = WREN_HOST_META.serverAddress
  meta.content = serverAddress
  document.head.append(meta)
  return () => meta.remove()
}
