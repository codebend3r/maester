import { ACCOUNT_TICKET_SECONDS, MEDIA_TICKET_SECONDS } from '@raven/core'

export const WATCH_PAGE_COPY = {
  backToLibraries: 'Back to libraries',
  missing: 'This video is no longer in any library.',
  /** How long a copied file link plays, as long as the ticket it carries: an account ticket can end sooner, with its token. */
  linkLife: {
    account: `up to ${ACCOUNT_TICKET_SECONDS / 60} minutes`,
    legacy: `${MEDIA_TICKET_SECONDS / 3600} hours`,
  },
  linkLasts: (life: string) => `; it works for ${life}`,
  linkCopied: (lasts: string) => `Link copied. Paste it into VLC or IINA to play it there${lasts}.`,
  copyThisLink: (link: string) => `Copy this link: ${link}`,
  copyFileLink: 'Copy file link',
  openInRaven: 'Open in Raven',
} as const
