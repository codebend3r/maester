import { type ApiClient, type FetchLike, createApiClient } from '@raven/core'
import { activeBaseUrl } from '@/stores/activeServer'

type ServerClientsProps = {
  fetch: FetchLike
  /** The signed-in account's token, the Bearer every call to the API carries. */
  accessToken: () => string | null
  /** The path of an image CDN on the page's own site, which only the home server's pictures go through. */
  pictureCdn?: string | null
  /**
   * Whether the page's own `/api` reaches whichever server is active, as Raven's does through
   * main's relay: then `active` calls `/api` for every server. Read on every call.
   */
  isRelayed?: () => boolean
}

/**
 * The API clients of a page that switches between servers: `active` follows the active server
 * (`useActiveServer`), calling the page's own `/api` for the home one and the server's origin
 * for another, always with the Bearer and never the page's cookies; `at` is one server's own
 * client, at its origin, made once and kept, for what the page reads of a server it is not
 * using (the libraries of the pins kept on it, a new server's health).
 */
export const serverClientsFor = ({
  fetch,
  accessToken,
  pictureCdn = null,
  isRelayed = () => false,
}: ServerClientsProps) => {
  const clients = new Map<string, ApiClient>()
  const at = (origin: string): ApiClient => {
    const known = clients.get(origin)
    if (known !== undefined) return known
    const client = createApiClient({ baseUrl: origin, fetch, accessToken })
    clients.set(origin, client)
    return client
  }
  return {
    active: createApiClient({
      baseUrl: () => (isRelayed() ? '' : activeBaseUrl()),
      fetch,
      accessToken,
      pictureCdn,
    }),
    at,
  }
}
