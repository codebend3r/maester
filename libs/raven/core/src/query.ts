/**
 * Query strings without `URLSearchParams`, which is a DOM and Node global
 * rather than part of the language, so this library cannot assume it.
 */
export const toQueryString = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

type PathWithQueryProps = { path: string; query: Record<string, string> }

/** `path` with `query` after it, or `path` alone when the query is empty. */
export const pathWithQuery = ({ path, query }: PathWithQueryProps): string =>
  Object.keys(query).length === 0 ? path : `${path}?${toQueryString(query)}`

type FillPathProps = { path: string; params: Record<string, string | number> }

/** A route's `:param` placeholders filled in, each value escaped: `/api/media/:id` to `/api/media/7`. */
export const fillPath = ({ path, params }: FillPathProps): string =>
  Object.entries(params).reduce(
    (filled, [name, value]) => filled.replace(`:${name}`, encodeURIComponent(String(value))),
    path,
  )

const decode = (part: string): string => decodeURIComponent(part.replace(/\+/g, ' '))

export const fromQueryString = (query: string): Record<string, string> =>
  Object.fromEntries(
    query
      .replace(/^\?/, '')
      .split('&')
      .filter((pair) => pair !== '')
      .map((pair) => {
        const [key = '', value = ''] = pair.split('=')
        return [decode(key), decode(value)]
      }),
  )
