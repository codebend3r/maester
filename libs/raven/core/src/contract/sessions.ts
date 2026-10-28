import { type Infer, matching, object, oneOf, union } from '@/schema'

/**
 * What the viewer chose to watch, which says what plays next: nothing after
 * a film on its own, the rest of a season, the rest of the show across its
 * seasons (specials last), the rest of a saga, or the rest of a queue a
 * shuffle dealt, which rides along in router state.
 */
export const SESSION_KINDS = {
  single: 'single',
  season: 'season',
  show: 'show',
  saga: 'saga',
  queue: 'queue',
} as const

export type SessionKind = (typeof SESSION_KINDS)[keyof typeof SESSION_KINDS]

/** A TMDB collection's id, as a saga is named in its library. */
export const isSagaId = matching(/^[1-9]\d{0,15}$/u)

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
)

export type ViewingSession = Infer<typeof isViewingSession>

/** The sessions whose next the server finds: the others have none, or carry it. */
const ASKS_SERVER: ReadonlySet<SessionKind> = new Set([
  SESSION_KINDS.season,
  SESSION_KINDS.show,
  SESSION_KINDS.saga,
])

/** Whether `GET /api/media/:id/next` answers for `session`. */
export const asksServerForNext = (session: ViewingSession): boolean => ASKS_SERVER.has(session.kind)

/** The query `GET /api/media/:id/next` reads a session from. */
export const SESSION_PARAMS = { session: 'session', scope: 'scope' } as const

/** `session` as the query of `GET /api/media/:id/next`: its kind, and the saga it walks. */
export const sessionQueryOf = (session: ViewingSession): Record<string, string> =>
  session.kind === SESSION_KINDS.saga
    ? { [SESSION_PARAMS.session]: session.kind, [SESSION_PARAMS.scope]: session.sagaId }
    : { [SESSION_PARAMS.session]: session.kind }

type ReadSessionQueryProps = { session: unknown; scope: unknown }

/** The session a query names, or null for one that names none. */
export const readSessionQuery = ({
  session,
  scope,
}: ReadSessionQueryProps): ViewingSession | null => {
  const read = session === SESSION_KINDS.saga ? { kind: session, sagaId: scope } : { kind: session }
  return isViewingSession(read) ? read : null
}
