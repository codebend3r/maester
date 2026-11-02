import { basename } from 'node:path'
import { PLAYER_SOURCE_KINDS, type PlayerErrorReason, type PlayerSource } from '@raven/core'
import { MPV_COMMANDS } from '@raven/mpv'
import type { Grants } from '@/main/grants'
import type { ShowingPhase } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'

/**
 * Sent with every server title. lavf must not follow a redirect, which would carry the
 * server's cookie to wherever it points (Ruling 14). mpv has lavf reconnect a dropped
 * stream after 0, 1, 3 and 7 s and gives every read 60 s: these keep 0, 1 and 3 s (a
 * Wi-Fi blip) and 15 s a read, so a server that went away stops its title about 4 s
 * after the last byte. One that hangs would cost seven reads (about 2 minutes), so the
 * service's stall budget (`SERVER_STALL_MS`) ends the title first.
 * `stream-lavf-o` is applied after mpv's own lavf defaults, so it overrides them.
 */
const SERVER_LOAD_OPTIONS = {
  lavf: 'max_redirects=0,reconnect_delay_max=3',
  networkTimeout: 15,
} as const

export type ServerTarget = {
  kind: typeof PLAYER_SOURCE_KINDS.server
  serverId: string
  mediaId: number
  url: string
  sidecars: readonly { url: string; title: string; language: string }[]
  /** The loopback relay load this title plays through. Its base names the load's secret, which warnings blank. */
  relay: { loadId: string; base: string }
}
export type LocalSidecar = { path: string; title: string; language: string }
type FileTarget = {
  kind: typeof PLAYER_SOURCE_KINDS.file
  path: string
  sidecars: readonly LocalSidecar[]
}
export type LoadTarget = FileTarget | ServerTarget
export type ResolvedSource = { ok: true; target: LoadTarget } | { ok: false; message: string }
/** What the server sources answer: always a relayed server target, which the player widens. */
export type ResolvedServerSource =
  | { ok: true; target: ServerTarget }
  | { ok: false; message: string }
/**
 * The account failure the relay saw for a server title, read synchronously, or null: a title
 * refused mid-play says access was removed, never that the connection was lost.
 */
export type AccountRefusalReader = (
  target: ServerTarget,
) => { reason: PlayerErrorReason; message: string } | null
type FailureExplainerProps = {
  target: ServerTarget
  phase: ShowingPhase
}

export type FailureExplainer = (
  input: FailureExplainerProps,
) => Promise<{ reason: PlayerErrorReason; message: string }>

type ResolveSourceWithProps = {
  grants: Pick<Grants, 'fileOf'>
  servers: {
    resolve: (
      source: Extract<PlayerSource, { kind: typeof PLAYER_SOURCE_KINDS.server }>,
    ) => Promise<ResolvedServerSource>
  }
  /** The subtitle files that belong to a granted file, keyed by its `fileId`. */
  sidecarsOf: (fileId: string) => readonly LocalSidecar[]
}

export const resolveSourceWith =
  ({ grants, servers, sidecarsOf }: ResolveSourceWithProps) =>
  async (source: PlayerSource): Promise<ResolvedSource> => {
    switch (source.kind) {
      case PLAYER_SOURCE_KINDS.server:
        return servers.resolve(source)
      case PLAYER_SOURCE_KINDS.file: {
        const file = grants.fileOf(source.fileId)
        if (file === null) return { ok: false, message: PLAYER_MESSAGES.notOpen }
        return {
          ok: true,
          target: {
            kind: PLAYER_SOURCE_KINDS.file,
            path: file.path,
            sidecars: sidecarsOf(source.fileId),
          },
        }
      }
      default: {
        const unreachable: never = source
        return unreachable
      }
    }
  }

export type ResolveSource = ReturnType<typeof resolveSourceWith>

/** mpv's `%len%` quoting, so a value may hold `,` or `=` without ending the option. */
export const quoted = (value: string): string =>
  `%${new TextEncoder().encode(value).length}%${value}`

type LoadfileOptionsForProps = { target: LoadTarget; start: number }

/**
 * The `loadfile` options for a target: where it starts, and for a server title the
 * redirect and reconnect limits and the network timeout, which mpv applies
 * to this file alone (sidecars added while it plays included) and drops when it ends.
 */
export const loadfileOptionsFor = ({ target, start }: LoadfileOptionsForProps): string => {
  switch (target.kind) {
    case PLAYER_SOURCE_KINDS.file:
      return `start=${start}`
    case PLAYER_SOURCE_KINDS.server:
      return [
        `start=${start}`,
        `stream-lavf-o=${quoted(SERVER_LOAD_OPTIONS.lavf)}`,
        `network-timeout=${SERVER_LOAD_OPTIONS.networkTimeout}`,
      ].join(',')
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

/** What `loadfile` is given: a path for a file, a relay URL for a server title. */
export const locationOf = (target: LoadTarget): string => {
  switch (target.kind) {
    case PLAYER_SOURCE_KINDS.file:
      return target.path
    case PLAYER_SOURCE_KINDS.server:
      return target.url
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

export type Sidecar = { location: string; title: string; language: string }

/** What `sub-add` is given for each of a target's sidecars: a URL for a server, a path for a file. */
export const sidecarsOfTarget = (target: LoadTarget): readonly Sidecar[] => {
  switch (target.kind) {
    case PLAYER_SOURCE_KINDS.file:
      return target.sidecars.map(({ path, title, language }) => ({
        location: path,
        title,
        language,
      }))
    case PLAYER_SOURCE_KINDS.server:
      return target.sidecars.map(({ url, title, language }) => ({
        location: url,
        title,
        language,
      }))
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

export const subAddArgs = ({ location, title, language }: Sidecar): string[] => [
  MPV_COMMANDS.subAdd,
  location,
  'auto',
  title,
  language,
]

/** What a warning says in place of the open file's path or name. */
const OPEN_FILE = '<file>'
/** What a warning says in place of a relayed title's base or the secret inside it. */
const RELAYED = '<relay>'

type WithoutTargetProps = { target: LoadTarget | null; message: string }

/**
 * mpv's warnings name the file it plays and its sidecars, which the log must not hold
 * (Ruling 12). Whole paths go first so a name inside one is not replaced on its own.
 * A relayed title's base holds its load's secret, which the log must not hold either.
 */
export const withoutTarget = ({ target, message }: WithoutTargetProps): string => {
  if (target === null) return message
  switch (target.kind) {
    case PLAYER_SOURCE_KINDS.server: {
      const { base } = target.relay
      const secret = base.slice(base.lastIndexOf('/') + 1)
      return [base, secret]
        .filter((name) => name !== '')
        .reduce((text, name) => text.replaceAll(name, RELAYED), message)
    }
    case PLAYER_SOURCE_KINDS.file: {
      const paths = [target.path, ...target.sidecars.map(({ path }) => path)]
      const named = [...paths, ...paths.map((path) => basename(path))].filter((name) => name !== '')
      return named.reduce((text, name) => text.replaceAll(name, OPEN_FILE), message)
    }
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}
