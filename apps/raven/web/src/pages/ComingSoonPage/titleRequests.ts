import type { TitleRequest, TitleRequestAsk, TitleRequests } from '@raven/core'

type RequestOfProps = { list: TitleRequests | undefined; ask: TitleRequestAsk }

/** The request for a title, or null while nobody has made one (or the list is still read). */
export const requestOf = ({ list, ask }: RequestOfProps): TitleRequest | null =>
  list?.requests.find((request) => request.type === ask.type && request.tmdbId === ask.tmdbId) ??
  null
