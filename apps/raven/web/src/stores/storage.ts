/** The localStorage keys the app's stores keep their state under. */
export const STORE_KEYS = {
  authSession: 'raven-auth-session',
  binge: 'raven-binge',
  bingeTip: 'raven-binge-tip-seen',
  cardLinks: 'raven-card-links',
  desktop: 'raven-desktop',
  browserDownloads: 'raven-browser-downloads',
  downloadAsk: 'raven-download-ask',
  downloadNotes: 'raven-download-notes',
  downloadPreparing: 'raven-download-preparing',
  downloadsHost: 'raven-downloads-host',
  downloadsShow: 'raven-downloads-show',
  dragging: 'raven-dragging',
  seasonView: 'raven-season-view',
  selectionScopes: 'raven-selection-scopes',
  serverReach: 'raven-server-reach',
} as const
