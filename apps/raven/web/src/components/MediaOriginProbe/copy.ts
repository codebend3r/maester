/** What the app says when video would stream through the site's own `/api` proxy. */
export const PROXIED_MEDIA_COPY = {
  toast:
    'Video is streaming through this site, not from raven directly. Set RAVEN_MEDIA_ORIGINS on the server.',
} as const

/** The console line every browser gets, so the fallback never goes unseen. */
export const PROXIED_MEDIA_WARNING =
  'raven: no media origin could be reached, so video, files and subtitles stream through this site, which its host bills as bandwidth.'
