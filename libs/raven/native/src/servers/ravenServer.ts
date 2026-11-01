import type { AppServer } from '@/servers/serverList'

/**
 * A test build names a server that takes no sign-in (a local raven with accounts off) in
 * `EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN`, which Expo writes into the bundle, and goes straight to
 * Home on it. Unset, as in every real build, the app asks for the account.
 */
const BYPASS_ORIGIN = process.env.EXPO_PUBLIC_RAVEN_BYPASS_ORIGIN ?? ''

export const IS_SIGN_IN_BYPASSED = BYPASS_ORIGIN !== ''

/**
 * The one server raven's apps talk to: raven on Vhagar, reached through the same public
 * address as the web app, which proxies `/api` to it. The id is fixed so the server's cookies,
 * kept under it, survive a relaunch.
 */
export const RAVEN_SERVER: AppServer = {
  id: '7c1f4e2a-3b5d-4a6e-8f90-1a2b3c4d5e6f',
  name: 'raven',
  origin: IS_SIGN_IN_BYPASSED ? BYPASS_ORIGIN : 'https://raven-player.netlify.app',
  addedAt: 0,
}
