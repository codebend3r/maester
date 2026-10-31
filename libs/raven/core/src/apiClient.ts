import { authCalls } from '@/apiClient/auth'
import { homeCalls } from '@/apiClient/home'
import { itemCalls } from '@/apiClient/items'
import { libraryCalls } from '@/apiClient/libraries'
import { lockCalls } from '@/apiClient/locks'
import { matchingCalls } from '@/apiClient/matching'
import { mediaCalls } from '@/apiClient/media'
import { mixCalls } from '@/apiClient/mixes'
import { musicCalls } from '@/apiClient/music'
import { pictureCalls } from '@/apiClient/pictures'
import { playlistCalls } from '@/apiClient/playlists'
import { playbackCalls } from '@/apiClient/playback'
import { reportCalls } from '@/apiClient/reports'
import { scrobblingCalls } from '@/apiClient/scrobbling'
import { settingsCalls } from '@/apiClient/settings'
import { createTransport, type FetchLike } from '@/apiClient/transport'
import { isServerEvent, type ServerEvent } from '@/contract'

export {
  ApiError,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  isLockedError,
  LOCKED_STATUS,
  type MediaAccess,
  type TicketedOrigin,
} from '@/apiClient/transport'

/** One message off the server's event stream, or null for anything this client does not know. */
export const parseServerEvent = (data: string): ServerEvent | null => {
  try {
    const parsed: unknown = JSON.parse(data)
    return isServerEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

type CreateApiClientProps = {
  baseUrl?: string
  fetch: FetchLike
  accessToken?: () => string | null
  pictureCdn?: string | null
}

/**
 * Every call a client makes to the media server, one module per resource
 * under `apiClient/`. `baseUrl` is '' for a web app served by the server
 * itself, or the server's origin for anything running elsewhere (a native
 * app, the Vite dev server behind a proxy). `pictureCdn` is the path of an
 * image CDN on the page's own site, such as Netlify's `/.netlify/images`:
 * capability pictures then go through it, which resizes them to the width
 * asked and re-encodes them as AVIF or WebP at the edge, and keeps each one
 * there for the next viewer.
 */
export const createApiClient = ({
  baseUrl = '',
  fetch,
  accessToken = () => null,
  pictureCdn = null,
}: CreateApiClientProps) => {
  const transport = createTransport({ baseUrl, fetch, accessToken })
  return {
    ...authCalls(transport),
    ...lockCalls(transport),
    ...libraryCalls(transport),
    ...mediaCalls(transport),
    ...itemCalls(transport),
    ...homeCalls(transport),
    ...matchingCalls(transport),
    ...musicCalls(transport),
    ...playlistCalls(transport),
    ...mixCalls(transport),
    ...scrobblingCalls(transport),
    ...pictureCalls({ transport, pictureCdn }),
    ...settingsCalls(transport),
    ...playbackCalls(transport),
    ...reportCalls(transport),
  }
}
