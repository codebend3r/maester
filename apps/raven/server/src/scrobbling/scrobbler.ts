/** How sending one listen ended: sent, worth trying again, refused for the account's link, or refused for good. */
export const SEND_OUTCOMES = {
  sent: 'sent',
  retry: 'retry',
  unlinked: 'unlinked',
  rejected: 'rejected',
} as const

export type SendOutcome = (typeof SEND_OUTCOMES)[keyof typeof SEND_OUTCOMES]

/** A listen as both services take it. */
export type Listen = {
  /** Unix seconds: when it began. */
  listenedAt: number
  artist: string
  track: string
  album: string
  durationSeconds: number | null
  recordingMbid: string | null
  releaseMbid: string | null
}

/** The account a token names at a service: its name there, and the secret raven keeps to send for it. */
export type LinkedAccount = { username: string; secret: string }

type ValidateProps = { token: string }

type SendProps = { secret: string; listen: Listen }

/**
 * One service's side of scrobbling. `validate` trades what the account
 * hands over for its name and the secret to keep, or null when the service
 * refuses it, and throws when the service cannot be reached.
 */
export type Scrobbler = {
  /** Whether this server can send to it at all. */
  isAvailable: () => boolean
  validate: ({ token }: ValidateProps) => Promise<LinkedAccount | null>
  send: ({ secret, listen }: SendProps) => Promise<SendOutcome>
}

/** What an HTTP status says of a send: 401 is the account's link, 429 and 5xx a service having a moment. */
export const outcomeOfStatus = (status: number): SendOutcome => {
  if (status >= 200 && status < 300) return SEND_OUTCOMES.sent
  if (status === 401) return SEND_OUTCOMES.unlinked
  if (status === 429 || status >= 500) return SEND_OUTCOMES.retry
  return SEND_OUTCOMES.rejected
}
