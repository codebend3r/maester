/** Coming soon's tabs, each a route of its own: what is on its way, the caller's requests still pending, those added to a library, and, for whoever manages raven, every account's requests. */
export const COMING_SOON_TABS = {
  upcoming: 'upcoming',
  pending: 'pending',
  added: 'added',
  everyone: 'everyone',
} as const

export type ComingSoonTab = (typeof COMING_SOON_TABS)[keyof typeof COMING_SOON_TABS]
