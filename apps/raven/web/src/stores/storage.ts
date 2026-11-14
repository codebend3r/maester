/** The localStorage keys the app's stores keep their state under. */
export const STORE_KEYS = {
  authSession: 'raven-auth-session',
  binge: 'raven-binge',
  bingeTip: 'raven-binge-tip-seen',
  browserDownloads: 'raven-browser-downloads',
  downloadAsk: 'raven-download-ask',
  downloadNotes: 'raven-download-notes',
  downloadsShow: 'raven-downloads-show',
  seasonView: 'raven-season-view',
  serverReach: 'raven-server-reach',
} as const
