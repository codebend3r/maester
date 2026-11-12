/** What the browser's downloads say of themselves: in a row, a toast or the dialog. */
export const BROWSER_DOWNLOAD_COPY = {
  locked: 'raven keeps that behind its PIN.',
  gone: 'That title is not on raven any more.',
  account: 'raven did not let your account download that.',
  unreachable: 'raven could not be reached.',
  unreadable: 'raven answered with something this browser could not keep.',
  tooMany: 'That is more than raven downloads at once.',
  askGone: 'That download request has expired. Choose Download again.',
  unknown: 'That download is no longer in this browser.',
  notReady: 'That download is not ready to play yet.',
  fileGone: "That download's file could not be found.",
  full: 'This browser has no more room for downloads',
  outage: 'The connection was lost',
  answered: (status: number) => `raven answered ${status}`,
  unsupported: 'This browser does not do that with its downloads.',
  dolbyVision: 'DV5 downloads are unsupported in this browser.',
  noCopy: 'raven could not make a copy this browser plays',
} as const
