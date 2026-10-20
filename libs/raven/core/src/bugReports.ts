import { MEDIA_TICKET_PARAM, type PlaybackDiagnostics } from '@/contract'

/** An address with no query or fragment, where a media ticket would ride. */
const withoutQuery = (url: string): string => url.split(/[?#]/)[0] ?? ''

const QUOTED_TICKET = new RegExp(`([?&]${MEDIA_TICKET_PARAM}=)[^&#\\s"']*`, 'g')

/** A message with any ticket in an address it quotes blanked out. */
const withoutQuotedTickets = (text: string): string => text.replace(QUOTED_TICKET, '$1redacted')

/**
 * The diagnostics with no media ticket left in them: the page and the origin
 * lose their query, and any ticket a problem or a failed way's message
 * quotes is blanked. The player sends them so, and the server keeps them so
 * whatever a client sends.
 */
export const withoutTickets = (diagnostics: PlaybackDiagnostics): PlaybackDiagnostics => ({
  ...diagnostics,
  problems: diagnostics.problems.map(withoutQuotedTickets),
  playback: diagnostics.playback && {
    ...diagnostics.playback,
    attempts: diagnostics.playback.attempts.map((attempt) => ({
      ...attempt,
      message: withoutQuotedTickets(attempt.message),
    })),
  },
  origin: diagnostics.origin && {
    ...diagnostics.origin,
    url: withoutQuery(diagnostics.origin.url),
  },
  app: { ...diagnostics.app, page: withoutQuery(diagnostics.app.page) },
})
