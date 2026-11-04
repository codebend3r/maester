import type { Transport } from '@/apiClient/transport'
import {
  type ListenReport,
  type ListenStart,
  PLAY_HISTORY_PARAMS,
  PLAY_HISTORY_PATHS,
  PLAY_HISTORY_SHOWS,
  type PlayHistoryPage,
  type PlayHistoryShow,
  isListenStarted,
  isPlayHistoryPage,
} from '@/contract'
import { toQueryString } from '@/query'

type HistoryPageQuery = {
  /** The cursor a page before this one answered as `next`; null for the newest page. */
  before: string | null
  show: PlayHistoryShow
  limit?: number
}

type EveryoneHistoryQuery = HistoryPageQuery & {
  /** One account's history; null for everyone's. */
  accountId: string | null
}

type StartListenProps = { mediaId: number } & ListenStart

type ReportListenProps = { id: number } & ListenReport

const queryOf = ({ before, show, limit }: HistoryPageQuery): Record<string, string> => ({
  ...(before === null ? {} : { [PLAY_HISTORY_PARAMS.before]: before }),
  ...(show === PLAY_HISTORY_SHOWS.all ? {} : { [PLAY_HISTORY_PARAMS.show]: show }),
  ...(limit === undefined ? {} : { [PLAY_HISTORY_PARAMS.limit]: String(limit) }),
})

const withQuery = (path: string, query: Record<string, string>): string =>
  Object.keys(query).length === 0 ? path : `${path}?${toQueryString(query)}`

/** The play history: an account's own, everyone's for the owner, and the listens a music player reports. */
export const historyCalls = ({ send, expect }: Transport) => ({
  /** One page of the signed-in account's history, newest first. */
  listPlayHistory: (query: HistoryPageQuery): Promise<PlayHistoryPage> =>
    expect({
      request: send({ path: withQuery(PLAY_HISTORY_PATHS.own, queryOf(query)) }),
      guard: isPlayHistoryPage,
    }),

  /** One page of every account's history, or one account's, newest first. Owner only. */
  listEveryonesHistory: ({ accountId, ...query }: EveryoneHistoryQuery): Promise<PlayHistoryPage> =>
    expect({
      request: send({
        path: withQuery(PLAY_HISTORY_PATHS.everyone, {
          ...queryOf(query),
          ...(accountId === null ? {} : { [PLAY_HISTORY_PARAMS.account]: accountId }),
        }),
      }),
      guard: isPlayHistoryPage,
    }),

  /** Notes that a track started playing; answers the listen's id for `reportListen`. */
  startListen: async ({ mediaId, position }: StartListenProps): Promise<number> => {
    const started = await expect({
      request: send({
        path: PLAY_HISTORY_PATHS.startListen.replace(`:${PLAY_HISTORY_PARAMS.id}`, String(mediaId)),
        method: 'POST',
        body: { position } satisfies ListenStart,
      }),
      guard: isListenStarted,
    })
    return started.id
  },

  /** Notes how far a listen has got. */
  reportListen: async ({ id, position }: ReportListenProps): Promise<void> => {
    await send({
      path: PLAY_HISTORY_PATHS.listen.replace(`:${PLAY_HISTORY_PARAMS.id}`, String(id)),
      method: 'PUT',
      body: { position } satisfies ListenReport,
    })
  },
})
