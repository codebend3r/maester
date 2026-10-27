/** The app's pages; the server sends browsers to `login` with `QUERY_PARAMS.error` set. */
export const ROUTES = { home: '/', login: '/login', logout: '/logout' } as const

/** What a page reads from its address: where to go after, and why the server sent someone back. */
export const QUERY_PARAMS = { returnTo: 'return_to', error: 'error' } as const
