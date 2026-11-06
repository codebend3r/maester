import { type Infer, matching, object, oneOf, union } from '@/schema'

/**
 * What the viewer chose to watch, which says what plays next: nothing after
 * a film on its own, the rest of a season, the rest of the show across its
 * seasons (specials last), the rest of a saga, the rest of a queue a
 * shuffle dealt, which rides along in router state, or a show shuffled with
 * no end, each next a random episode the server draws.
 */
export const SESSION_KINDS = {
  single: 'single',
  season: 'season',
  show: 'show',
  saga: 'saga',
  queue: 'queue',
  shuffle: 'shuffle',
} as const

export type SessionKind = (typeof SESSION_KINDS)[keyof typeof SESSION_KINDS]

/** A whole id above zero as text, as a query names one. */
const ID_TEXT = /^[1-9]\d{0,15}$/u

/** A TMDB collection's id, as a saga is named in its library. */
export const isSagaId = matching(ID_TEXT)

/** A show's item id as a query names it: the show a shuffle draws from. */
export const isShowScope = matching(ID_TEXT)

export const isViewingSession = union(
  object({
    kind: oneOf([
      SESSION_KINDS.single,
      SESSION_KINDS.season,
      SESSION_KINDS.show,
      SESSION_KINDS.queue,
    ]),
  }),
  object({ kind: oneOf([SESSION_KINDS.saga]), sagaId: isSagaId }),
  object({ kind: oneOf([SESSION_KINDS.shuffle]), showId: isShowScope }),
)

export type ViewingSession = Infer<typeof isViewingSession>

/** The rest of the show across its seasons, specials last: an episode's own, and Play all's. */
export const SHOW_SESSION = { kind: SESSION_KINDS.show } as const satisfies ViewingSession

/** Show `showId` shuffled with no end: each next a random episode of it the server draws. */
export const shuffleSessionOf = (showId: number): ViewingSession => ({
  kind: SESSION_KINDS.shuffle,
  showId: String(showId),
})

/** The sessions whose next the server finds: the others have none, or carry it. */
const ASKS_SERVER: ReadonlySet<SessionKind> = new Set([
  SESSION_KINDS.season,
  SESSION_KINDS.show,
  SESSION_KINDS.saga,
  SESSION_KINDS.shuffle,
])

/** Whether `GET /api/media/:id/next` answers for `session`. */
export const asksServerForNext = (session: ViewingSession): boolean => ASKS_SERVER.has(session.kind)

/** The query `GET /api/media/:id/next` reads a session from. */
export const SESSION_PARAMS = { session: 'session', scope: 'scope' } as const

/** The query value that scopes `session`: the saga it walks or the show it shuffles. */
const scopeOf = (session: ViewingSession): string | null => {
  if (session.kind === SESSION_KINDS.saga) return session.sagaId
  if (session.kind === SESSION_KINDS.shuffle) return session.showId
  return null
}

/** `session` as the query of `GET /api/media/:id/next`: its kind, and the saga or show it scopes. */
export const sessionQueryOf = (session: ViewingSession): Record<string, string> => {
  const scope = scopeOf(session)
  return scope === null
    ? { [SESSION_PARAMS.session]: session.kind }
    : { [SESSION_PARAMS.session]: session.kind, [SESSION_PARAMS.scope]: scope }
}

type ReadSessionQueryProps = { session: unknown; scope: unknown }

/** The shape a query reads as, before it is checked: a saga or a shuffle takes its scope. */
const queryRead = ({ session, scope }: ReadSessionQueryProps): Record<string, unknown> => {
  if (session === SESSION_KINDS.saga) return { kind: session, sagaId: scope }
  if (session === SESSION_KINDS.shuffle) return { kind: session, showId: scope }
  return { kind: session }
}

/** The session a query names, or null for one that names none. */
export const readSessionQuery = (props: ReadSessionQueryProps): ViewingSession | null => {
  const read = queryRead(props)
  return isViewingSession(read) ? read : null
}
