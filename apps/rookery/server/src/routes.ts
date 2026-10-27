/** The server's own routes, as Nest registers them and as the web app and the other apps call them. */
export const ROUTES = {
  start: '/api/auth/plex/start',
  callback: '/auth/plex/callback',
  logout: '/api/auth/logout',
  me: '/api/me',
  session: '/internal/session',
  health: '/health',
} as const
