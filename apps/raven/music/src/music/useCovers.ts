import type { AlbumSummary } from '@raven/core'
import { cookieJar } from '@raven/native'
import { cookieHeadersFor, useServerCookies } from '@raven/native/headless'

import { useWrenAccount } from '@/session'
import type { WrenSession } from '@/useWren'

/** A cover to draw: where it is, and the headers its request carries. */
export type Cover = { uri: string; headers: Record<string, string> }

type CoverOfProps = Pick<AlbumSummary, 'coverVersion'> & { albumId: number }

type UseCoversProps = Pick<WrenSession, 'server' | 'api'>

/**
 * The album covers of the active server, each with the server's cookies and the account's
 * token on its request. No album has one until the jar has first answered, so no cover is
 * asked for twice.
 */
export const useCovers = ({ server, api }: UseCoversProps) => {
  const cookies = useServerCookies({ server, jar: cookieJar })
  const accessToken = useWrenAccount((state) => state.session?.accessToken ?? null)
  const headersFor = cookies === null ? null : cookieHeadersFor({ server, cookies, accessToken })
  return ({ albumId, coverVersion }: CoverOfProps): Cover | null => {
    const uri = api.albumCoverUrl({ albumId, coverVersion })
    return uri === null || headersFor === null ? null : { uri, headers: headersFor(uri) }
  }
}

export type CoverOf = ReturnType<typeof useCovers>
