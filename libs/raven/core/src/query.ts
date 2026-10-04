/**
 * Query strings without `URLSearchParams`, which is a DOM and Node global
 * rather than part of the language, so this library cannot assume it.
 */
export const toQueryString = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

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
