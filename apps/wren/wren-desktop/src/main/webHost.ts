import { WEB_HOST_ERRORS } from '@raven/core'
import { WREN_HOST, WREN_HOST_META, WREN_PAGE_ORIGIN } from '@raven/wren'
import {
  type Handler,
  type PolicySources,
  type Timers,
  createWebHostHandler,
} from '@shared/desktop'

const HEAD_END = '</head>'

/** What the page loads beyond its own files: nothing; its covers and music come through `/api`. */
export const WREN_POLICY_SOURCES = {
  images: [],
  media: [],
  connections: [],
} as const satisfies PolicySources

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
}

const escapeAttribute = (value: string): string =>
  value.replace(/[&"<>]/g, (character) => ESCAPES[character] ?? character)

type TaggedPageProps = { html: string; serverOrigin: string }

/**
 * The web app's `index.html` with the `<meta>` that tells it it runs in Wren for Mac and which
 * raven it plays from (`WREN_HOST_META`), before `</head>`; a page with no head is left as it is.
 */
export const taggedPage = ({ html, serverOrigin }: TaggedPageProps): string => {
  if (!html.includes(HEAD_END)) return html
  const meta = `<meta name="${WREN_HOST_META.serverAddress}" content="${escapeAttribute(serverOrigin)}" />`
  return html.replace(HEAD_END, `    ${meta}\n  ${HEAD_END}`)
}

type CreateWrenHostHandlerProps = {
  root: string
  /** The raven `/api` goes to. */
  serverOrigin: string
  readFile: (path: string) => Promise<Uint8Array>
  timers: Timers
  warn: (message: string) => void
  info: (message: string) => void
}

/**
 * Wren for Mac's web host: Wren's web app on `localhost:47485`, its `index.html` tagged for Wren
 * for Mac, and `/api` passed on to one raven.
 */
export const createWrenHostHandler = ({
  serverOrigin,
  ...rest
}: CreateWrenHostHandlerProps): Handler =>
  createWebHostHandler({
    ...rest,
    host: WREN_HOST,
    pageOrigin: WREN_PAGE_ORIGIN,
    upstreamOf: () => serverOrigin,
    sources: WREN_POLICY_SOURCES,
    pageOf: (html) => taggedPage({ html, serverOrigin }),
    unreachableBody: JSON.stringify({ error: WEB_HOST_ERRORS.serverUnreachable }),
    notes: {
      unreachable: (reason) => `Wren could not reach raven: ${reason}`,
      reachedAgain: 'Wren reached raven again',
    },
  })
