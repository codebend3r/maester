import { domainToUnicode } from 'node:url'
import type { ConfigStore, DesktopConfig, ServerEntry } from '@/main/desktopConfig'
import { loggable } from '@/main/servers/serverCalls'
import {
  ADD_REFUSALS,
  NAME_MAX,
  SERVERS_CAP,
  addServer,
  removeServer,
  serverById,
  serverByOrigin,
} from '@/main/servers/serverList'
import type { Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'
import { serverOriginOf } from '@/shared/playLink'
import { isOpaqueId } from '@/shared/protocol'

/**
 * The longest trust waits on the probe or on clearing a session before it goes on, so
 * one that never settles cannot leave every later prompt answered busy. Both have
 * budgets of their own, shorter than this.
 */
export const TRUST_STEP_MS = 15_000

export const TRUST_MESSAGES = {
  prompt: (origin: string) => `Add the raven server at ${origin}?`,
  detail:
    'raven player plays titles from it and keeps its sign-in for this server alone. Add only servers you trust.',
  lookalike: (unicode: string) =>
    `Its address is written in other alphabets and reads as \u2068${unicode}\u2069. Letters from other alphabets can look like familiar ones, so check it is the server you mean.`,
  full: 'raven player keeps at most 20 servers. Remove one in Settings first.',
  unreachable: (origin: string) => `No raven server answered at ${origin}.`,
  busy: 'raven player is already asking about another server.',
  invalid:
    'That is not a server address raven player can use. Use one like https://raven.example.ts.net.',
  unsaved: 'raven player could not keep that server. Try adding it again.',
} as const

export const TRUST_OUTCOME_KINDS = {
  trusted: 'trusted',
  declined: 'declined',
  full: 'full',
  busy: 'busy',
  unreachable: 'unreachable',
  invalid: 'invalid',
  unsaved: 'unsaved',
} as const

export type TrustOutcome =
  | { kind: typeof TRUST_OUTCOME_KINDS.trusted; server: ServerEntry; isNew: boolean }
  | { kind: typeof TRUST_OUTCOME_KINDS.declined }
  | { kind: typeof TRUST_OUTCOME_KINDS.full }
  | { kind: typeof TRUST_OUTCOME_KINDS.busy }
  | { kind: typeof TRUST_OUTCOME_KINDS.unreachable; origin: string }
  | { kind: typeof TRUST_OUTCOME_KINDS.invalid }
  | { kind: typeof TRUST_OUTCOME_KINDS.unsaved }

/** Where a trust request came from: a `raven://` link, or Settings' Add. */
export const TRUST_SOURCES = { link: 'link', app: 'app' } as const

export type TrustSource = (typeof TRUST_SOURCES)[keyof typeof TRUST_SOURCES]

export type ServerTrust = {
  trust: (input: { origin: string; from: TrustSource }) => Promise<TrustOutcome>
  remove: (serverId: string) => Promise<boolean>
}

export type ServerTrustDeps = {
  config: ConfigStore
  /** Only `true` is a yes. */
  confirm: (origin: string) => Promise<unknown>
  probe: (input: { serverId: string; origin: string }) => Promise<boolean>
  forget: (serverId: string) => Promise<void>
  onRemoved: (serverId: string) => void
  newId: () => string
  now: () => number
  timers: Timers
  warn: (message: string) => void
}

const HIDDEN = /[\p{Cc}\p{Cf}]/u

/**
 * The trust prompt's detail. A punycode host is also spelled out in its own
 * letters, isolated so a right-to-left name cannot reorder the sentence, so a
 * lookalike of a familiar name is visible; the message itself stays punycode.
 */
export const trustDetailFor = ({ origin }: { origin: string }): string => {
  if (!URL.canParse(origin)) return TRUST_MESSAGES.detail
  const { hostname } = new URL(origin)
  const isPunycode = hostname.split('.').some((label) => label.startsWith('xn--'))
  const unicode = domainToUnicode(hostname)
  if (!isPunycode || unicode === '' || unicode === hostname || HIDDEN.test(unicode)) {
    return TRUST_MESSAGES.detail
  }
  return `${TRUST_MESSAGES.detail} ${TRUST_MESSAGES.lookalike(unicode)}`
}

type AddRefusal = Extract<ReturnType<typeof addServer>, { ok: false }>['reason']

/**
 * `addServer`, with the host cut to a name's length. The host is ASCII, so cutting it
 * splits no character. A refusal leaves the config as it is and is told to `onRefused`.
 */
const withServer = ({
  config,
  id,
  origin,
  at,
  onRefused,
}: {
  config: DesktopConfig
  id: string
  origin: string
  at: number
  onRefused: (reason: AddRefusal) => void
}): DesktopConfig => {
  const added = addServer({ config, id, origin, at })
  if (!added.ok) {
    onRefused(added.reason)
    return config
  }
  return {
    ...added.config,
    servers: added.config.servers.map((server) =>
      server.id === id ? { ...server, name: server.name.slice(0, NAME_MAX) } : server,
    ),
  }
}

/**
 * Decides whether raven player may talk to a server. Nothing reaches a new origin
 * until a person says yes in main's own prompt, and only one prompt is open at a time.
 */
export const createServerTrust = (deps: ServerTrustDeps): ServerTrust => {
  const declinedFromLinks = new Set<string>()
  const state = { isAsking: false }

  const warn = (message: string): void => {
    try {
      deps.warn(message)
    } catch {
      // A throwing logger must not turn an answer into a rejection.
    }
  }

  /** `work`, or `late` once `TRUST_STEP_MS` passed without it settling. */
  const within = async <T>({ work, late }: { work: Promise<T>; late: () => T }): Promise<T> => {
    const budget: { handle: unknown } = { handle: null }
    const deadline = new Promise<T>((resolve) => {
      budget.handle = deps.timers.set({ run: () => resolve(late()), ms: TRUST_STEP_MS })
    })
    try {
      return await Promise.race([work, deadline])
    } finally {
      deps.timers.clear(budget.handle)
    }
  }

  const forget = async (serverId: string): Promise<void> => {
    await within({
      work: Promise.resolve()
        .then(() => deps.forget(serverId))
        .catch((error: unknown) => {
          warn(
            `raven player could not clear server ${serverId}'s session: ${loggable(messageOf(error))}`,
          )
        }),
      late: () => {
        warn(`raven player gave up clearing server ${serverId}'s session after ${TRUST_STEP_MS} ms`)
      },
    })
  }

  const newId = (): string | null => {
    try {
      const id = deps.newId()
      return isOpaqueId(id) ? id : null
    } catch {
      return null
    }
  }

  const consentFor = (origin: string): Promise<boolean | null> =>
    Promise.resolve()
      .then(() => deps.confirm(origin))
      .then(
        (answer) => answer === true,
        (error: unknown) => {
          warn(`raven player could not ask about ${origin}: ${loggable(messageOf(error))}`)
          return null
        },
      )

  const isRaven = (input: { serverId: string; origin: string }): Promise<boolean> =>
    within({
      work: Promise.resolve()
        .then(() => deps.probe(input))
        .then(
          (answer) => answer === true,
          () => false,
        ),
      late: () => {
        warn(`raven player gave up on ${input.origin} after ${TRUST_STEP_MS} ms`)
        return false
      },
    })

  const keep = async ({
    serverId,
    origin,
  }: {
    serverId: string
    origin: string
  }): Promise<TrustOutcome> => {
    const refusal: { reason: AddRefusal | null } = { reason: null }
    try {
      deps.config.update((config) =>
        withServer({
          config,
          id: serverId,
          origin,
          at: deps.now(),
          onRefused: (reason) => {
            refusal.reason = reason
          },
        }),
      )
    } catch (error) {
      warn(`raven player could not keep ${origin}: ${loggable(messageOf(error))}`)
      await forget(serverId)
      return { kind: TRUST_OUTCOME_KINDS.unsaved }
    }
    const stored = serverByOrigin({ config: deps.config.read(), origin })
    if (stored === null) {
      await forget(serverId)
      return refusal.reason === ADD_REFUSALS.full
        ? { kind: TRUST_OUTCOME_KINDS.full }
        : { kind: TRUST_OUTCOME_KINDS.unsaved }
    }
    // Stored, by this trust or meanwhile by another: a link may ask about it again.
    declinedFromLinks.delete(origin)
    if (stored.id !== serverId) {
      await forget(serverId)
      return { kind: TRUST_OUTCOME_KINDS.trusted, server: stored, isNew: false }
    }
    return { kind: TRUST_OUTCOME_KINDS.trusted, server: stored, isNew: true }
  }

  const ask = async ({
    origin,
    from,
  }: {
    origin: string
    from: TrustSource
  }): Promise<TrustOutcome> => {
    const answer = await consentFor(origin)
    if (answer !== true) {
      if (answer === false && from === TRUST_SOURCES.link) declinedFromLinks.add(origin)
      return { kind: TRUST_OUTCOME_KINDS.declined }
    }
    const serverId = newId()
    // The id names a session on disk, so one that is not fresh and opaque must not make one.
    if (serverId === null || serverById({ config: deps.config.read(), serverId }) !== null) {
      warn(`raven player made an unusable id for ${origin}`)
      return { kind: TRUST_OUTCOME_KINDS.unsaved }
    }
    if (!(await isRaven({ serverId, origin }))) {
      await forget(serverId)
      return { kind: TRUST_OUTCOME_KINDS.unreachable, origin }
    }
    return keep({ serverId, origin })
  }

  return {
    trust: async ({ origin: raw, from }) => {
      // `serverOriginOf` refuses a host ending in a dot, which would store one server twice.
      const origin = serverOriginOf(raw)
      if (origin === null) return { kind: TRUST_OUTCOME_KINDS.invalid }
      const config = deps.config.read()
      const known = serverByOrigin({ config, origin })
      if (known !== null) return { kind: TRUST_OUTCOME_KINDS.trusted, server: known, isNew: false }
      if (config.servers.length >= SERVERS_CAP) return { kind: TRUST_OUTCOME_KINDS.full }
      if (from === TRUST_SOURCES.link && declinedFromLinks.has(origin)) {
        return { kind: TRUST_OUTCOME_KINDS.declined }
      }
      if (state.isAsking) return { kind: TRUST_OUTCOME_KINDS.busy }
      state.isAsking = true
      try {
        return await ask({ origin, from })
      } finally {
        state.isAsking = false
      }
    },
    remove: async (serverId) => {
      if (serverById({ config: deps.config.read(), serverId }) === null) return false
      try {
        deps.config.update((config) => removeServer({ config, serverId }))
      } catch (error) {
        warn(`raven player could not remove server ${serverId}: ${loggable(messageOf(error))}`)
        return false
      }
      // Its title stops before the session is cleared, so nothing more is asked of it.
      try {
        deps.onRemoved(serverId)
      } catch (error) {
        warn(
          `raven player removed server ${serverId} but could not stop it: ${loggable(messageOf(error))}`,
        )
      }
      await forget(serverId)
      return true
    },
  }
}

const FROM_LABELS = {
  [TRUST_SOURCES.link]: 'a link',
  [TRUST_SOURCES.app]: 'the app',
} as const satisfies Record<TrustSource, string>

const outcomeLabel = (outcome: TrustOutcome): string =>
  outcome.kind === TRUST_OUTCOME_KINDS.trusted
    ? `trusted ${outcome.server.id}${outcome.isNew ? ' (new)' : ''}`
    : outcome.kind

/** `trust` with every outcome logged by origin, never by anything the server sent. */
export const withTrustLog = ({
  trust,
  warn,
}: {
  trust: ServerTrust
  warn: (message: string) => void
}): ServerTrust => ({
  trust: async (input) => {
    const outcome = await trust.trust(input)
    try {
      warn(
        `trust for ${loggable(input.origin)} from ${FROM_LABELS[input.from]}: ${outcomeLabel(outcome)}`,
      )
    } catch {
      // A throwing logger must not turn an answer into a rejection.
    }
    return outcome
  },
  remove: (serverId) => trust.remove(serverId),
})
