import {
  isMediaId,
  isMediaTracks,
  LOCKED_STATUS,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerSource,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import {
  type FailureExplainer,
  PLAYER_MESSAGES,
  PLAYER_PHASES,
  type ResolvedSource,
  type ServerTarget,
} from '@/main/player/playerService'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { cookieHeader } from '@/main/servers/cookieHeader'
import { loggable, type ServerCallResult, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import { messageOf } from '@/shared/messageOf'
import { isOpaqueId, SERVER_GONE } from '@/shared/protocol'

export const SOURCE_MESSAGES = {
  unknownServer: SERVER_GONE,
  badTitle: 'raven player cannot open that title.',
  lost: (name: string) =>
    `raven player lost its connection to ${name}. Where you stopped last is saved there.`,
  relocked: (name: string) => `${name} locked this library again.`,
  gone: (name: string) => `This title is not on ${name} any more.`,
  cannotOpen: (name: string) => `raven player could not open this title from ${name}.`,
} as const

export const EXPLAIN_TIMEOUT_MS = 5000
/**
 * The page's commands wait in line behind a load, so a slow track list must not hold the
 * title (or a Back after it) for long: past this the title plays without sidecars.
 */
export const TRACKS_TIMEOUT_MS = 3000

const NOT_FOUND_STATUS = 404

type ServerSource = Extract<PlayerSource, { kind: typeof PLAYER_SOURCE_KINDS.server }>

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

const BOUNDED_OUTCOMES = { answered: 'answered', late: 'late', failed: 'failed' } as const

type Bounded =
  | { outcome: typeof BOUNDED_OUTCOMES.answered; result: ServerCallResult }
  | { outcome: typeof BOUNDED_OUTCOMES.late }
  | { outcome: typeof BOUNDED_OUTCOMES.failed; message: string }

/** The call's answer, or why there is none: it rejected, or did not answer within `ms`. */
const within = async ({
  task,
  ms,
}: {
  task: Promise<ServerCallResult>
  ms: number
}): Promise<Bounded> => {
  const timer: { handle: ReturnType<typeof setTimeout> | null } = { handle: null }
  const timeout = new Promise<Bounded>((resolve) => {
    timer.handle = setTimeout(() => resolve({ outcome: BOUNDED_OUTCOMES.late }), ms)
  })
  const answer = task.then(
    (result): Bounded => ({ outcome: BOUNDED_OUTCOMES.answered, result }),
    (error: unknown): Bounded => ({ outcome: BOUNDED_OUTCOMES.failed, message: messageOf(error) }),
  )
  try {
    return await Promise.race([answer, timeout])
  } finally {
    if (timer.handle !== null) clearTimeout(timer.handle)
  }
}

/**
 * Server titles for the player: main builds the file URL from the stored origin, the
 * `Cookie` header from that server's own session and the sidecars from the server's own
 * track list, so nothing the page sends names a host, a path or a cookie. Main asks the
 * server why when mpv fails to open or stops one of its titles.
 */
export const createServerSources = ({
  serverOf,
  cookiesFor,
  calls,
  warn,
}: {
  serverOf: (serverId: string) => ServerEntry | null
  cookiesFor: (input: {
    serverId: string
    url: string
  }) => Promise<readonly { name: string; value: string }[]>
  calls: Pick<ServerCalls, 'call'>
  warn: (message: string) => void
}): { resolve: (source: ServerSource) => Promise<ResolvedSource>; explain: FailureExplainer } => {
  const sidecarsOf = async ({
    server,
    mediaId,
  }: {
    server: ServerEntry
    mediaId: number
  }): Promise<ServerTarget['sidecars']> => {
    const name = loggable(server.name)
    try {
      const bounded = await within({
        task: calls.call({ serverId: server.id, call: { name: CALL_NAMES.getTracks, mediaId } }),
        ms: TRACKS_TIMEOUT_MS,
      })
      if (bounded.outcome === BOUNDED_OUTCOMES.late) {
        warn(`no sidecars from ${name}: its tracks did not answer in time`)
        return []
      }
      if (bounded.outcome === BOUNDED_OUTCOMES.failed) {
        warn(`no sidecars from ${name}: its tracks failed: ${loggable(bounded.message)}`)
        return []
      }
      const { result } = bounded
      if (!result.ok) {
        warn(`no sidecars from ${name}: ${loggable(result.message)}`)
        return []
      }
      if (result.status !== 200) {
        warn(`no sidecars from ${name}: its tracks answered ${result.status}`)
        return []
      }
      const parsed = parseJson(result.body)
      if (!parsed.ok || !isMediaTracks(parsed.value)) {
        warn(`no sidecars from ${name}: its tracks were not a track list`)
        return []
      }
      return sidecarTracksOf(parsed.value).map((track) => ({
        url: `${server.origin}/api/media/${mediaId}/subtitles/${encodeURIComponent(track.id)}`,
        title: track.title ?? '',
        language: track.language ?? '',
      }))
    } catch (error) {
      warn(`no sidecars from ${name}: ${loggable(messageOf(error))}`)
      return []
    }
  }

  const resolve = async ({ serverId, mediaId }: ServerSource): Promise<ResolvedSource> => {
    if (!isOpaqueId(serverId) || !isMediaId(mediaId)) {
      return { ok: false, message: SOURCE_MESSAGES.badTitle }
    }
    const server = serverOf(serverId)
    if (server === null) return { ok: false, message: SOURCE_MESSAGES.unknownServer }
    const url = `${server.origin}/api/media/${mediaId}/file`
    const [sidecars, cookies] = await Promise.all([
      sidecarsOf({ server, mediaId }),
      cookiesFor({ serverId, url }),
    ])
    return {
      ok: true,
      target: {
        kind: PLAYER_SOURCE_KINDS.server,
        serverId,
        mediaId,
        url,
        headerFields: cookieHeader(cookies) ?? '',
        sidecars,
      },
    }
  }

  const explain: FailureExplainer = async ({ target, phase }) => {
    const server = serverOf(target.serverId)
    if (server === null) {
      return { reason: PLAYER_ERROR_REASONS.network, message: SOURCE_MESSAGES.lost('the server') }
    }
    const bounded = await within({
      task: calls.call({
        serverId: server.id,
        call: { name: CALL_NAMES.getMedia, mediaId: target.mediaId },
      }),
      ms: EXPLAIN_TIMEOUT_MS,
    })
    if (bounded.outcome !== BOUNDED_OUTCOMES.answered || !bounded.result.ok) {
      return { reason: PLAYER_ERROR_REASONS.network, message: SOURCE_MESSAGES.lost(server.name) }
    }
    const { result } = bounded
    if (result.status === LOCKED_STATUS) {
      return { reason: PLAYER_ERROR_REASONS.locked, message: SOURCE_MESSAGES.relocked(server.name) }
    }
    if (result.status === NOT_FOUND_STATUS) {
      return { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.gone(server.name) }
    }
    return phase === PLAYER_PHASES.loading
      ? { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.cannotOpen(server.name) }
      : { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped }
  }

  return { resolve, explain }
}
