/** The scheme of Raven's own links, which the desktop app registers as their handler. */
export const LINK_SCHEME = 'raven'

/** The `URL.protocol` values of a web address, and of Raven's own links. */
export const URL_PROTOCOLS = { http: 'http:', https: 'https:', raven: `${LINK_SCHEME}:` } as const
