/**
 * Wren for Mac serves Wren's web app from this loopback port and proxies `/api` to raven. The
 * port is fixed, so the page's origin, and with it its cookies and storage, is the same on every
 * launch; it sits beside Raven's own (47484), so both apps run at once.
 */
export const WREN_HOST_PORT = 47485

/** The one `Host` Wren for Mac's web host answers; any other is refused, which blocks DNS rebinding. */
export const WREN_HOST = `localhost:${WREN_HOST_PORT}` as const

/** The page's origin: `localhost` rather than `127.0.0.1`, so it is a secure context. */
export const WREN_PAGE_ORIGIN = `http://${WREN_HOST}` as const

/**
 * The `<meta>` names Wren for Mac adds to the page it serves, so the web app knows it runs there:
 * `serverAddress` holds the raven origin `/api` goes to, which Settings shows.
 */
export const WREN_HOST_META = { serverAddress: 'wren-server-address' } as const
