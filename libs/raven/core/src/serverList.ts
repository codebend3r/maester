/** The most servers a client keeps on its list. */
export const SERVERS_CAP = 20

/**
 * The name a new server starts with: its origin's host, as punycode, with the port when it
 * is not the scheme's default, which is how `serverOriginOf` writes it.
 */
export const serverNameFor = (origin: string): string => origin.slice(origin.indexOf('//') + 2)
